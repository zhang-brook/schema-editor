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
  // Node 对「用 rm 删除目录但未开 recursive」报 ERR_FS_EISDIR，这里归一化为 EISDIR
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
 * 主进程文件系统服务：所有操作限定在用户通过目录选择器打开的项目根目录内。
 * 只依赖 node:fs，可在无 Electron 环境下测试。
 */
export function createFsService() {
  const allowedRoots = new Set<string>()
  const watchers = new Map<number, FSWatcher>()
  let nextWatcherId = 1

  /** 记录原生选择器返回的项目根目录，返回规范化路径 */
  function allowRoot(root: string): string {
    const resolved = path.resolve(root)
    allowedRoots.add(resolved)
    return resolved
  }

  /** 路径不在任何已授权根目录内时返回 null */
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
        // Windows 上 fs.rm 非递归删除目录会报 ERR_FS_EISDIR，需按类型分别 unlink/rmdir
        const stats = await fs.lstat(resolved)
        if (stats.isDirectory()) await fs.rmdir(resolved)
        else await fs.unlink(resolved)
      }
      return ok(null)
    } catch (error) {
      return fail(toErrorCode(error))
    }
  }

  /** 递归监听目录，事件携带相对被监听目录的路径（'/' 分隔） */
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
