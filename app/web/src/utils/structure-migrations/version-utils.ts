import type { CommonConfig } from '@/types/schema'
import { CURRENT_STRUCT_VERSION } from '@/core/workspace/layout'

/**
 * 版本判定与比较工具（从原 version-upgrader.ts 迁入）。
 * structure-migrations 统一接管「版本判定 + 逐版本迁移」，
 * 本文件只保留纯函数，不依赖具体迁移步骤实现。
 */

export interface VersionCheckResult {
  ok: boolean // 可以继续加载
  needsUpgrade: boolean // 需要执行升级
  fromVersion?: string // 当前项目版本（需要升级时提供）
  error?: string // 错误消息（版本过高时）
}

/**
 * 读取旧字段名（历史兼容）。
 * 内部做一次 as 断言，把散落的 @ts-expect-error 收敛到这一处，
 * 对外返回 any，不改变运行时行为。
 */
export function readLegacyField<T = any>(
  obj: Record<string, any>,
  legacyKey: string,
  fallback?: T,
): T {
  const v = (obj as Record<string, any>)[legacyKey]
  return (v === undefined ? fallback : v) as T
}

/**
 * 语义化版本比较
 * a >= b 返回 >= 0，a < b 返回 < 0（仅比较数字段，忽略非数字后缀）
 */
export function compareStructVersion(a: string, b: string): number {
  const aParts = a.split('.').map((n) => parseInt(n, 10) || 0)
  const bParts = b.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(aParts.length, bParts.length)
  for (let i = 0; i < len; i++) {
    const diff = (aParts[i] || 0) - (bParts[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * 检查项目结构版本，返回是否可加载以及是否需要升级
 * @param commonConfig - 已加载的 commonConfig（可能为 null）
 */
export function checkVersion(commonConfig: CommonConfig | null): VersionCheckResult {
  const version = commonConfig?.struct_version || '0.0'

  const cmp = compareStructVersion(version, CURRENT_STRUCT_VERSION)
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
