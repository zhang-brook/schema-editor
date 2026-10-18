/**
 * File System Access API shim for the desktop shell.
 *
 * The renderer process in the desktop shell obtains the file system bridge via
 * `window.schemaEditorDesktop`. Here a "path" is wrapped in the same method set
 * as browser handles (getDirectoryHandle / getFileHandle / values /
 * createWritable / removeEntry), so the existing read/write, structure upgrade
 * and external change detection logic under core/workspace runs unchanged.
 */
import type { DesktopBridge, DesktopFsErrorCode, DesktopFsResult } from 'schema-editor-bridge'

function notFoundError(): DOMException {
  return new DOMException('The requested file or directory could not be found.', 'NotFoundError')
}

function typeMismatchError(): DOMException {
  return new DOMException('A file or directory with the requested kind was not found.', 'TypeMismatchError')
}

function unwrap<T>(result: DesktopFsResult<T>): T {
  if (result.ok) return result.value
  switch (result.code as DesktopFsErrorCode) {
    case 'ENOENT':
      throw notFoundError()
    case 'EISDIR':
    case 'ENOTEMPTY':
    case 'EPERM':
      throw new DOMException('The directory is not empty.', 'InvalidModificationError')
    case 'EACCES':
      throw new DOMException('Permission denied.', 'NotAllowedError')
    default:
      throw new DOMException('Unexpected file system error.', 'UnknownError')
  }
}

function entryName(path: string): string {
  return path.split('/').at(-1) ?? path
}

export class DesktopFileHandle {
  readonly kind = 'file'
  readonly name: string

  constructor(
    private readonly bridge: DesktopBridge,
    readonly path: string,
  ) {
    this.name = entryName(path)
  }

  /** Returns a snapshot of the current content; only text(), which the read path actually uses, is implemented */
  async getFile(): Promise<File> {
    const text = unwrap(await this.bridge.readText(this.path))
    return { name: this.name, text: async () => text } as unknown as File
  }

  /** Content is buffered in memory and written once on close; abort discards the buffer */
  async createWritable(): Promise<FileSystemWritableFileStream> {
    let content: string | null = null
    const { bridge, path } = this
    return {
      async write(data: string) {
        content = String(data)
      },
      async close() {
        unwrap(await bridge.writeText(path, content ?? ''))
      },
      async abort() {
        content = null
      },
    } as unknown as FileSystemWritableFileStream
  }
}

export class DesktopDirectoryHandle {
  readonly kind = 'directory'
  readonly name: string

  constructor(
    private readonly bridge: DesktopBridge,
    readonly path: string,
  ) {
    this.name = entryName(path)
  }

  private child(name: string): string {
    return `${this.path}/${name}`
  }

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<DesktopDirectoryHandle> {
    const path = this.child(name)
    const kind = unwrap(await this.bridge.statKind(path))
    if (kind === 'file') throw typeMismatchError()
    if (kind === null) {
      if (options.create !== true) throw notFoundError()
      unwrap(await this.bridge.ensureDir(path))
    }
    return new DesktopDirectoryHandle(this.bridge, path)
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<DesktopFileHandle> {
    const path = this.child(name)
    const kind = unwrap(await this.bridge.statKind(path))
    if (kind === 'directory') throw typeMismatchError()
    if (kind === null) {
      if (options.create !== true) throw notFoundError()
      // Matches browser semantics: create immediately produces an empty file
      unwrap(await this.bridge.writeText(path, ''))
    }
    return new DesktopFileHandle(this.bridge, path)
  }

  async removeEntry(name: string, options: { recursive?: boolean } = {}): Promise<void> {
    unwrap(await this.bridge.remove(this.child(name), options.recursive === true))
  }

  async *values(): AsyncGenerator<DesktopFileHandle | DesktopDirectoryHandle> {
    for (const entry of unwrap(await this.bridge.readDir(this.path))) {
      const path = this.child(entry.name)
      yield entry.kind === 'file'
        ? new DesktopFileHandle(this.bridge, path)
        : new DesktopDirectoryHandle(this.bridge, path)
    }
  }
}

/** Desktop implementation of FileSystemObserver: events come from fs.watch in the main process */
export class DesktopFileSystemObserver implements FileSystemObserver {
  private id: number | null = null

  constructor(
    private readonly bridge: DesktopBridge,
    private readonly callback: (records: FileSystemObserverRecord[], observer: FileSystemObserver) => void,
  ) {}

  async observe(handle: FileSystemHandle, _options?: { recursive?: boolean }): Promise<void> {
    const path = (handle as { path?: string }).path
    if (!path) throw new Error('DesktopFileSystemObserver can only observe handles created by the desktop picker')
    this.id = unwrap(await this.bridge.watchStart(path))
    const id = this.id
    this.bridge.setWatchHandler((event) => {
      if (event.id !== id) return
      const record = {
        type: 'modified',
        relativePathComponents: event.relativePath.split('/').filter(component => component.length > 0),
      } as unknown as FileSystemObserverRecord
      this.callback([record], this)
    })
  }

  disconnect(): void {
    if (this.id === null) return
    void this.bridge.watchStop(this.id)
    this.id = null
  }
}

/** Installs the desktop bridge as a File System Access shim on window (desktop only) */
export function installDesktopFsa(bridge: DesktopBridge, target: Window = window): void {
  target.showDirectoryPicker = async () => {
    const path = await bridge.pickDirectory()
    if (!path) throw new DOMException('The user aborted a request.', 'AbortError')
    return new DesktopDirectoryHandle(bridge, path) as unknown as FileSystemDirectoryHandle
  }

  target.FileSystemObserver = class extends DesktopFileSystemObserver {
    constructor(callback: (records: FileSystemObserverRecord[], observer: FileSystemObserver) => void) {
      super(bridge, callback)
    }
  }
}
