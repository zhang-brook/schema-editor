/**
 * 结构迁移脚本：v0.0 → v0.1（字段级）
 *
 * 将旧版 string[] 格式的 index.columns 升级为 IndexColumn[]。
 * 这是典型的「字段级迁移」：磁盘布局不变，只改内存字段后写回。
 * 使用 structure-io 的 readProject/writeProject，脚本只关注"字段怎么变"。
 *
 * 自包含：从当前磁盘读取 0.0 版本、写出 0.1 版本（覆盖写回），
 * 支持用户落后多个版本时「逐个版本」依次跑。
 *
 * 范式参考：未来任何字段新增/改名/结构调整（如 v1.0→v1.1），都沿用此模式——
 *   const data = await readProject(rootHandle, '1.0')
 *   // 改 data.schemas / data.common / data.initialData 的字段
 *   await writeProject(rootHandle, '1.1', data)
 */

import { upgradeIndexColumns } from '@/utils/index-column-utils'
import { readProject, writeProject } from './structure-io'

/** 执行 v0.0 → v0.1 迁移 */
export async function migrate(rootHandle: FileSystemDirectoryHandle): Promise<void> {
  // 1. 读取当前盘（按 0.0 版本自动选择 old 布局）
  const data = await readProject(rootHandle, '0.0')

  // 2. 内存升级：index.columns string[] → IndexColumn[]
  for (const schema of data.schemas) {
    for (const table of schema.tables) {
      if (!table.indexes) continue
      for (const index of table.indexes) {
        // 兼容旧版 string[] 格式，TypeScript 类型为 IndexColumn[] 但运行时可能是 string[]
        index.columns = upgradeIndexColumns(index.columns as unknown as string[])
      }
    }
  }

  // 3. 推进版本号并写回（布局不变，覆盖写回）
  if (data.common) data.common.struct_version = '0.1'
  await writeProject(rootHandle, '0.1', data)
}
