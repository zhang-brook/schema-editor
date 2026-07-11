/**
 * 结构迁移脚本：v0.1 → v0.2（字段级）
 *
 * schemas 数据无需迁移（Field.unified_type 为可选字段，旧数据不设置则自动回退到自由文本模式）。
 * 本步骤仅将 common.struct_version 推进到 0.2，读盘、写回，不删除任何文件。
 * （CommonConfig.unified_types 的默认值初始化在 store 的 openProject() 中处理）
 *
 * 沿用 readProject/writeProject 范式，即使只改版本号也保持统一的 IO 入口。
 */

import { readProject, writeProject } from './structure-io'

/** 执行 v0.1 → v0.2 迁移 */
export async function migrate(rootHandle: FileSystemDirectoryHandle): Promise<void> {
  const data = await readProject(rootHandle, '0.1')
  if (data.common) data.common.struct_version = '0.2'
  await writeProject(rootHandle, '0.2', data)
}
