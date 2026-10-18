/**
 * Structure migration dispatcher.
 *
 * Design goal: no matter how the data content, field properties, or directory layout change, adding
 * a version only requires adding a new `<from>-to-<to>.ts` migration script file in this directory
 * and appending one line to the STRUCTURE_MIGRATION_STEPS registry in migration-steps.ts. Existing
 * code needs no changes, and "upgrade version by version when the user is several versions behind"
 * is supported natively.
 *
 * Every step is a "self-contained" disk migration: it reads the from version from the current disk
 * and writes the to version, so steps can be chained (the result written by step N is exactly the
 * input read by step N+1).
 *
 * Two kinds of steps:
 * - Field-level steps (v0.0→v0.1, v0.1→v0.2, v0.2→v0.3, v0.3→v0.4, and future v1.0→v1.1 etc.):
 *   this is the **most common and most frequent** migration shape — adding fields, renaming,
 *   restructuring. The disk layout is unchanged; read/write goes through structure-io's
 *   readProject/writeProject, and the script only cares about "how fields change".
 * - Structure-level steps (v0.4→v1.0): rewrite the disk layout (old schemas/ + initial-data/ →
 *   one file per table under current/) and clean up the already migrated old files.
 * Every step fully goes through the four phases "read old disk → upgrade → write disk → (cleanup)",
 * never merged.
 *
 * Standard pattern for future field-level migrations (no changes to structure-io needed):
 *   import { readProject, writeProject } from './structure-io'
 *   export async function migrate(rootHandle) {
 *     const data = await readProject(rootHandle, '1.0')   // read current disk (layout auto-selected)
 *     // modify fields of data.schemas / data.common / data.initialData here
 *     if (data.common) data.common.struct_version = '1.1'
 *     await writeProject(rootHandle, '1.1', data)         // write back (layout auto-selected)
 *   }
 */

import type { StructureMigrationDeps } from './v0_4-to-v1_0'
import { STRUCTURE_MIGRATION_STEPS } from './migration-steps'
import { compareStructVersion } from './version-utils'

export type { StructureMigrationStep } from './migration-steps'
export { STRUCTURE_MIGRATION_STEPS } from './migration-steps'

/**
 * Starting from fromVersion, run structure migrations one by one in registry order until the target
 * version targetVersion is reached. Supports users who are several versions behind (e.g. 0.0 → 1.0
 * runs 0.0→0.1, 0.1→0.2, 0.2→0.3, 0.3→0.4, 0.4→1.0 in sequence).
 *
 * @param rootHandle    project root directory handle
 * @param fromVersion   current project structure version
 * @param deps          serialization dependencies required by structure-level migrations
 *                      (injected by the caller; data-level steps do not need them)
 * @param targetVersion target version (defaults to CURRENT_STRUCT_VERSION)
 */
export async function runStructureMigrations(
  rootHandle: FileSystemDirectoryHandle,
  fromVersion: string,
  deps: StructureMigrationDeps,
  targetVersion: string,
): Promise<void> {
  const steps = [...STRUCTURE_MIGRATION_STEPS].sort((a, b) => compareStructVersion(a.from, b.from))

  let current = fromVersion
  // Loop to find the next step starting from current until the target version is reached.
  // Use a loop instead of forEach to support chained multi-step runs (current advances after each step)
  for (;;) {
    if (compareStructVersion(current, targetVersion) >= 0) break

    const next = steps.find((s) => compareStructVersion(s.from, current) === 0)
    if (!next) {
      throw new Error(
        `未找到从版本 ${current} 出发的结构迁移步骤（目标 ${targetVersion}）。请在 structure-migrations 注册表补充对应迁移脚本。`,
      )
    }

    console.log(`[structure-migration] ${next.from} → ${next.to}`)
    await next.migrate(rootHandle, deps)
    current = next.to
  }
}
