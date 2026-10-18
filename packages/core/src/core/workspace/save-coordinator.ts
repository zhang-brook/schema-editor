export interface FileChange {
  path: string
  content: string | null
}

/** File differences relative to the writer baseline, used by remote writers (Git) to preview pending content */
export interface StagedChange {
  path: string
  kind: 'add' | 'update' | 'delete'
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
 * File grouping: project documents and document-derived files are auto-written under separate switches.
 * - docs: the project's own documents such as common.json / current/… / versions/…
 * - outputs: derived artifacts such as the SQL and AI guide under output/
 */
export type SaveGroup = 'docs' | 'outputs'

export interface AutoSaveOptions {
  /** Write project document changes to disk automatically */
  docs: boolean
  /** Rewrite derived files automatically after project documents change */
  outputs: boolean
}

export interface SaveCoordinatorOptions {
  writer: WorkspaceWriter
  initialFiles: ReadonlyMap<string, string>
  autoSave?: Partial<AutoSaveOptions>
  delay?: number
  maxWait?: number
  prepare?: (changedPaths: readonly string[], mode: SaveMode) => readonly FileChange[]
  /** Path grouping deciding which auto-write switch covers the file; all paths default to docs */
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
    const requested = options.autoSave ?? {}
    const docs = requested.docs ?? true
    this.autoSave = this.gate({ docs, outputs: (requested.outputs ?? true) && docs })
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

  /** Currently effective auto-write switches (both are always false when the writer does not support auto-save) */
  get autoSaveOptions(): AutoSaveOptions {
    return { ...this.autoSave }
  }

  update(changes: readonly FileChange[]) {
    if (this.disposed) return
    this.applyChanges(changes)
    this.notify()
    this.schedule()
  }

  /**
   * Toggle auto-write per group; groups not passed in keep their current state.
   * Derived files depend on project documents: enabling SQL sync also enables project file saving,
   * and disabling project file saving also disables SQL sync, so output/ on disk never gets ahead of the JSON.
   */
  setAutoSave(options: Partial<AutoSaveOptions>) {
    this.autoSave = this.resolveAutoSave({ ...this.autoSave, ...options }, options)
    this.cancelTimers()
    this.schedule()
  }

  saveAll(): Promise<void> {
    return this.enqueue('manual')
  }

  /**
   * Dry-run a manual save: compute all files to write following the run('manual') rules (including derived file rebuilds),
   * but do not call the writer; the Git commit dialog uses this to show the list of pending files.
   */
  previewAll(): FileChange[] {
    const prepared = this.options.prepare?.([...this.dirtyPaths], 'manual') ?? []
    this.applyChanges(prepared)
    this.notify()
    const paths = new Set([...this.desired.keys(), ...this.dirtyPaths])
    return [...paths].map(path => ({ path, content: this.desired.get(path) ?? null }))
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

  /** Both switches are always off when the writer does not support auto-save */
  private gate(options: AutoSaveOptions): AutoSaveOptions {
    return this.writer.supportsAutoSave ? options : { docs: false, outputs: false }
  }

  /** Merge this request with the current switches, enforcing that derived writes depend on document writes */
  private resolveAutoSave(merged: AutoSaveOptions, requested: Partial<AutoSaveOptions> = {}): AutoSaveOptions {
    const next = { ...merged }
    if (requested.outputs === true) next.docs = true
    if (!next.docs) next.outputs = false
    return this.gate(next)
  }

  /** Files that differ from disk and whose current switch allows auto-writing */
  private autoEligible(): string[] {
    return [...this.dirtyPaths].filter(path => this.autoSave[this.classify(path)])
  }

  /**
   * Whether there is work worth handling automatically: files that belong to an enabled group and differ from disk.
   * Derived content is only computed through prepare, but "Syncing SQL always enables project file saving",
   * so a dirty document already hits this check and derived file sync is never missed.
   */
  private hasAutoWork(): boolean {
    return [...this.dirtyPaths].some(path => this.autoSave[this.classify(path)])
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
    // Auto mode: run once whenever there are dirty files (derived content is only computed through prepare);
    // the write scope is decided by the switches, and disabled groups stay pending.
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
      // Reschedule only when content was actually written; otherwise "document pending + SQL sync only" would spin
      if (succeeded && wrote) this.schedule()
    }
  }
}
