/**
 * Structure migration script: v0.3 → v0.4 (field-level)
 *
 * Renames the pgsql field to postgresql (at the schema/table/field/index/index-column levels, plus
 * commonConfig's default_config / common_used_fields / unified_types).
 * This is a typical "field rename" migration: the disk layout is unchanged, only in-memory fields
 * are changed and written back.
 * It follows the readProject/writeProject pattern, so the script only cares about how fields change.
 *
 * The subsequent 0.4→1.0 structure migration can work directly on the 0.4 data state produced by
 * this step.
 */

import { readLegacyField } from './version-utils'
import { readProject, writeProject } from './structure-io'

/** Migrate the pgsql field on obj to postgresql (modified in place) */
function renamePgsql(obj: object): void {
  const record = obj as Record<string, unknown>
  const legacy = readLegacyField(record, 'pgsql')
  if (legacy !== undefined) {
    record.postgresql = legacy
    delete record.pgsql
  }
}

/** Run the v0.3 → v0.4 migration */
export async function migrate(rootHandle: FileSystemDirectoryHandle): Promise<void> {
  // 1. Read the current disk (automatically choosing the old layout based on version 0.3)
  const data = await readProject(rootHandle, '0.3')

  // 2. In-memory upgrade: pgsql → postgresql
  for (const schema of data.schemas) {
    // Migrate schema-level pre/post SQL
    if (schema.pre_sql) renamePgsql(schema.pre_sql)
    if (schema.post_sql) renamePgsql(schema.post_sql)

    // Migrate table config
    for (const table of schema.tables) {
      if (table.pre_sql) renamePgsql(table.pre_sql)
      if (table.post_sql) renamePgsql(table.post_sql)

      // Migrate field config
      for (const field of table.fields) {
        renamePgsql(field)
      }

      // Migrate index config (including pgsql at the index column level)
      for (const index of table.indexes) {
        renamePgsql(index)
        // Migrate pgsql of index columns
        if (index.columns) {
          for (const col of index.columns) {
            renamePgsql(col)
          }
        }
      }
    }
  }

  // Migrate global config
  if (data.common) {
    // default_config may be entirely missing on the old disk; in that case an empty record is read
    // and there is no pgsql
    const defaultConfig = data.common.default_config
    if (defaultConfig && readLegacyField(defaultConfig, 'pgsql') !== undefined) {
      if (!defaultConfig.postgresql) {
        defaultConfig.postgresql = { quote_identifiers: true }
      }
      delete defaultConfig.pgsql
    }

    // Migrate pgsql in common_used_fields
    if (data.common.common_used_fields) {
      for (const fieldName of Object.keys(data.common.common_used_fields)) {
        const field = data.common.common_used_fields[fieldName]
        if (field) renamePgsql(field)
      }
    }

    // Migrate pgsql in unified_types
    if (data.common.unified_types) {
      for (const ut of data.common.unified_types) {
        renamePgsql(ut)
      }
    }
  }

  // 3. Advance the version number and write back (layout unchanged, overwrite in place)
  if (data.common) data.common.struct_version = '0.4'
  await writeProject(rootHandle, '0.4', data)
}
