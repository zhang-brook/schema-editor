import { describe, expect, it, vi } from 'vitest'
import { BrowserWorkspaceWriter, WorkspaceConflictError } from './browser-workspace'

function memoryDisk(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial))
  const directories = new Set([''])
  for (const path of files.keys()) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'))
  }
  const operation = vi.fn<(operation: string, path: string) => void>()
  const missing = () => new DOMException('Missing', 'NotFoundError')
  const fileHandle = (path: string) => ({
    kind: 'file', name: path.split('/').at(-1),
    async getFile() {
      operation('read', path)
      if (!files.has(path)) throw missing()
      return { text: async () => files.get(path)! }
    },
    async createWritable() {
      operation('open', path)
      let buffer = ''
      return {
        async write(content: string) { operation('write', path); buffer = content },
        async close() { operation('close', path); files.set(path, buffer) },
        async abort() { operation('abort', path) },
      }
    },
  })
  const directory = (prefix: string): unknown => ({
    kind: 'directory', name: prefix.split('/').at(-1),
    async getDirectoryHandle(name: string, { create = false } = {}) {
      const path = prefix ? `${prefix}/${name}` : name
      if (files.has(path)) throw new DOMException('File', 'TypeMismatchError')
      if (!directories.has(path)) {
        if (!create) throw missing()
        directories.add(path)
      }
      return directory(path)
    },
    async getFileHandle(name: string, { create = false } = {}) {
      const path = prefix ? `${prefix}/${name}` : name
      if (directories.has(path)) throw new DOMException('Directory', 'TypeMismatchError')
      if (!files.has(path)) {
        if (!create) throw missing()
        files.set(path, '')
      }
      return fileHandle(path)
    },
    async removeEntry(name: string) {
      const path = prefix ? `${prefix}/${name}` : name
      operation('remove', path)
      if (files.has(path)) { files.delete(path); return }
      if (!directories.has(path)) throw missing()
      if ([...files.keys(), ...directories].some(p => p.startsWith(`${path}/`))) {
        throw new DOMException('Not empty', 'InvalidModificationError')
      }
      directories.delete(path)
    },
    async *values() {
      operation('list', prefix)
      const parent = prefix ? `${prefix}/` : ''
      for (const path of directories) {
        if (path !== prefix && path.startsWith(parent) && !path.slice(parent.length).includes('/')) yield directory(path)
      }
      for (const path of files.keys()) {
        if (path.startsWith(parent) && !path.slice(parent.length).includes('/')) yield fileHandle(path)
      }
    },
  })
  return { files, directories, operation, root: directory('') as FileSystemDirectoryHandle }
}

describe('BrowserWorkspaceWriter', () => {
  it('loads existing files, treats missing paths as absent and lists nested files', async () => {
    const disk = memoryDisk({ 'current/a.json': 'a', 'current/t/b.json': 'b' })
    const writer = new BrowserWorkspaceWriter(disk.root)
    expect(await writer.load(['current/a.json', 'missing.json'])).toEqual(new Map([['current/a.json', 'a']]))
    expect((await writer.listFiles('current')).sort()).toEqual(['current/a.json', 'current/t/b.json'])
    expect(await writer.listFiles('missing')).toEqual([])
  })

  it('writes and closes only changed files, without scanning unrelated directories', async () => {
    const disk = memoryDisk({ 'current/a.json': 'a', 'current/b.json': 'b' })
    const writer = new BrowserWorkspaceWriter(disk.root)
    await writer.load(['current/a.json', 'current/b.json'])
    disk.operation.mockClear()
    expect(await writer.save([{ path: 'current/a.json', content: 'new' }])).toEqual({ savedPaths: ['current/a.json'] })
    expect(disk.files.get('current/a.json')).toBe('new')
    expect(disk.operation.mock.calls).toEqual([
      ['read', 'current/a.json'], ['open', 'current/a.json'], ['write', 'current/a.json'], ['close', 'current/a.json'],
    ])
  })

  it('creates parent directories and tracks subsequent edits to a new file', async () => {
    const disk = memoryDisk()
    const writer = new BrowserWorkspaceWriter(disk.root)
    await writer.save([{ path: 'current/schemas/public/users/table.json', content: '{}' }])
    expect(disk.files.get('current/schemas/public/users/table.json')).toBe('{}')
    expect(await writer.save([{ path: 'current/schemas/public/users/table.json', content: '{"name":"users"}' }]))
      .toEqual({ savedPaths: ['current/schemas/public/users/table.json'] })
  })

  it('detects content that changed outside the tracked snapshot', async () => {
    const disk = memoryDisk({ 'a.json': 'a', 'b.json': 'b' })
    const writer = new BrowserWorkspaceWriter(disk.root)
    await writer.load(['a.json'])
    expect(await writer.hasExternalChanges(['a.json'])).toBe(false)
    expect(await writer.hasExternalChanges(['a.json', 'missing.json'])).toBe(false)
    disk.files.set('a.json', 'external')
    disk.files.set('missing.json', 'created')
    expect(await writer.hasExternalChanges(['a.json', 'missing.json'])).toBe(true)
    await writer.save([{ path: 'a.json', content: 'external' }, { path: 'missing.json', content: 'created' }])
    expect(await writer.hasExternalChanges(['a.json', 'missing.json'])).toBe(false)
    disk.files.delete('missing.json')
    expect(await writer.hasExternalChanges(['a.json', 'missing.json'])).toBe(true)
  })

  it('rejects external edits before any operation in the batch is written', async () => {
    const disk = memoryDisk({ 'a.json': 'a', 'b.json': 'b' })
    const writer = new BrowserWorkspaceWriter(disk.root)
    await writer.load(['a.json', 'b.json'])
    disk.files.set('b.json', 'external')
    const result = await writer.save([{ path: 'a.json', content: 'new a' }, { path: 'b.json', content: 'new b' }])
    expect(result.savedPaths).toEqual([])
    expect(result.error).toBeInstanceOf(WorkspaceConflictError)
    expect(disk.files.get('a.json')).toBe('a')
    expect(disk.files.get('b.json')).toBe('external')
  })

  it('does not overwrite an unknown file at a newly requested path', async () => {
    const disk = memoryDisk({ 'unknown.json': 'user data' })
    const writer = new BrowserWorkspaceWriter(disk.root)
    const result = await writer.save([{ path: 'unknown.json', content: '{}' }])
    expect(result.error).toBeInstanceOf(WorkspaceConflictError)
    expect(disk.files.get('unknown.json')).toBe('user data')
  })

  it('accepts an idempotent retry if the requested content is already on disk', async () => {
    const disk = memoryDisk({ 'a.json': 'a' })
    const writer = new BrowserWorkspaceWriter(disk.root)
    await writer.load(['a.json'])
    disk.files.set('a.json', 'new')
    expect(await writer.save([{ path: 'a.json', content: 'new' }])).toEqual({ savedPaths: ['a.json'] })
  })

  it('writes rename destinations before removing sources and preserves unrelated files', async () => {
    const disk = memoryDisk({ 'old/table.json': '{}', 'old/notes.txt': 'keep' })
    const writer = new BrowserWorkspaceWriter(disk.root)
    await writer.load(['old/table.json'])
    await writer.save([{ path: 'old/table.json', content: null }, { path: 'new/table.json', content: '{}' }])
    expect(disk.files.get('new/table.json')).toBe('{}')
    expect(disk.files.has('old/table.json')).toBe(false)
    expect(disk.files.get('old/notes.txt')).toBe('keep')
    const calls = disk.operation.mock.calls
    expect(calls.findIndex(([op]) => op === 'close')).toBeLessThan(calls.findIndex(([op]) => op === 'remove'))
  })

  it('removes only empty parents after a file deletion', async () => {
    const disk = memoryDisk({ 'current/public/users/table.json': '{}', 'current/public/schema.json': '{}' })
    const writer = new BrowserWorkspaceWriter(disk.root)
    await writer.load(['current/public/users/table.json'])
    await writer.save([{ path: 'current/public/users/table.json', content: null }])
    expect(disk.directories.has('current/public/users')).toBe(false)
    expect(disk.directories.has('current/public')).toBe(true)
    expect(disk.files.get('current/public/schema.json')).toBe('{}')
  })

  it('does not delete source files if writing a rename destination fails', async () => {
    const disk = memoryDisk({ 'old/table.json': '{}' })
    const writer = new BrowserWorkspaceWriter(disk.root)
    await writer.load(['old/table.json'])
    disk.operation.mockImplementation((op, path) => { if (op === 'write' && path === 'new/table.json') throw new Error('disk full') })
    const result = await writer.save([{ path: 'old/table.json', content: null }, { path: 'new/table.json', content: 'new' }])
    expect(result.savedPaths).toEqual([])
    expect(result.error).toBeInstanceOf(Error)
    expect(disk.files.get('old/table.json')).toBe('{}')
    expect(disk.operation).toHaveBeenCalledWith('abort', 'new/table.json')
    disk.operation.mockReset()
    const retry = await writer.save([{ path: 'old/table.json', content: null }, { path: 'new/table.json', content: 'new' }])
    expect(retry.error).toBeUndefined()
    expect(disk.files.get('new/table.json')).toBe('new')
  })

  it('acknowledges completed files but not a failed close, then allows retry', async () => {
    const disk = memoryDisk({ 'a.json': 'a', 'b.json': 'b' })
    const writer = new BrowserWorkspaceWriter(disk.root)
    await writer.load(['a.json', 'b.json'])
    disk.operation.mockImplementation((op, path) => { if (op === 'close' && path === 'b.json') throw new Error('permission denied') })
    const result = await writer.save([{ path: 'a.json', content: 'new a' }, { path: 'b.json', content: 'new b' }])
    expect(result.savedPaths).toEqual(['a.json'])
    expect(disk.files.get('a.json')).toBe('new a')
    expect(disk.files.get('b.json')).toBe('b')
    disk.operation.mockReset()
    expect(await writer.save([{ path: 'b.json', content: 'new b' }])).toEqual({ savedPaths: ['b.json'] })
  })

  it('propagates read and delete permission errors rather than treating them as missing files', async () => {
    const disk = memoryDisk({ 'a.json': 'a' })
    const writer = new BrowserWorkspaceWriter(disk.root)
    await writer.load(['a.json'])
    disk.operation.mockImplementation(op => { if (op === 'read') throw new DOMException('Denied', 'NotAllowedError') })
    await expect(writer.read('a.json')).rejects.toMatchObject({ name: 'NotAllowedError' })
    disk.operation.mockImplementation(op => { if (op === 'remove') throw new DOMException('Denied', 'NotAllowedError') })
    expect((await writer.save([{ path: 'a.json', content: null }])).error).toMatchObject({ name: 'NotAllowedError' })
    expect(disk.files.get('a.json')).toBe('a')
  })

  it.each(['', '/absolute.json', '../escape.json', 'a/../b.json', 'a/./b.json', 'a//b.json', 'a\\b.json'])('rejects unsafe relative path %s', async path => {
    const disk = memoryDisk()
    const writer = new BrowserWorkspaceWriter(disk.root)
    expect((await writer.save([{ path, content: '{}' }])).error).toBeInstanceOf(Error)
    expect(disk.files.size).toBe(0)
  })

  it('retains the original root while another workspace is open', async () => {
    const first = memoryDisk({ 'a.json': 'first' })
    const second = memoryDisk({ 'a.json': 'second' })
    const firstWriter = new BrowserWorkspaceWriter(first.root)
    const secondWriter = new BrowserWorkspaceWriter(second.root)
    await Promise.all([firstWriter.load(['a.json']), secondWriter.load(['a.json'])])
    await firstWriter.save([{ path: 'a.json', content: 'saved first' }])
    expect(first.files.get('a.json')).toBe('saved first')
    expect(second.files.get('a.json')).toBe('second')
  })
})
