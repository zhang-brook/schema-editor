import type { CommonConfig } from '../../types/schema'
import { CURRENT_STRUCT_VERSION } from '../../core/workspace/layout'

/**
 * Version detection and comparison utilities (moved from the former version-upgrader.ts).
 * structure-migrations takes over "version detection + version-by-version migration" uniformly;
 * this file keeps only pure functions and does not depend on any concrete migration step.
 */

export interface VersionCheckResult {
  ok: boolean // safe to continue loading
  needsUpgrade: boolean // an upgrade is required
  fromVersion?: string // current project version (provided when an upgrade is needed)
  error?: string // error message (when the version is too high)
}

/**
 * Read a legacy field name (backward compatibility).
 * Disk content is untrusted, so the value is read by key and returned as unknown; the caller
 * decides whether the shape is usable.
 */
export function readLegacyField(obj: object, legacyKey: string, fallback?: unknown): unknown {
  const v = (obj as Record<string, unknown>)[legacyKey]
  return v === undefined ? fallback : v
}

/**
 * Semantic version comparison
 * Returns >= 0 when a >= b, < 0 when a < b (only numeric segments are compared, non-numeric
 * suffixes are ignored)
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
 * Check the project structure version and return whether it can be loaded and whether it needs an upgrade
 * @param commonConfig - the loaded commonConfig (may be null)
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
