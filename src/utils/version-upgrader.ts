/* eslint-disable @typescript-eslint/ban-ts-comment */
import type { CommonConfig, InitialData, Schema } from '@/types/schema'
import { upgradeIndexColumns } from './index-column-utils'

/** 当前编辑器支持的最高结构版本 */
export const CURRENT_STRUCT_VERSION = '0.4'

export interface VersionCheckResult {
  ok: boolean           // 可以继续加载
  needsUpgrade: boolean  // 需要执行升级
  fromVersion?: string   // 当前项目版本（需要升级时提供）
  error?: string         // 错误消息（版本过高时）
}

/** 单个升级步骤：将结构从 from 版本升级到 to 版本 */
interface UpgradeStep {
  from: string
  to: string
  upgrade: (schemas: Schema[], commonConfig?: CommonConfig, rootHandle?: FileSystemDirectoryHandle) => void | Promise<void>
}

/**
 * 升级步骤注册表
 * - 每个步骤的 from 必须等于上一个步骤的 to，形成连续链条
 * - 未来新增版本只需在数组末尾追加新步骤即可
 */
const UPGRADE_STEPS: UpgradeStep[] = [
  {
    from: '0.0',
    to: '0.1',
    upgrade: (schemas) => {
      // 将旧版 string[] 格式的 index.columns 升级为 IndexColumn[]
      for (const schema of schemas) {
        for (const table of schema.tables) {
          if (!table.indexes) continue
          for (const index of table.indexes) {
            // 兼容旧版 string[] 格式，TypeScript 类型为 IndexColumn[] 但运行时可能是 string[]
            index.columns = upgradeIndexColumns(index.columns as unknown as string[])
          }
        }
      }
    },
  },
  // 未来新增步骤示例：
  // {
  //   from: '0.1',
  //   to: '0.2',
  //   upgrade: (schemas) => {
  //     // 0.1 → 0.2 的结构变更逻辑
  //   },
  // },
  {
    from: '0.1',
    to: '0.2',
    upgrade: (_schemas, _commonConfig) => {
      // schemas 数据无需迁移（Field.unified_type 为可选字段，旧数据不设置则自动回退到自由文本模式）
      // CommonConfig.unified_types 的默认值初始化在 store 的 openProject() 中处理
    },
  },
  {
    from: '0.2',
    to: '0.3',
    upgrade: async (_schemas, _commonConfig, rootHandle) => {
      // schemas 数据无需迁移
      // initial-data JSON 格式迁移：纯数组 → 完整对象格式
      if (rootHandle) {
        await migrateInitialDataFormat(rootHandle)
      }
    },
  },
  {
    from: '0.3',
    to: '0.4',
    upgrade: (schemas, _commonConfig) => {
      // 将 pgsql 字段重命名为 postgresql
      // 迁移 schema 数据
      for (const schema of schemas) {
        // 迁移 schema 级别的前/后置 SQL
        if (schema.pre_sql) {
          // @ts-expect-error
          if (schema.pre_sql.pgsql) {
            // @ts-expect-error
            schema.pre_sql.postgresql = schema.pre_sql.pgsql
            // @ts-expect-error
            delete schema.pre_sql.pgsql
          }
        }
        if (schema.post_sql) {
          // @ts-expect-error
          if (schema.post_sql.pgsql) {
            // @ts-expect-error
            schema.post_sql.postgresql = schema.post_sql.pgsql
            // @ts-expect-error
            delete schema.post_sql.pgsql
          }
        }

        // 迁移表配置
        for (const table of schema.tables) {
          if (table.pre_sql) {
            // @ts-expect-error
            if (table.pre_sql.pgsql) {
              // @ts-expect-error
              table.pre_sql.postgresql = table.pre_sql.pgsql
              // @ts-expect-error
              delete table.pre_sql.pgsql
            }
          }
          if (table.post_sql) {
            // @ts-expect-error
            if (table.post_sql.pgsql) {
              // @ts-expect-error
              table.post_sql.postgresql = table.post_sql.pgsql
              // @ts-expect-error
              delete table.post_sql.pgsql
            }
          }

          // 迁移字段配置
          for (const field of table.fields) {
            // @ts-expect-error
            if (field.pgsql) {
              // @ts-expect-error
              field.postgresql = field.pgsql
              // @ts-expect-error
              delete field.pgsql
            }
          }

          // 迁移索引配置（包含索引列级别的 pgsql）
          for (const index of table.indexes) {
            // @ts-expect-error
            if (index.pgsql) {
              // @ts-expect-error
              index.postgresql = index.pgsql
              // @ts-expect-error
              delete index.pgsql
            }
            // 迁移索引列的 pgsql
            if (index.columns) {
              for (const col of index.columns) {
                // @ts-expect-error
                if (col.pgsql) {
                  // @ts-expect-error
                  col.postgresql = col.pgsql
                  // @ts-expect-error
                  delete col.pgsql
                }
              }
            }
          }
        }
      }

      // 迁移全局配置
      // @ts-expect-error
      if (_commonConfig?.default_config?.pgsql) {
        if (!_commonConfig.default_config.postgresql) {
          _commonConfig.default_config.postgresql = { quote_identifiers: true }
        }
        // @ts-expect-error
        delete _commonConfig.default_config.pgsql
      }

      // 迁移 common_used_fields 中的 pgsql
      if (_commonConfig?.common_used_fields) {
        for (const fieldName of Object.keys(_commonConfig.common_used_fields)) {
          const field = _commonConfig.common_used_fields[fieldName]
          // @ts-expect-error
          if (field.pgsql) {
            // @ts-expect-error
            field.postgresql = field.pgsql
            // @ts-expect-error
            delete field.pgsql
          }
        }
      }

      // 迁移 unified_types 中的 pgsql
      if (_commonConfig?.unified_types) {
        for (const ut of _commonConfig.unified_types) {
          // @ts-expect-error
          if (ut.pgsql) {
            // @ts-expect-error
            ut.postgresql = ut.pgsql
            // @ts-expect-error
            delete ut.pgsql
          }
        }
      }
    },
  },
]

/**
 * 简单语义版本比较：按 "." 分割后逐段比较数字
 * 返回 >0 表示 a > b，<0 表示 a < b，0 表示相等
 */
function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number)
  const bParts = b.split('.').map(Number)
  const len = Math.max(aParts.length, bParts.length)
  for (let i = 0; i < len; i++) {
    const av = aParts[i] ?? 0
    const bv = bParts[i] ?? 0
    if (av > bv) return 1
    if (av < bv) return -1
  }
  return 0
}

/**
 * 检查项目结构版本，返回是否可加载以及是否需要升级
 * @param commonConfig - 已加载的 commonConfig（可能为 null）
 */
export function checkVersion(commonConfig: CommonConfig | null): VersionCheckResult {
  const version = commonConfig?.struct_version || '0.0'

  const cmp = compareVersions(version, CURRENT_STRUCT_VERSION)
  if (cmp > 0) {
    return {
      ok: false,
      needsUpgrade: false,
      error: `项目结构版本（${version}）高于当前编辑器支持的版本（${CURRENT_STRUCT_VERSION}），请升级编辑器。`,
    }
  }

  if (cmp < 0) {
    return { ok: true, needsUpgrade: true, fromVersion: version }
  }

  return { ok: true, needsUpgrade: false }
}

/**
 * 迁移 initial-data/ 目录下的 JSON 文件：
 * 将纯数组格式 [...] 升级为完整对象格式 { rows: [...] }
 */
async function migrateInitialDataFormat(rootHandle: FileSystemDirectoryHandle): Promise<void> {
  let initialDataHandle: FileSystemDirectoryHandle
  try {
    initialDataHandle = await rootHandle.getDirectoryHandle('initial-data')
  } catch {
    return // initial-data/ 目录不存在，无需迁移
  }

  for await (const schemaEntry of initialDataHandle.values()) {
    if (schemaEntry.kind !== 'directory') continue
    const schemaName = schemaEntry.name

    for await (const fileEntry of schemaEntry.values()) {
      if (fileEntry.kind !== 'file' || !fileEntry.name.endsWith('.json')) continue
      const tableName = fileEntry.name.slice(0, -5)

      try {
        const file = await fileEntry.getFile()
        const raw = JSON.parse(await file.text())

        if (!Array.isArray(raw)) continue // 已是对象格式，跳过

        // 纯数组 → { rows: [...] }
        const data: InitialData = { rows: raw }
        const exportData: Record<string, any> = { rows: data.rows }

        const writable = await fileEntry.createWritable()
        await writable.write(JSON.stringify(exportData, null, 4))
        await writable.close()
        console.log(`[migrateInitialDataFormat] upgraded "${schemaName}/${tableName}.json" from array to object format`)
      } catch (e) {
        console.warn(`[migrateInitialDataFormat] failed to migrate "${schemaName}/${fileEntry.name}":`, e)
      }
    }
  }
}

/**
 * 增量升级 schema 数据：根据 fromVersion 到 CURRENT_STRUCT_VERSION
 * 按序执行所有必要的升级步骤
 */
export async function upgradeSchemaData(
  schemas: Schema[],
  fromVersion: string,
  commonConfig?: CommonConfig,
  rootHandle?: FileSystemDirectoryHandle,
): Promise<void> {
  // 筛选并排序需要执行的步骤
  const stepsToRun = UPGRADE_STEPS
    .filter(s => compareVersions(s.from, fromVersion) >= 0)
    .sort((a, b) => compareVersions(a.from, b.from))

  for (const step of stepsToRun) {
    console.log(`[upgradeSchemaData] upgrading from ${step.from} to ${step.to}`)
    await step.upgrade(schemas, commonConfig, rootHandle)
  }
}
