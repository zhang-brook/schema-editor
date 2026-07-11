/**
 * 结构迁移脚本：v0.3 → v0.4（字段级）
 *
 * 将 pgsql 字段重命名为 postgresql（schema/table/field/index/index-column 各级，以及
 * commonConfig 的 default_config / common_used_fields / unified_types）。
 * 这是典型的「字段改名」迁移：磁盘布局不变，只改内存字段后写回。
 * 使用 readProject/writeProject 范式，脚本只关注字段怎么变。
 *
 * 后续 0.4→1.0 结构迁移可直接基于本步骤产出的 0.4 数据态进行。
 */

import { readLegacyField } from './version-utils'
import { readProject, writeProject } from './structure-io'

/** 将 obj 上的 pgsql 字段迁移为 postgresql（原地修改） */
function renamePgsql(obj: Record<string, any>): void {
  const legacy = readLegacyField(obj, 'pgsql')
  if (legacy !== undefined) {
    obj.postgresql = legacy
    delete obj.pgsql
  }
}

/** 执行 v0.3 → v0.4 迁移 */
export async function migrate(rootHandle: FileSystemDirectoryHandle): Promise<void> {
  // 1. 读取当前盘（按 0.3 版本自动选择 old 布局）
  const data = await readProject(rootHandle, '0.3')

  // 2. 内存升级：pgsql → postgresql
  for (const schema of data.schemas) {
    // 迁移 schema 级别的前/后置 SQL
    if (schema.pre_sql) renamePgsql(schema.pre_sql as Record<string, any>)
    if (schema.post_sql) renamePgsql(schema.post_sql as Record<string, any>)

    // 迁移表配置
    for (const table of schema.tables) {
      if (table.pre_sql) renamePgsql(table.pre_sql as Record<string, any>)
      if (table.post_sql) renamePgsql(table.post_sql as Record<string, any>)

      // 迁移字段配置
      for (const field of table.fields) {
        renamePgsql(field as Record<string, any>)
      }

      // 迁移索引配置（包含索引列级别的 pgsql）
      for (const index of table.indexes) {
        renamePgsql(index as Record<string, any>)
        // 迁移索引列的 pgsql
        if (index.columns) {
          for (const col of index.columns) {
            renamePgsql(col as Record<string, any>)
          }
        }
      }
    }
  }

  // 迁移全局配置
  if (data.common) {
    if (readLegacyField(data.common.default_config ?? {}, 'pgsql') !== undefined) {
      if (!data.common.default_config.postgresql) {
        data.common.default_config.postgresql = { quote_identifiers: true }
      }
      delete data.common.default_config.pgsql
    }

    // 迁移 common_used_fields 中的 pgsql
    if (data.common.common_used_fields) {
      for (const fieldName of Object.keys(data.common.common_used_fields)) {
        const field = data.common.common_used_fields[fieldName]
        if (field) renamePgsql(field as Record<string, any>)
      }
    }

    // 迁移 unified_types 中的 pgsql
    if (data.common.unified_types) {
      for (const ut of data.common.unified_types) {
        renamePgsql(ut as Record<string, any>)
      }
    }
  }

  // 3. 推进版本号并写回（布局不变，覆盖写回）
  if (data.common) data.common.struct_version = '0.4'
  await writeProject(rootHandle, '0.4', data)
}
