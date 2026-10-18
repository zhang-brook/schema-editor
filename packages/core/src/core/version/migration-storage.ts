/**
 * Migration on-disk read/write layer.
 *
 * Storage: migrations/<id>.json.
 */
import {
  getMigrationsDir,
  getMigrationFileHandle,
} from '../workspace/paths'
import { readJsonFile, writeJsonFile, removeEntry } from '../workspace/handles'
import type { Migration } from './types'

const MIGRATION_FILE_SUFFIX = '.json'

/** Normalize: tolerate early migration files that lack a renames field */
function normalize(data: Migration): Migration {
  if (!Array.isArray(data.renames)) data.renames = []
  return data
}

/** List all migration summaries (ascending by update time) */
export async function listMigrations(
  rootHandle: FileSystemDirectoryHandle,
): Promise<Migration[]> {
  let dir: FileSystemDirectoryHandle
  try {
    dir = await getMigrationsDir(rootHandle, false)
  } catch {
    return []
  }
  const result: Migration[] = []
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file') continue
    if (!entry.name.endsWith(MIGRATION_FILE_SUFFIX)) continue
    try {
      const data = await readJsonFile<Migration>(entry as FileSystemFileHandle)
      if (!data?.id) continue
      result.push(normalize(data))
    } catch {
      // Skip corrupted entries
    }
  }
  result.sort((a, b) => a.updated_at.localeCompare(b.updated_at))
  return result
}

// export async function readMigration(
//   rootHandle: FileSystemDirectoryHandle,
//   id: string,
// ): Promise<Migration | null> {
//   try {
//     const dir = await getMigrationsDir(rootHandle, false)
//     const handle = await getMigrationFileHandle(dir, id, false)
//     const data = await readJsonFile<Migration>(handle)
//     return data ? normalize(data) : null
//   } catch {
//     return null
//   }
// }

export async function writeMigration(
  rootHandle: FileSystemDirectoryHandle,
  migration: Migration,
): Promise<void> {
  const dir = await getMigrationsDir(rootHandle)
  const handle = await getMigrationFileHandle(dir, migration.id)
  await writeJsonFile(handle, JSON.parse(JSON.stringify(migration)))
}

export async function deleteMigration(
  rootHandle: FileSystemDirectoryHandle,
  id: string,
): Promise<void> {
  try {
    const dir = await getMigrationsDir(rootHandle, false)
    await removeEntry(dir, `${id}${MIGRATION_FILE_SUFFIX}`)
  } catch {
    // Ignore if it no longer exists
  }
}
