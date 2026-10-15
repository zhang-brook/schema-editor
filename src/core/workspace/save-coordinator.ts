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

export interface SaveCoordinatorOptions {
  writer: WorkspaceWriter
  initialFiles: ReadonlyMap<string, string>
  autoSave?: boolean
  delay?: number
  maxWait?: number
  prepare?: (changedPaths: readonly string[], mode: SaveMode) => readonly FileChange[]
  onStateChange?: (state: SaveState) => void
}

export class SaveCoordinator {
  private readonly desired: Map<string, string>
  private readonly baseline: Map<string, string>
  private readonly dirtyPaths = new Set<string>()
  private readonly writer: WorkspaceWriter
  private readonly options: SaveCoordinatorOptions
  private autoSave: boolean
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
    this.autoSave = (options.autoSave ?? true) && this.writer.supportsAutoSave
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

  update(changes: readonly FileChange[]) {
    if (this.disposed) return
    this.applyChanges(changes)
    this.notify()
    this.schedule()
  }

  setAutoSave(enabled: boolean) {
    this.autoSave = enabled && this.writer.supportsAutoSave
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

  private schedule() {
    if (this.disposed || !this.autoSave || this.saving || this.dirtyPaths.size === 0) {
      if (this.dirtyPaths.size === 0) this.cancelTimers()
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
    if (mode === 'auto' && (!this.autoSave || this.dirtyPaths.size === 0)) return
    this.saving = true
    this.error = null
    this.notify()
    let succeeded = false
    try {
      const prepared = this.options.prepare?.([...this.dirtyPaths], mode) ?? []
      this.applyChanges(prepared)
      const paths = mode === 'manual'
        ? new Set([...this.desired.keys(), ...this.dirtyPaths])
        : new Set(this.dirtyPaths)
      const changes = [...paths].map(path => ({ path, content: this.desired.get(path) ?? null }))
      if (changes.length > 0) {
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
      if (succeeded) this.schedule()
    }
  }
}
