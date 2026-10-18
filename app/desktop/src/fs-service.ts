import { promises as fs, watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import type {
  DesktopDirEntry,
  DesktopEntryKind,
  DesktopFsErrorCode,
  DesktopFsResult,
  DesktopWatchEvent,
} from 'schema-editor-bridge'

function toErrorCode(error: unknown): DesktopFsErrorCode {
  const code = (error as { code?: unknown } | null)?.code
  // Node reports ERR_FS_EISDIR for rm on a directory without recursive; normalize it to EISDIR
  if (code === 'ERR_FS_EISDIR') return 'EISDIR'
  if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTEMPTY' || code === 'EPERM' || code === 'EACCES') {
    return code
  }
  return 'UNKNOWN'
}

function ok<T>(value: T): DesktopFsResult<T> {
  return { ok: true, value }
}

function fail<T = never>(code: DesktopFsErrorCode): DesktopFsResult<T> {
  return { ok: false, code }
}

/**
 * Main-process filesystem service: all operations are confined to project roots the user opened
 * through the directory picker. Depends only on node:fs, so it can be tested without Electron.
 */
export function createFsService() {
  const allowedRoots = new Set<string>()
  const watchers = new Map<number, FSWatcher>()
  let nextWatcherId = 1

  /** Record a project root returned by the native picker and return its resolved path */
  function allowRoot(root: string): string {
    const resolved = path.resolve(root)
    allowedRoots.add(resolved)
    return resolved
  }

  /** Return null when the path is not inside any authorized root */
  function resolveInsideRoot(target: string): string | null {
    if (typeof target !== 'string' || target.length === 0) return null
    const resolved = path.resolve(target)
    for (const root of allowedRoots) {
      if (resolved === root || resolved.startsWith(root + path.sep)) return resolved
    }
    return null
  }

  async function readDir(target: string): Promise<DesktopFsResult<DesktopDirEntry[]>> {
    const resolved = resolveInsideRoot(target)
    if (!resolved) return fail('EACCES')
    try {
      const entries = await fs.readdir(resolved, { withFileTypes: true })
      return ok(
        entries
          .filter(entry => entry.isFile() || entry.isDirectory())
          .map((entry): DesktopDirEntry => ({ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' })),
      )
    } catch (error) {
      return fail(toErrorCode(error))
    }
  }

  async function statKind(target: string): Promise<DesktopFsResult<DesktopEntryKind | null>> {
    const resolved = resolveInsideRoot(target)
    if (!resolved) return fail('EACCES')
    try {
      const stats = await fs.stat(resolved)
      if (stats.isDirectory()) return ok('directory')
      if (stats.isFile()) return ok('file')
      return ok(null)
    } catch (error) {
      const code = toErrorCode(error)
      return code === 'ENOENT' ? ok(null) : fail(code)
    }
  }

  async function ensureDir(target: string): Promise<DesktopFsResult<null>> {
    const resolved = resolveInsideRoot(target)
    if (!resolved) return fail('EACCES')
    try {
      await fs.mkdir(resolved, { recursive: true })
      return ok(null)
    } catch (error) {
      return fail(toErrorCode(error))
    }
  }

  async function readText(target: string): Promise<DesktopFsResult<string>> {
    const resolved = resolveInsideRoot(target)
    if (!resolved) return fail('EACCES')
    try {
      return ok(await fs.readFile(resolved, 'utf8'))
    } catch (error) {
      return fail(toErrorCode(error))
    }
  }

  async function writeText(target: string, content: string): Promise<DesktopFsResult<null>> {
    const resolved = resolveInsideRoot(target)
    if (!resolved) return fail('EACCES')
    if (typeof content !== 'string') return fail('UNKNOWN')
    try {
      await fs.writeFile(resolved, content, 'utf8')
      return ok(null)
    } catch (error) {
      return fail(toErrorCode(error))
    }
  }

  async function remove(target: string, recursive: boolean): Promise<DesktopFsResult<null>> {
    const resolved = resolveInsideRoot(target)
    if (!resolved) return fail('EACCES')
    try {
      if (recursive) {
        await fs.rm(resolved, { recursive: true, force: false })
      } else {
        // On Windows non-recursive fs.rm on a directory reports ERR_FS_EISDIR; unlink/rmdir by kind
        const stats = await fs.lstat(resolved)
        if (stats.isDirectory()) await fs.rmdir(resolved)
        else await fs.unlink(resolved)
      }
      return ok(null)
    } catch (error) {
      return fail(toErrorCode(error))
    }
  }

  /** Watch a directory recursively; events carry paths relative to it ('/'-separated) */
  async function watchStart(
    target: string,
    onEvent: (event: DesktopWatchEvent) => void,
  ): Promise<DesktopFsResult<number>> {
    const resolved = resolveInsideRoot(target)
    if (!resolved) return fail('EACCES')
    const id = nextWatcherId++
    try {
      const watcher = watch(resolved, { recursive: true }, (_event, filename) => {
        if (!filename) return
        onEvent({ id, relativePath: String(filename).split(path.sep).join('/') })
      })
      watcher.on('error', () => {
        watcher.close()
        watchers.delete(id)
      })
      watchers.set(id, watcher)
      return ok(id)
    } catch (error) {
      return fail(toErrorCode(error))
    }
  }

  async function watchStop(id: number): Promise<DesktopFsResult<null>> {
    watchers.get(id)?.close()
    watchers.delete(id)
    return ok(null)
  }

  return { allowRoot, readDir, statKind, ensureDir, readText, writeText, remove, watchStart, watchStop }
}
