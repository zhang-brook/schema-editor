/**
 * 桌面端的 File System Access API 模拟层。
 *
 * 桌面外壳中的渲染进程通过 `window.schemaEditorDesktop` 拿到文件系统桥接，
 * 这里把「路径」包装成与浏览器句柄相同的方法集合（getDirectoryHandle /
 * getFileHandle / values / createWritable / removeEntry），使 core/workspace
 * 下的既有读写、结构升级、外部变更检测逻辑零改动运行。
 */
import type { DesktopBridge, DesktopFsErrorCode, DesktopFsResult } from './bridge'

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

  /** 返回当前内容的快照，只实现读写链路实际用到的 text() */
  async getFile(): Promise<File> {
    const text = unwrap(await this.bridge.readText(this.path))
    return { name: this.name, text: async () => text } as unknown as File
  }

  /** 内容先缓存在内存，close 时一次性写入；abort 丢弃缓冲 */
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
      // 与浏览器语义一致：create 时立即产生空文件
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

/** FileSystemObserver 的桌面实现：事件来自主进程的 fs.watch */
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

/** 把桌面桥接安装为 window 上的 File System Access 模拟实现（仅桌面端调用） */
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
