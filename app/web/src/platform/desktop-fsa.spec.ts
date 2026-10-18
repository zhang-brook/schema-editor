import { describe, expect, it } from 'vitest'
import type {
  DesktopBridge,
  DesktopDirEntry,
  DesktopEntryKind,
  DesktopFsErrorCode,
  DesktopFsResult,
  DesktopWatchEvent,
} from 'schema-editor-bridge'
import { DesktopDirectoryHandle, DesktopFileSystemObserver, installDesktopFsa } from './desktop-fsa'
import { BrowserWorkspaceWriter } from 'schema-editor-core/core/workspace/browser-workspace'

const ROOT = '/proj'

function memoryBridge(files: Record<string, string> = {}) {
  const fileMap = new Map(Object.entries(files).map(([path, content]) => [`${ROOT}/${path}`, content]))
  const directories = new Set([ROOT])
  for (const path of fileMap.keys()) {
    const parts = path.split('/')
    for (let i = 2; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'))
  }

  function ok<T>(value: T): DesktopFsResult<T> {
    return { ok: true, value }
  }
  function fail(code: DesktopFsErrorCode): DesktopFsResult<never> {
    return { ok: false, code }
  }

  let watchHandler: ((event: DesktopWatchEvent) => void) | null = null
  const startedWatches: string[] = []
  const stoppedWatches: number[] = []
  let nextWatchId = 0

  const bridge: DesktopBridge = {
    async pickDirectory() {
      return ROOT
    },
    async readDir(path) {
      if (!directories.has(path)) return fail('ENOENT')
      const prefix = `${path}/`
      const entries: DesktopDirEntry[] = []
      for (const child of [...directories, ...fileMap.keys()]) {
        if (!child.startsWith(prefix)) continue
        const rest = child.slice(prefix.length)
        if (!rest || rest.includes('/')) continue
        entries.push({ name: rest, kind: fileMap.has(child) ? 'file' : 'directory' })
      }
      return ok(entries)
    },
    async statKind(path) {
      if (fileMap.has(path)) return ok<DesktopEntryKind>('file')
      if (directories.has(path)) return ok<DesktopEntryKind>('directory')
      return ok<DesktopEntryKind | null>(null)
    },
    async ensureDir(path) {
      directories.add(path)
      return ok(null)
    },
    async readText(path) {
      const content = fileMap.get(path)
      return content === undefined ? fail('ENOENT') : ok(content)
    },
    async writeText(path, content) {
      fileMap.set(path, content)
      return ok(null)
    },
    async remove(path, recursive) {
      if (fileMap.has(path)) {
        fileMap.delete(path)
        return ok(null)
      }
      if (!directories.has(path)) return fail('ENOENT')
      const descendants = [...fileMap.keys()].filter(child => child.startsWith(`${path}/`))
      if (descendants.length > 0) {
        if (!recursive) return fail('ENOTEMPTY')
        for (const child of descendants) fileMap.delete(child)
      }
      directories.delete(path)
      return ok(null)
    },
    async watchStart(path) {
      startedWatches.push(path)
      return ok(++nextWatchId)
    },
    async watchStop(id) {
      stoppedWatches.push(id)
      return ok(null)
    },
    setWatchHandler(handler) {
      watchHandler = handler
    },
    // 更新通道与本组用例无关，按未打包运行返回 unsupported
    async getUpdateStatus() {
      return { state: 'unsupported', currentVersion: '0.0.0' }
    },
    async checkUpdate() {
      return { state: 'unsupported', currentVersion: '0.0.0' }
    },
    async installUpdate() {},
    setUpdateHandler() {},
  }

  return {
    bridge,
    files: fileMap,
    directories,
    startedWatches,
    stoppedWatches,
    emit: (event: DesktopWatchEvent) => watchHandler?.(event),
  }
}

describe('DesktopDirectoryHandle / DesktopFileHandle', () => {
  it('以浏览器句柄语义驱动 BrowserWorkspaceWriter 完成读取、列出、写入与删除', async () => {
    const disk = memoryBridge({ 'common.json': '{}', 'current/a.txt': 'a', 'current/public/schema.json': '{}' })
    const root = new DesktopDirectoryHandle(disk.bridge, ROOT)
    const writer = new BrowserWorkspaceWriter(root as unknown as FileSystemDirectoryHandle)

    const loaded = await writer.load(['common.json', 'missing.json'])
    expect(loaded.get('common.json')).toBe('{}')
    expect((await writer.listFiles('current')).sort()).toEqual(['current/a.txt', 'current/public/schema.json'])

    await writer.save([{ path: 'current/schemas/public/users/table.json', content: '{"name":"users"}' }])
    expect(disk.files.get(`${ROOT}/current/schemas/public/users/table.json`)).toBe('{"name":"users"}')

    await writer.save([{ path: 'current/schemas/public/users/table.json', content: null }])
    expect(disk.files.has(`${ROOT}/current/schemas/public/users/table.json`)).toBe(false)
    expect(disk.directories.has(`${ROOT}/current/schemas/public/users`)).toBe(false)
    expect(disk.directories.has(`${ROOT}/current/schemas/public`)).toBe(false)
    expect(disk.directories.has(`${ROOT}/current`)).toBe(true)
  })

  it('缺失路径抛出 NotFoundError，类型不符抛出 TypeMismatchError', async () => {
    const disk = memoryBridge({ 'file.json': '{}' })
    const root = new DesktopDirectoryHandle(disk.bridge, ROOT)
    await expect(root.getFileHandle('missing.json', { create: false })).rejects.toMatchObject({ name: 'NotFoundError' })
    await expect(root.getDirectoryHandle('missing', { create: false })).rejects.toMatchObject({ name: 'NotFoundError' })
    await expect(root.getDirectoryHandle('file.json', { create: false })).rejects.toMatchObject({ name: 'TypeMismatchError' })
    await expect(root.getFileHandle('file.json')).resolves.toMatchObject({ kind: 'file', name: 'file.json' })
  })

  it('create 时立即产生空文件与目录', async () => {
    const disk = memoryBridge()
    const root = new DesktopDirectoryHandle(disk.bridge, ROOT)
    await root.getFileHandle('new.json', { create: true })
    expect(disk.files.get(`${ROOT}/new.json`)).toBe('')
    await root.getDirectoryHandle('sub', { create: true })
    expect(disk.directories.has(`${ROOT}/sub`)).toBe(true)
  })

  it('values() 产出文件与子目录句柄', async () => {
    const disk = memoryBridge({ 'a.json': 'a', 'sub/b.json': 'b' })
    const root = new DesktopDirectoryHandle(disk.bridge, ROOT)
    const entries: string[] = []
    for await (const entry of root.values()) entries.push(`${entry.kind}:${entry.name}`)
    expect(entries.sort()).toEqual(['directory:sub', 'file:a.json'])
  })

  it('写入内容仅在 close 时落盘，abort 丢弃缓冲', async () => {
    const disk = memoryBridge({ 'a.json': 'old' })
    const root = new DesktopDirectoryHandle(disk.bridge, ROOT)
    const handle = await root.getFileHandle('a.json')

    const writable = await handle.createWritable()
    await writable.write('new')
    expect(disk.files.get(`${ROOT}/a.json`)).toBe('old')
    await writable.close()
    expect(disk.files.get(`${ROOT}/a.json`)).toBe('new')

    const discarded = await handle.createWritable()
    await discarded.write('discarded')
    await discarded.abort()
    expect(disk.files.get(`${ROOT}/a.json`)).toBe('new')
  })
})

describe('DesktopFileSystemObserver', () => {
  it('向桥接注册监听，事件映射为相对路径记录，disconnect 后注销', async () => {
    const disk = memoryBridge()
    const root = new DesktopDirectoryHandle(disk.bridge, ROOT)
    const records: FileSystemObserverRecord[][] = []
    const observer = new DesktopFileSystemObserver(disk.bridge, (incoming) => {
      records.push(incoming)
    })

    await observer.observe(root as unknown as FileSystemHandle, { recursive: true })
    expect(disk.startedWatches).toEqual([ROOT])

    disk.emit({ id: 1, relativePath: 'current/schemas/public/users/table.json' })
    expect(records).toHaveLength(1)
    expect(records[0]![0]!.relativePathComponents).toEqual(['current', 'schemas', 'public', 'users', 'table.json'])

    disk.emit({ id: 2, relativePath: 'other.json' })
    expect(records).toHaveLength(1)

    observer.disconnect()
    expect(disk.stoppedWatches).toEqual([1])
  })
})

describe('installDesktopFsa', () => {
  it('安装 showDirectoryPicker 与 FileSystemObserver，取消选择抛出 AbortError', async () => {
    const disk = memoryBridge()
    const target = {} as Window
    installDesktopFsa(disk.bridge, target)

    expect(typeof target.showDirectoryPicker).toBe('function')
    expect(typeof target.FileSystemObserver).toBe('function')

    const handle = await target.showDirectoryPicker()
    expect((handle as unknown as DesktopDirectoryHandle).path).toBe(ROOT)

    disk.bridge.pickDirectory = async () => null
    await expect(target.showDirectoryPicker()).rejects.toMatchObject({ name: 'AbortError' })
  })
})
