/**
 * 版本(version)磁盘读写层。
 *
 * 存储：versions/<id>.json（单文件完整快照）。
 * 实现纯函数 + FS 原语，不持有任何 reactive 状态，便于在 store 中调用。
 */
import {
  getVersionsDir,
  getVersionFileHandle,
} from '@/core/workspace/paths'
import { readJsonFile, writeJsonFile, removeEntry } from '@/core/workspace/handles'
import type { VersionSnapshot, VersionSummary } from './types'

/** 版本文件名后缀 */
const VERSION_FILE_SUFFIX = '.json'

/** 列出所有版本摘要（按创建时间升序，旧的在前） */
export async function listVersions(
  rootHandle: FileSystemDirectoryHandle,
): Promise<VersionSummary[]> {
  let versionsDir: FileSystemDirectoryHandle
  try {
    versionsDir = await getVersionsDir(rootHandle, false)
  } catch {
    return []
  }

  const summaries: VersionSummary[] = []
  for await (const entry of versionsDir.values()) {
    if (entry.kind !== 'file') continue
    if (!entry.name.endsWith(VERSION_FILE_SUFFIX)) continue
    try {
      const data = await readJsonFile<VersionSnapshot>(entry as FileSystemFileHandle)
      if (!data?.id) continue
      summaries.push({ id: data.id, name: data.name, created_at: data.created_at })
    } catch {
      // 损坏的版本文件跳过
    }
  }

  summaries.sort((a, b) => a.created_at.localeCompare(b.created_at))
  return summaries
}

// 避免未使用导入告警（listDirEntries 预留给未来扩展）
void removeEntry

/** 读取单个版本完整快照 */
export async function readVersion(
  rootHandle: FileSystemDirectoryHandle,
  id: string,
): Promise<VersionSnapshot | null> {
  try {
    const versionsDir = await getVersionsDir(rootHandle, false)
    const handle = await getVersionFileHandle(versionsDir, id, false)
    const data = await readJsonFile<VersionSnapshot>(handle)
    return data ?? null
  } catch {
    return null
  }
}

/** 写入版本快照（深拷贝，避免外部修改影响） */
export async function writeVersion(
  rootHandle: FileSystemDirectoryHandle,
  snapshot: VersionSnapshot,
): Promise<void> {
  const versionsDir = await getVersionsDir(rootHandle)
  const handle = await getVersionFileHandle(versionsDir, snapshot.id)
  await writeJsonFile(handle, JSON.parse(JSON.stringify(snapshot)))
}

/** 删除版本 */
export async function deleteVersion(
  rootHandle: FileSystemDirectoryHandle,
  id: string,
): Promise<void> {
  try {
    const versionsDir = await getVersionsDir(rootHandle, false)
    await removeEntry(versionsDir, `${id}${VERSION_FILE_SUFFIX}`)
  } catch {
    // 已不存在则忽略
  }
}
