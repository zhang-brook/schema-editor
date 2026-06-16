import type { CommonConfig, Schema } from '@/types/schema'
import { upgradeIndexColumns } from './index-column-utils'

/** 当前编辑器支持的最高结构版本 */
export const CURRENT_STRUCT_VERSION = '0.1'

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
  upgrade: (schemas: Schema[]) => void
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
 * 增量升级 schema 数据：根据 fromVersion 到 CURRENT_STRUCT_VERSION
 * 按序执行所有必要的升级步骤
 */
export function upgradeSchemaData(schemas: Schema[], fromVersion: string): void {
  // 筛选并排序需要执行的步骤
  const stepsToRun = UPGRADE_STEPS
    .filter(s => compareVersions(s.from, fromVersion) >= 0)
    .sort((a, b) => compareVersions(a.from, b.from))

  for (const step of stepsToRun) {
    console.log(`[upgradeSchemaData] upgrading from ${step.from} to ${step.to}`)
    step.upgrade(schemas)
  }
}
