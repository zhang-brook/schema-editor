/**
 * 环境(environment)磁盘读写层。
 *
 * 存储：environments/<id>.json。
 */
import {
  getEnvironmentsDir,
  getEnvironmentFileHandle,
} from '@/core/workspace/paths'
import { readJsonFile, writeJsonFile, removeEntry } from '@/core/workspace/handles'
import type { Environment } from './types'

const ENVIRONMENT_FILE_SUFFIX = '.json'

/** 列出所有环境（按创建时间升序） */
export async function listEnvironments(
  rootHandle: FileSystemDirectoryHandle,
): Promise<Environment[]> {
  let dir: FileSystemDirectoryHandle
  try {
    dir = await getEnvironmentsDir(rootHandle, false)
  } catch {
    return []
  }
  const result: Environment[] = []
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file') continue
    if (!entry.name.endsWith(ENVIRONMENT_FILE_SUFFIX)) continue
    try {
      const data = await readJsonFile<Environment>(entry as FileSystemFileHandle)
      if (!data?.id) continue
      result.push(data)
    } catch {
      // 损坏跳过
    }
  }
  result.sort((a, b) => a.created_at.localeCompare(b.created_at))
  return result
}

export async function writeEnvironment(
  rootHandle: FileSystemDirectoryHandle,
  environment: Environment,
): Promise<void> {
  const dir = await getEnvironmentsDir(rootHandle)
  const handle = await getEnvironmentFileHandle(dir, environment.id)
  await writeJsonFile(handle, JSON.parse(JSON.stringify(environment)))
}

export async function deleteEnvironment(
  rootHandle: FileSystemDirectoryHandle,
  id: string,
): Promise<void> {
  try {
    const dir = await getEnvironmentsDir(rootHandle, false)
    await removeEntry(dir, `${id}${ENVIRONMENT_FILE_SUFFIX}`)
  } catch {
    // 已不存在忽略
  }
}
