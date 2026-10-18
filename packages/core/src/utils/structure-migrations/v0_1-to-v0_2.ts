/**
 * Structure migration script: v0.1 → v0.2 (field-level)
 *
 * schemas data needs no migration (Field.unified_type is optional; legacy data without it falls back to free-text mode).
 * This step only bumps common.struct_version to 0.2, reading and writing back without deleting any files.
 * (Defaults for CommonConfig.unified_types are initialized in the store's openProject())
 *
 * Follows the readProject/writeProject pattern to keep a single IO entry point even when only the version changes.
 */

import { readProject, writeProject } from './structure-io'

/** Run the v0.1 → v0.2 migration */
export async function migrate(rootHandle: FileSystemDirectoryHandle): Promise<void> {
  const data = await readProject(rootHandle, '0.1')
  if (data.common) data.common.struct_version = '0.2'
  await writeProject(rootHandle, '0.2', data)
}
