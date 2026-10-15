import type { FileChange, SaveResult, WorkspaceWriter } from './save-coordinator'

export class WorkspaceConflictError extends Error {
  constructor(readonly path: string) {
    super(`File changed outside the editor: ${path}`)
    this.name = 'WorkspaceConflictError'
  }
}

function pathParts(path: string): string[] {
  const parts = path.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || part.includes('\\'))) {
    throw new Error(`Invalid workspace path: ${path}`)
  }
  return parts
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && error.name === 'NotFoundError'
}

export class BrowserWorkspaceWriter implements WorkspaceWriter {
  readonly supportsAutoSave = true
  private readonly expected = new Map<string, string | null>()

  constructor(private readonly root: FileSystemDirectoryHandle) {}

  async load(paths: readonly string[]): Promise<Map<string, string>> {
    const files = new Map<string, string>()
    for (const path of paths) {
      const content = await this.read(path)
      this.expected.set(path, content)
      if (content !== null) files.set(path, content)
    }
    return files
  }

  async read(path: string): Promise<string | null> {
    const parts = pathParts(path)
    try {
      const parent = await this.directory(parts.slice(0, -1), false)
      const handle = await parent.getFileHandle(parts.at(-1)!, { create: false })
      return await (await handle.getFile()).text()
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  async listFiles(directory: string): Promise<string[]> {
    const parts = pathParts(directory)
    let handle: FileSystemDirectoryHandle
    try {
      handle = await this.directory(parts, false)
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    const result: string[] = []
    const visit = async (dir: FileSystemDirectoryHandle, prefix: string) => {
      for await (const entry of dir.values()) {
        const path = `${prefix}/${entry.name}`
        if (entry.kind === 'file') result.push(path)
        else await visit(entry as FileSystemDirectoryHandle, path)
      }
    }
    await visit(handle, directory)
    return result
  }

  async save(changes: readonly FileChange[]): Promise<SaveResult> {
    const savedPaths: string[] = []
    const ordered = [
      ...changes.filter(change => change.content !== null),
      ...changes.filter(change => change.content === null),
    ]
    try {
      // Validate the whole batch before creating new paths or removing old ones.
      for (const change of ordered) {
        const actual = await this.read(change.path)
        if (actual !== (this.expected.get(change.path) ?? null) && actual !== change.content) {
          throw new WorkspaceConflictError(change.path)
        }
      }
      for (const change of ordered) {
        if (change.content === null) await this.remove(change.path)
        else await this.write(change.path, change.content)
        this.expected.set(change.path, change.content)
        savedPaths.push(change.path)
      }
      return { savedPaths }
    } catch (error) {
      return { savedPaths, error }
    }
  }

  private async directory(parts: readonly string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let handle = this.root
    for (const part of parts) handle = await handle.getDirectoryHandle(part, { create })
    return handle
  }

  private async write(path: string, content: string) {
    const parts = pathParts(path)
    const parent = await this.directory(parts.slice(0, -1), true)
    const handle = await parent.getFileHandle(parts.at(-1)!, { create: true })
    if ((this.expected.get(path) ?? null) === null) this.expected.set(path, '')
    const stream = await handle.createWritable()
    try {
      await stream.write(content)
      await stream.close()
    } catch (error) {
      try { await stream.abort() } catch { /* The failed stream may already be closed. */ }
      throw error
    }
  }

  private async remove(path: string) {
    const parts = pathParts(path)
    try {
      const parent = await this.directory(parts.slice(0, -1), false)
      await parent.removeEntry(parts.at(-1)!)
    } catch (error) {
      if (!isMissing(error)) throw error
      return
    }
    for (let depth = parts.length - 1; depth > 0; depth--) {
      const parent = await this.directory(parts.slice(0, depth - 1), false)
      const dir = await parent.getDirectoryHandle(parts[depth - 1]!, { create: false })
      for await (const _entry of dir.values()) return
      await parent.removeEntry(parts[depth - 1]!)
    }
  }
}
