/**
 * Structure migration script: v0.4 → v1.0
 *
 * This is a "full disk layout migration": read the old structure (root common.json + schemas/*.json
 * + initial-data/*), rewrite it into the new structure (one file per table under current/ with
 * inlined initial data), and clean up the already migrated old files (to prevent a rollback from
 * losing fields of the new structure).
 *
 * Designed to be "self-contained": every step file reads the from version from the current disk and
 * writes the to version, so users who are several versions behind can be upgraded "version by
 * version" (see the registry in structure-migrations/index.ts).
 * Note: the 0.0→0.4 data-level field upgrades have already been done one by one on the old disk by
 * the separate v0_x-to-v0_y steps; the in-memory oldSchemas this step receives are already in the
 * 0.4 data state, so only layout-level rewriting is needed here.
 *
 * Note: "0.4" is the current end of the data-level upgrade chain; the structure version
 * corresponding to the old disk format (parallel schemas/ directory + parallel initial-data/
 * directory) is recorded as 0.4; "1.0" is the first structure version after introducing the new
 * current/ layout (= CURRENT_STRUCT_VERSION). This step also performs initial-data inlining (reading
 * the old disk converts to inline via normalizeInitialData, writing the new disk emits inline only
 * via buildInitialDataExport).
 */

import {
  readOldSchemasFromHandle,
  migrateOldToNewStructure,
  cleanupOldStructure,
} from '../file-helpers'
import { readInitialDataFromHandle } from '../initial-data-io'
import type { Schema, Table } from '../../types/schema'
import { readProject, type CommonDocument } from './structure-io'

/** End version of this step (the first structure version after introducing the new current/ layout) */
const V1_0 = '1.0'

/** Structure migration dependencies (injected by the dispatcher) */
export interface StructureMigrationDeps {
  /** Serialize a single in-memory table into a table.json object ready to be written */
  transformTable: (schema: Schema, table: Table) => Table
}

/**
 * Run the v0.4 → v1.0 migration.
 * @param rootHandle project root directory handle
 * @param deps injected serialization function
 */
export async function migrate(
  rootHandle: FileSystemDirectoryHandle,
  deps?: StructureMigrationDeps,
): Promise<void> {
  if (!deps) throw new Error('[v0_4-to-v1_0] transformTable 依赖未注入')
  // 1. Read the old structure (every step re-reads from disk to support chained multi-version upgrades)
  const oldCommon = (await readProject(rootHandle, '0.4')).common
  const oldSchemas = await readOldSchemasFromHandle(rootHandle)
  const oldInitialData = await readInitialDataFromHandle(rootHandle)

  // 2. Data-level upgrades were already done by the separate 0.0→0.4 steps, so the in-memory
  //    oldSchemas are already in the 0.4 data state; only advance to this step's end version 1.0
  //    (a later 1.0→1.1 is handed off to a separate chained step and must not be skipped to here)
  if (oldCommon) oldCommon.struct_version = V1_0

  // 3. Build the data to write for the new structure
  const newCommon: CommonDocument = oldCommon ?? { struct_version: V1_0 }
  // Move schema_order from the root common into database.json:
  // - if the old common has schema_order, carry it over as is (it must stay consistent with before);
  // - if the old common does not have it, do not write the field (the consumer applySchemaOrder
  //   already handles "no ordering" by displaying in memory/directory order, which is expected
  //   behavior; an ordering should not be invented out of thin air).
  //   Note: it must be read before delete, because newCommon and oldCommon are the same object
  //   reference; reading after delete would yield undefined and lose schema_order.
  const preservedSchemaOrder =
    oldCommon && Array.isArray(oldCommon.schema_order) && oldCommon.schema_order.length > 0
      ? (oldCommon.schema_order as string[])
      : undefined
  delete newCommon.schema_order
  const databaseData: { schema_order?: string[] } = {}
  if (preservedSchemaOrder) {
    databaseData.schema_order = preservedSchemaOrder
  }

  // 4. Write the new structure (one file per table under current/ + inlined initial data)
  await migrateOldToNewStructure(rootHandle, {
    commonConfig: newCommon,
    databaseData,
    schemas: oldSchemas,
    transformTable: deps.transformTable,
    initialData: oldInitialData,
  })

  // 5. Clean up the already migrated old files (whatever was upgraded is cleaned up)
  const oldInitialDataKeys = oldInitialData.map((x) => x.key)
  await cleanupOldStructure(rootHandle, oldSchemas, oldInitialDataKeys)
}
