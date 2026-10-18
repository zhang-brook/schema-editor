/**
 * Structure migration script: v0.0 → v0.1 (field-level)
 *
 * Upgrades the legacy string[] format of index.columns to IndexColumn[].
 * This is a typical "field-level migration": the on-disk layout is unchanged, only in-memory fields are edited then written back.
 * Uses readProject/writeProject from structure-io, so the script only cares about how fields change.
 *
 * Self-contained: reads version 0.0 from the current disk and writes version 0.1 (overwrite in place),
 * allowing users several versions behind to run migrations "one version at a time".
 *
 * Pattern reference: any future field addition/rename/restructuring (e.g. v1.0→v1.1) follows this shape:
 *   const data = await readProject(rootHandle, '1.0')
 *   // modify fields of data.schemas / data.common / data.initialData
 *   await writeProject(rootHandle, '1.1', data)
 */

import { upgradeIndexColumns } from '../index-column-utils'
import { readProject, writeProject } from './structure-io'

/** Run the v0.0 → v0.1 migration */
export async function migrate(rootHandle: FileSystemDirectoryHandle): Promise<void> {
  // 1. Read the current disk (the old layout is selected automatically for version 0.0)
  const data = await readProject(rootHandle, '0.0')

  // 2. In-memory upgrade: index.columns string[] → IndexColumn[]
  for (const schema of data.schemas) {
    for (const table of schema.tables) {
      if (!table.indexes) continue
      for (const index of table.indexes) {
        // Supports the legacy string[] format: typed as IndexColumn[] but may be string[] at runtime
        index.columns = upgradeIndexColumns(index.columns as unknown as string[])
      }
    }
  }

  // 3. Bump the version and write back (layout unchanged, overwrite in place)
  if (data.common) data.common.struct_version = '0.1'
  await writeProject(rootHandle, '0.1', data)
}
