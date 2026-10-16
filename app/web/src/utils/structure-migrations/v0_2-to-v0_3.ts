/**
 * 结构迁移脚本：v0.2 → v0.3（字段级）
 *
 * initial-data JSON 格式迁移：纯数组 [...] → 完整对象格式 { rows: [...] }。
 * 这是字段级迁移（布局不变），使用 readProject/writeProject 范式：
 * 读取旧盘 → 将内存态 initialData 的数组改写成对象 → 写回。
 * schemas 数据无需迁移。
 *
 * 注意：readProject 只会收集「对象格式」的 initial-data；本步骤在写回前
 * 显式把仍为数组格式的条目归一化为对象格式（兼容旧盘上残留的数组文件）。
 */

import { readProject, writeProject } from './structure-io'
import type { InitialData } from '@/types/schema'

/** 将任意旧格式归一化为对象格式 { rows: [...] } */
function normalizeInitialData(raw: unknown): InitialData {
  if (Array.isArray(raw)) return { rows: raw } as InitialData
  return (raw ?? { rows: [] }) as InitialData
}

/** 执行 v0.2 → v0.3 迁移 */
export async function migrate(rootHandle: FileSystemDirectoryHandle): Promise<void> {
  const data = await readProject(rootHandle, '0.2')

  // 兜底：若内存态中存在数组格式的 initialData（readProject 已过滤，这里为保险再处理一次）
  for (const [key, value] of data.initialData) {
    if (Array.isArray(value)) {
      data.initialData.set(key, normalizeInitialData(value))
    }
  }

  // 推进版本号并写回（覆盖写回，布局不变，不删文件）
  if (data.common) data.common.struct_version = '0.3'
  await writeProject(rootHandle, '0.3', data)
}
