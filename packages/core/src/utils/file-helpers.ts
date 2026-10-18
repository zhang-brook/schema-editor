import type { InitialData, JsonValue, Schema, Table } from '../types/schema'
import {
  getCommonFileHandle,
  getSchemasDir,
  getInitialDataDir,
  removeOldInitialDataFile,
  // ===== New structure (current/) path resolution =====
  getCurrentDir,
  getCurrentDatabaseFileHandle,
  getCurrentSchemasDir,
  getSchemaDirUnderCurrent,
  getTableDirUnderSchema,
  getTableFileHandle,
} from '../core/workspace/paths'
import { CURRENT_STRUCT_VERSION, SCHEMA_FILE, sanitizeName } from '../core/workspace/layout'
import {
  getOrCreateDir,
  getFileHandleSafe,
  readJsonFile,
  writeJsonFile,
  removeEntry,
} from '../core/workspace/handles'
import { compareStructVersion } from './structure-migrations/version-utils'
import { writeInitialDataToNewStructure } from './initial-data-io'
import { buildSchemaWriteData, type SchemaWriteData } from '../core/workspace/serialization'

const jsonFileIndent = 4

// ===== File System Access API — handle-based folder read/write =====

/**
 *  Check whether the browser supports the File System Access API
 *
 * see: https://developer.mozilla.org/zh-CN/docs/Web/API/File_System_API
 */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

// ===== New structure (current/) read/write =====
//
// Directory layout:
//   common.json                      root config (default_config / unified_types / common_used_fields)
//   current/
//     database.json                  schema_order (entries that may differ by version)
//     schemas/
//       <schema>/                   file-name-friendly schema name (sanitizeName)
//         schema.json               { schema: original name, table_order: string[] }
//         <table>/                  file-name-friendly table name
//           table.json              single table definition
//           initial-data.json       inlined initial data (object format)
//
// The old parallel schemas/ and initial-data/ directories are only read when migrating from the old structure (migrateOldToNewStructure).

/**
 * Checks whether the root directory is already in the latest structure.
 *
 * Compares struct_version in the root common.json against CURRENT_STRUCT_VERSION in code,
 * rather than checking whether the current/ directory exists (leftover empty directories
 * would be misdetected as upgraded).
 * A version >= the current version counts as the new structure; a missing common.json or a
 * lower version means the old structure, which needs upgrading.
 */
export async function isNewStructure(rootHandle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const commonHandle = await getCommonFileHandle(rootHandle, false)
    const data = await readJsonFile<{ struct_version?: string }>(commonHandle)
    const version = data?.struct_version || '0.0'
    return compareStructVersion(version, CURRENT_STRUCT_VERSION) >= 0
  } catch {
    // No root common.json: treat as the old structure, run the upgrade flow
    return false
  }
}

/**
 * Checks whether the root directory is an empty folder (no entries at all).
 * An empty folder counts as a "brand-new project" and should be initialized directly as the
 * new structure instead of prompting an old-structure upgrade.
 */
export async function isEmptyFolder(rootHandle: FileSystemDirectoryHandle): Promise<boolean> {
  for await (const _entry of rootHandle.values()) {
    return false
  }
  return true
}

/** Write database.json into current/ */
export async function writeDatabaseToHandle(
  rootHandle: FileSystemDirectoryHandle,
  data: { schema_order?: string[] },
): Promise<void> {
  const currentDir = await getCurrentDir(rootHandle)
  const handle = await getCurrentDatabaseFileHandle(currentDir)
  await writeJsonFile(handle, data)
}

/** Write schema.json into current/schemas/<schema>/ */
export async function writeSchemaJsonToHandle(
  rootHandle: FileSystemDirectoryHandle,
  schemaName: string,
  data: SchemaWriteData,
): Promise<void> {
  const currentDir = await getCurrentDir(rootHandle)
  const schemasDir = await getCurrentSchemasDir(currentDir)
  const schemaDir = await getSchemaDirUnderCurrent(schemasDir, sanitizeName(schemaName))
  const handle = await getFileHandleSafe(schemaDir, SCHEMA_FILE)
  await writeJsonFile(handle, data)
}

/** Write one table's table.json into current/schemas/<schema>/<table>/ */
export async function writeTableToHandle(
  rootHandle: FileSystemDirectoryHandle,
  schemaName: string,
  table: Table,
): Promise<void> {
  const currentDir = await getCurrentDir(rootHandle)
  const schemasDir = await getCurrentSchemasDir(currentDir)
  const schemaDir = await getSchemaDirUnderCurrent(schemasDir, sanitizeName(schemaName))
  const tableDir = await getTableDirUnderSchema(schemaDir, sanitizeName(table.name))
  const handle = await getTableFileHandle(tableDir)
  await writeJsonFile(handle, table)
}

// ===== Old structure → new structure migration (triggered once when opening an old project) =====

/**
 * Writes the prepared in-memory state (the old structure after the upgrader runs) to the
 * new-structure on-disk layout. Old files are kept, not deleted (to allow rollback). After
 * writing, the project is a new-structure project.
 *
 * @param commonConfig  Part kept in the root common.json (version-independent config)
 * @param databaseData  Content of current/database.json (schema_order, etc.)
 * @param schemas       Full upgraded in-memory state (including tables)
 * @param transformTable Converts one in-memory table into the table.json object to write out
 * @param initialData   Initial data to inline into each table directory
 */
export async function migrateOldToNewStructure(
  rootHandle: FileSystemDirectoryHandle,
  data: {
    commonConfig: unknown
    databaseData: { schema_order?: string[] }
    schemas: Schema[]
    transformTable: (schema: Schema, table: Table) => Table
    initialData: { key: string; data: InitialData }[]
  },
): Promise<void> {
  // 1. Root common.json (only version-independent config)
  await writeCommonToHandle(rootHandle, data.commonConfig)

  // 2. current/database.json
  await writeDatabaseToHandle(rootHandle, data.databaseData)

  // 3. Schema directories and table directories
  for (const schema of data.schemas) {
    await writeSchemaJsonToHandle(rootHandle, schema.schema, buildSchemaWriteData(schema))
    for (const table of schema.tables) {
      const transformed = data.transformTable(schema, table)
      await writeTableToHandle(rootHandle, schema.schema, transformed)
    }
  }

  // 4. Initial data inlined into each table directory
  for (const { key, data: initData } of data.initialData) {
    const sep = key.indexOf('/')
    const schemaName = key.substring(0, sep)
    const tableName = key.substring(sep + 1)
    await writeInitialDataToNewStructure(rootHandle, schemaName, tableName, initData)
  }
}

/**
 * After migration, cleans up the migrated old-structure files so a rollback cannot cause
 * new-structure fields to be lost.
 *
 * Principle: handle exactly what was upgraded — delete only old files that were fully
 * migrated, never whole directories (a directory may hold unrelated user files):
 *   - each old schemas/<schema>.json (migrated to files under current/schemas/<schema>/)
 *   - each old initial-data/<schema>/<table>.json (inlined into current/.../initial-data.json)
 * The old root common.json was overwritten with the new structure during migration, so it needs no deletion.
 */
export async function cleanupOldStructure(
  rootHandle: FileSystemDirectoryHandle,
  oldSchemas: Schema[],
  oldInitialDataKeys: string[],
): Promise<void> {
  // 1. Delete old schemas/<schema>.json
  try {
    const sdHandle = await getSchemasDir(rootHandle, false)
    for (const schema of oldSchemas) {
      await removeEntry(sdHandle, `${sanitizeName(schema.schema)}.json`)
    }
  } catch {
    // No schemas/ directory, skip
  }

  // 2. Delete old initial-data/<schema>/<table>.json
  try {
    const idHandle = await getInitialDataDir(rootHandle, false)
    for (const key of oldInitialDataKeys) {
      const sep = key.indexOf('/')
      const schemaName = key.substring(0, sep)
      const tableName = key.substring(sep + 1)
      try {
        const schemaDir = await getOrCreateDir(idHandle, sanitizeName(schemaName), false)
        await removeOldInitialDataFile(schemaDir, sanitizeName(tableName))
      } catch {
        // This old initial-data file does not exist, skip
      }
    }
  } catch {
    // No initial-data/ directory, skip
  }
}

/** Read old-structure schemas/*.json into memory (used by the migration upgrade) */
export async function readOldSchemasFromHandle(
  rootHandle: FileSystemDirectoryHandle,
): Promise<Schema[]> {
  const result: Schema[] = []
  try {
    const sdHandle = await getSchemasDir(rootHandle, false)
    for await (const entry of sdHandle.values()) {
      const fHandle = entry as FileSystemFileHandle | FileSystemDirectoryHandle
      if (!fHandle.name.endsWith('.json') || fHandle.kind !== 'file') continue
      try {
        const file = await fHandle.getFile()
        const parsed = JSON.parse(await file.text())
        if (parsed?.schema && Array.isArray(parsed.tables)) {
          result.push(parsed as Schema)
        }
      } catch (e) {
        console.warn(`[readOldSchemasFromHandle] failed to parse "${fHandle.name}":`, e)
      }
    }
  } catch {
    // No schemas/ directory
  }
  return result
}

/**
 * Write data to common.json
 */
export async function writeCommonToHandle(rootHandle: FileSystemDirectoryHandle, data: unknown): Promise<void> {
  const handle = await getCommonFileHandle(rootHandle)
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(data, null, jsonFileIndent))
  await writable.close()
}

// ===== Business-agnostic utility functions =====


/**
 * Parse default value input
 */
export function parseDefaultInput(val: string) {
  if (val === '' || val === undefined) return undefined
  // Try to parse as number
  if (/^-?\d+$/.test(val)) return parseInt(val, 10)
  if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val)
  if (val === 'true') return true
  if (val === 'false') return false
  return val
}

/**
 * Format a default value for display
 */
export function displayDefault(val: JsonValue): string {
  if (val === undefined || val === null) return ''
  return String(val)
}

/**
 * Parse field length
 */
export function parseFieldLengthInput(val: string): number | null {
  if (val === '' || val === undefined || val === null) return null
  const str = String(val).trim()
  if (str === '') return null
  if (/^-?\d+$/.test(str)) return parseInt(str, 10)
  return null
}

/**
 * Format field length for display
 */
export function displayFieldLength(val: number | null | undefined): string {
  if (val === null || val === undefined) return ''
  return String(val)
}

/**
 * Parse field decimal places
 */
export function parseFieldScaleInput(val: string): number | null {
  return parseFieldLengthInput(val)
}

/**
 * Format field decimal places for display
 */
export function displayFieldScale(val: number | null | undefined): string {
  return displayFieldLength(val)
}
