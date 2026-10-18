/**
 * Structure migration script: v0.2 → v0.3 (field-level)
 *
 * initial-data JSON format migration: plain array [...] → full object format { rows: [...] }.
 * This is a field-level migration (layout unchanged) using the readProject/writeProject pattern:
 * read the old disk → rewrite the in-memory initialData array as an object → write back.
 * schemas data needs no migration.
 *
 * Note: readProject only collects object-format initial-data; before writing back, this step
 * explicitly normalizes array-format entries to the object format (for array files left over on old disks).
 */

import { readProject, writeProject } from './structure-io'
import type { InitialData } from '../../types/schema'

/** Normalizes any legacy format to the object format { rows: [...] } */
function normalizeInitialData(raw: unknown): InitialData {
  if (Array.isArray(raw)) return { rows: raw } as InitialData
  return (raw ?? { rows: [] }) as InitialData
}

/** Run the v0.2 → v0.3 migration */
export async function migrate(rootHandle: FileSystemDirectoryHandle): Promise<void> {
  const data = await readProject(rootHandle, '0.2')

  // Safety net: if in-memory initialData is still array-shaped (readProject already filters these, re-checked here for safety)
  for (const [key, value] of data.initialData) {
    if (Array.isArray(value)) {
      data.initialData.set(key, normalizeInitialData(value))
    }
  }

  // Bump the version and write back (overwrite in place, layout unchanged, no files deleted)
  if (data.common) data.common.struct_version = '0.3'
  await writeProject(rootHandle, '0.3', data)
}
