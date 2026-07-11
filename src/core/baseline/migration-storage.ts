/**
 * 迁移脚本(migration)磁盘读写层。
 *
 * 存储：migrations/<id>.json。
 */
import {
  getMigrationsDir,
  getMigrationFileHandle,
} from '@/core/workspace/paths'
import { readJsonFile, writeJsonFile, removeEntry } from '@/core/workspace/handles'
import type { Migration } from './types'

const MIGRATION_FILE_SUFFIX = '.json'

/** 列出所有迁移摘要（按更新时间升序） */
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
      result.push(data)
    } catch {
      // 损坏跳过
    }
  }
  result.sort((a, b) => a.updated_at.localeCompare(b.updated_at))
  return result
}

export async function readMigration(
  rootHandle: FileSystemDirectoryHandle,
  id: string,
): Promise<Migration | null> {
  try {
    const dir = await getMigrationsDir(rootHandle, false)
    const handle = await getMigrationFileHandle(dir, id, false)
    const data = await readJsonFile<Migration>(handle)
    return data ?? null
  } catch {
    return null
  }
}

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
    // 已不存在忽略
  }
}
