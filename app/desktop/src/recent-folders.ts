import { promises as fs } from 'node:fs'
import path from 'node:path'

const MAX_RECENT_FOLDERS = 10

function samePath(a: string, b: string): boolean {
  // Windows paths are case-insensitive
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

export interface RecentFolders {
  /** Recently opened folders, newest first */
  list(): Promise<string[]>
  /** Record an open and return the updated list */
  add(folder: string): Promise<string[]>
  /** Remove from the list and return the updated list */
  remove(folder: string): Promise<string[]>
  mostRecent(): Promise<string | undefined>
}

/**
 * Persistent list of recently opened folders. A missing or corrupted file is treated as
 * an empty list so the directory picker flow is not blocked.
 */
export function createRecentFolders(file: string, max = MAX_RECENT_FOLDERS): RecentFolders {
  let cache: Promise<string[]> | null = null

  async function read(): Promise<string[]> {
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as { folders?: unknown }
      if (!Array.isArray(parsed.folders)) return []
      return parsed.folders.filter((item): item is string => typeof item === 'string' && item.length > 0)
    } catch {
      return []
    }
  }

  function load(): Promise<string[]> {
    cache ??= read()
    return cache
  }

  async function write(folders: string[]): Promise<string[]> {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, `${JSON.stringify({ folders }, null, 2)}\n`, 'utf8')
    cache = Promise.resolve(folders)
    return folders
  }

  async function list(): Promise<string[]> {
    return [...await load()]
  }

  async function add(folder: string): Promise<string[]> {
    const resolved = path.resolve(folder)
    const current = await load()
    return write([resolved, ...current.filter(item => !samePath(item, resolved))].slice(0, max))
  }

  async function remove(folder: string): Promise<string[]> {
    const resolved = path.resolve(folder)
    const current = await load()
    return write(current.filter(item => !samePath(item, resolved)))
  }

  async function mostRecent(): Promise<string | undefined> {
    return (await load())[0]
  }

  return { list, add, remove, mostRecent }
}
