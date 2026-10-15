export interface FileChange {
  path: string
  content: string | null
}

export type SaveMode = 'auto' | 'manual'

export interface SaveResult {
  savedPaths: string[]
  error?: unknown
}

export interface WorkspaceWriter {
  supportsAutoSave: boolean
  save(changes: readonly FileChange[], mode: SaveMode): Promise<SaveResult>
}

export interface SaveState {
  dirty: boolean
  saving: boolean
  error: unknown | null
  pendingFiles: number
}

/**
 * 文件分组：项目文档与由文档派生的文件分开控制自动写入。
 * - docs：common.json / current/… / versions/… 等项目自身的文档
 * - outputs：output/ 下的 SQL 与 AI 指南等派生产物
 */
export type SaveGroup = 'docs' | 'outputs'

export interface AutoSaveOptions {
  /** 项目文档改动后自动写入磁盘 */
  docs: boolean
  /** 派生文件在项目文档变化后自动重写 */
  outputs: boolean
}

export interface SaveCoordinatorOptions {
  writer: WorkspaceWriter
  initialFiles: ReadonlyMap<string, string>
  autoSave?: Partial<AutoSaveOptions>
  delay?: number
  maxWait?: number
  prepare?: (changedPaths: readonly string[], mode: SaveMode) => readonly FileChange[]
  /** 路径分组，决定自动写入开关是否覆盖该文件；默认全部归入 docs */
  classify?: (path: string) => SaveGroup
  onStateChange?: (state: SaveState) => void
}

export class SaveCoordinator {
  private readonly desired: Map<string, string>
  private readonly baseline: Map<string, string>
  private readonly dirtyPaths = new Set<string>()
  private readonly writer: WorkspaceWriter
  private readonly options: SaveCoordinatorOptions
  private readonly classify: (path: string) => SaveGroup
  private autoSave: AutoSaveOptions
  private timer: ReturnType<typeof setTimeout> | null = null
  private maxTimer: ReturnType<typeof setTimeout> | null = null
  private queue: Promise<void> = Promise.resolve()
  private saving = false
  private disposed = false
  private error: unknown | null = null

  constructor(options: SaveCoordinatorOptions) {
    this.options = options
    this.writer = options.writer
    this.desired = new Map(options.initialFiles)
    this.baseline = new Map(options.initialFiles)
    this.classify = options.classify ?? (() => 'docs')
    this.autoSave = this.resolveAutoSave(options.autoSave)
  }

  get state(): SaveState {
    return {
      dirty: this.dirtyPaths.size > 0,
      saving: this.saving,
      error: this.error,
      pendingFiles: this.dirtyPaths.size,
    }
  }

  get files(): ReadonlyMap<string, string> {
    return this.desired
  }

  /** 当前生效的自动写入开关（写入器不支持自动保存时两者恒为 false） */
  get autoSaveOptions(): AutoSaveOptions {
    return { ...this.autoSave }
  }

  update(changes: readonly FileChange[]) {
    if (this.disposed) return
    this.applyChanges(changes)
    this.notify()
    this.schedule()
  }

  /** 按组切换自动写入；未传入的组保持原状 */
  setAutoSave(options: Partial<AutoSaveOptions>) {
    this.autoSave = this.resolveAutoSave({ ...this.autoSave, ...options })
    this.cancelTimers()
    this.schedule()
  }

  saveAll(): Promise<void> {
    return this.enqueue('manual')
  }

  saveChanges(): Promise<void> {
    return this.enqueue('auto')
  }

  async waitForIdle(): Promise<void> {
    await this.queue
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.cancelTimers()
    await this.queue
  }

  private applyChanges(changes: readonly FileChange[]) {
    for (const { path, content } of changes) {
      if (content === null) this.desired.delete(path)
      else this.desired.set(path, content)
      this.reconcile(path)
    }
  }

  private reconcile(path: string) {
    if (this.desired.get(path) === this.baseline.get(path)) this.dirtyPaths.delete(path)
    else this.dirtyPaths.add(path)
  }

  private notify() {
    if (!this.disposed) this.options.onStateChange?.(this.state)
  }

  private resolveAutoSave(requested: Partial<AutoSaveOptions> = {}): AutoSaveOptions {
    if (!this.writer.supportsAutoSave) return { docs: false, outputs: false }
    return { docs: requested.docs ?? true, outputs: requested.outputs ?? true }
  }

  /** 与磁盘不一致、且当前开关允许自动写入的文件 */
  private autoEligible(): string[] {
    return [...this.dirtyPaths].filter(path => this.autoSave[this.classify(path)])
  }

  /**
   * 是否有值得自动处理的工作：启用组里有脏文件即算有；
   * 派生组启用时，文档的改动也要走一次 prepare 才能知道要不要重写 SQL，同样算有。
   */
  private hasAutoWork(): boolean {
    if (this.dirtyPaths.size === 0) return false
    const docsDirty = [...this.dirtyPaths].some(path => this.classify(path) === 'docs')
    if (docsDirty) return this.autoSave.docs || this.autoSave.outputs
    return this.autoSave.outputs
  }

  private schedule() {
    if (this.disposed || this.saving) return
    if (!this.hasAutoWork()) {
      this.cancelTimers()
      return
    }
    if (this.timer) clearTimeout(this.timer)
    const flush = () => { void this.saveChanges().catch(() => {}) }
    this.timer = setTimeout(flush, this.options.delay ?? 400)
    this.maxTimer ??= setTimeout(flush, this.options.maxWait ?? 2000)
  }

  private cancelTimers() {
    if (this.timer) clearTimeout(this.timer)
    if (this.maxTimer) clearTimeout(this.maxTimer)
    this.timer = null
    this.maxTimer = null
  }

  private enqueue(mode: SaveMode): Promise<void> {
    this.cancelTimers()
    if (this.disposed) return Promise.reject(new Error('Workspace is closed'))
    const next = this.queue.then(() => this.run(mode))
    this.queue = next.catch(() => {})
    return next
  }

  private async run(mode: SaveMode) {
    if (this.disposed) return
    // 自动模式：只要还有脏文件就走一次（派生内容要经 prepare 才算出）；
    // 写入范围另由开关决定，未启用的组保持待保存状态。
    if (mode === 'auto' && this.dirtyPaths.size === 0) return
    this.saving = true
    this.error = null
    this.notify()
    let succeeded = false
    let wrote = false
    try {
      const prepared = this.options.prepare?.([...this.dirtyPaths], mode) ?? []
      this.applyChanges(prepared)
      const paths = mode === 'manual'
        ? new Set([...this.desired.keys(), ...this.dirtyPaths])
        : new Set(this.autoEligible())
      const changes = [...paths].map(path => ({ path, content: this.desired.get(path) ?? null }))
      if (changes.length > 0) {
        wrote = true
        const result = await this.writer.save(changes, mode)
        const saved = new Set(result.savedPaths)
        for (const change of changes) {
          if (!saved.has(change.path)) continue
          if (change.content === null) this.baseline.delete(change.path)
          else this.baseline.set(change.path, change.content)
          this.reconcile(change.path)
        }
        if (result.error !== undefined) throw result.error
        if (result.savedPaths.length !== changes.length) throw new Error('Incomplete workspace save')
      }
      succeeded = true
    } catch (error) {
      this.error = error
      throw error
    } finally {
      this.saving = false
      this.notify()
      // 只有真正写出过内容才继续排下一次：否则「文档待保存 + 仅同步 SQL」会空转
      if (succeeded && wrote) this.schedule()
    }
  }
}
