/**
 * 基线(baseline)磁盘读写层。
 *
 * 存储：baselines/<id>.json（单文件完整快照）。
 * 实现纯函数 + FS 原语，不持有任何 reactive 状态，便于在 store 中调用。
 */
import {
  getBaselinesDir,
  getBaselineFileHandle,
} from '@/core/workspace/paths'
import { readJsonFile, writeJsonFile, removeEntry } from '@/core/workspace/handles'
import type { BaselineSnapshot, BaselineSummary } from './types'

/** 基线文件名后缀 */
const BASELINE_FILE_SUFFIX = '.json'

/** 列出所有基线摘要（按创建时间升序，旧的在前） */
export async function listBaselines(
  rootHandle: FileSystemDirectoryHandle,
): Promise<BaselineSummary[]> {
  let baselinesDir: FileSystemDirectoryHandle
  try {
    baselinesDir = await getBaselinesDir(rootHandle, false)
  } catch {
    return []
  }

  const summaries: BaselineSummary[] = []
  for await (const entry of baselinesDir.values()) {
    if (entry.kind !== 'file') continue
    if (!entry.name.endsWith(BASELINE_FILE_SUFFIX)) continue
    try {
      const data = await readJsonFile<BaselineSnapshot>(entry as FileSystemFileHandle)
      if (!data?.id) continue
      summaries.push({ id: data.id, name: data.name, created_at: data.created_at })
    } catch {
      // 损坏的基线文件跳过
    }
  }

  summaries.sort((a, b) => a.created_at.localeCompare(b.created_at))
  return summaries
}

// 避免未使用导入告警（listDirEntries 预留给未来扩展）
void removeEntry

/** 读取单个基线完整快照 */
export async function readBaseline(
  rootHandle: FileSystemDirectoryHandle,
  id: string,
): Promise<BaselineSnapshot | null> {
  try {
    const baselinesDir = await getBaselinesDir(rootHandle, false)
    const handle = await getBaselineFileHandle(baselinesDir, id, false)
    const data = await readJsonFile<BaselineSnapshot>(handle)
    return data ?? null
  } catch {
    return null
  }
}

/** 写入基线快照（深拷贝，避免外部修改影响） */
export async function writeBaseline(
  rootHandle: FileSystemDirectoryHandle,
  snapshot: BaselineSnapshot,
): Promise<void> {
  const baselinesDir = await getBaselinesDir(rootHandle)
  const handle = await getBaselineFileHandle(baselinesDir, snapshot.id)
  await writeJsonFile(handle, JSON.parse(JSON.stringify(snapshot)))
}

/** 删除基线 */
export async function deleteBaseline(
  rootHandle: FileSystemDirectoryHandle,
  id: string,
): Promise<void> {
  try {
    const baselinesDir = await getBaselinesDir(rootHandle, false)
    await removeEntry(baselinesDir, `${id}${BASELINE_FILE_SUFFIX}`)
  } catch {
    // 已不存在则忽略
  }
}
