import type { Field, InitialData, Schema, Table, UnifiedTypeDefinition } from '../../types/schema'
import {
  getCommonFileHandle,
  getSchemasDir,
  getInitialDataDir,
  getCurrentDir,
  getCurrentDatabaseFileHandle,
  getCurrentSchemasDir,
  getSchemaDirUnderCurrent,
  getTableDirUnderSchema,
  getTableFileHandle,
  getInitialDataFileHandle,
} from '../../core/workspace/paths'
import { readJsonFile, writeJsonFile } from '../../core/workspace/handles'
import { sanitizeName } from '../../core/workspace/layout'
import { normalizeInitialData, buildInitialDataExport } from '../initial-data-io'

/**
 * Shared disk IO layer for structure migrations.
 *
 * Design intent: whether it is a "directory layout adjustment" or a "field/property migration
 * (add, rename, restructure)", every migration step is essentially
 * "read the current disk → mutate in memory → write back to the current disk". This module therefore
 * offers version-agnostic read/write capabilities, so migration scripts only focus on "how fields
 * change" and never worry about how files are laid out.
 *
 * Key point: the read/write logic dispatches on the "structure version" —
 * - Old layout (0.0~0.4): schemas/*.json + initial-data/* + common.json
 * - New layout (1.0+): current/schemas/<schema>/<table>/table.json + initial-data.json + database.json
 *
 * When adding a field-level migration in the future (e.g. v1.0→v1.1), simply call this module's
 * readProject/writeProject, mutate the fields on the in-memory state and write back; no new IO code
 * is required.
 */

/**
 * Root configuration document on disk: root common.json in the old layout,
 * current/database.json in the new layout. During migration we need to read/write legacy keys from
 * various historical versions (such as default_config.pgsql), so only the keys the migration cares
 * about are declared; default_config stays an unnarrowed record view.
 */
export interface CommonDocument {
  struct_version?: string
  schema_order?: string[]
  default_config?: Record<string, unknown>
  common_used_fields?: Record<string, Field>
  unified_types?: UnifiedTypeDefinition[]
}

/** table.json on disk: either a { schema, table } wrapper or a directly flattened table object */
interface TableDocument extends Partial<Table> {
  schema?: string
  table?: Partial<Table> & { schema?: string }
}

/** Unified in-memory project data model (independent of disk layout) */
export interface ProjectData {
  /** Global config (including struct_version); null when the file is missing or unreadable */
  common: CommonDocument | null
  /** All schemas (with complete structures such as tables, fields, indexes) */
  schemas: Schema[]
  /** Initial data, keyed by "<schemaName>/<tableName>" */
  initialData: Map<string, InitialData>
}

/** Whether this version uses the new (current/) layout */
function isNewLayout(version: string): boolean {
  // 1.0 and above use the new layout; 0.x uses the old layout
  const parts = version.split('.').map((n) => parseInt(n, 10) || 0)
  const major = parts[0] || 0
  return major >= 1
}

// ─────────────────────────────── Old layout read/write ───────────────────────────────

async function readOldLayout(rootHandle: FileSystemDirectoryHandle): Promise<ProjectData> {
  const common = await readOldCommon(rootHandle)
  const schemas = await readOldSchemas(rootHandle)
  const initialData = await readOldInitialData(rootHandle)
  return { common, schemas, initialData: mapFromPairs(initialData) }
}

async function readOldCommon(rootHandle: FileSystemDirectoryHandle): Promise<CommonDocument | null> {
  try {
    const handle = await getCommonFileHandle(rootHandle, false)
    return await readJsonFile<CommonDocument>(handle)
  } catch {
    return null
  }
}

async function readOldSchemas(rootHandle: FileSystemDirectoryHandle): Promise<Schema[]> {
  const result: Schema[] = []
  try {
    const sdHandle = await getSchemasDir(rootHandle, false)
    for await (const entry of sdHandle.values()) {
      if (!entry.name.endsWith('.json') || entry.kind !== 'file') continue
      try {
        const file = await (entry as FileSystemFileHandle).getFile()
        const parsed = JSON.parse(await file.text())
        if (parsed?.schema && Array.isArray(parsed.tables)) {
          result.push(parsed as Schema)
        }
      } catch (e) {
        console.warn(`[structure-io] failed to parse "${entry.name}":`, e)
      }
    }
  } catch {
    // no schemas/ directory
  }
  return result
}

async function readOldInitialData(
  rootHandle: FileSystemDirectoryHandle,
): Promise<{ key: string; data: InitialData }[]> {
  const result: { key: string; data: InitialData }[] = []
  let initialDataHandle: FileSystemDirectoryHandle
  try {
    initialDataHandle = await getInitialDataDir(rootHandle, false)
  } catch {
    return result
  }

  for await (const schemaEntry of initialDataHandle.values()) {
    if (schemaEntry.kind !== 'directory') continue
    const schemaName = schemaEntry.name
    for await (const fileEntry of schemaEntry.values()) {
      if (fileEntry.kind !== 'file' || !fileEntry.name.endsWith('.json')) continue
      const tableName = fileEntry.name.slice(0, -5)
      try {
        const file = await (fileEntry as FileSystemFileHandle).getFile()
        const raw = JSON.parse(await file.text())
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          result.push({ key: `${schemaName}/${tableName}`, data: raw as InitialData })
        }
      } catch (e) {
        console.warn(`[structure-io] failed to parse initial-data "${schemaName}/${fileEntry.name}":`, e)
      }
    }
  }
  return result
}

async function writeOldLayout(rootHandle: FileSystemDirectoryHandle, data: ProjectData): Promise<void> {
  for (const schema of data.schemas) {
    await writeOldSchema(rootHandle, schema)
  }
  for (const [key, initial] of data.initialData) {
    const [schemaName = '', tableName = ''] = key.split('/')
    await writeOldInitialData(rootHandle, schemaName, tableName, initial)
  }
  if (data.common) {
    await writeOldCommon(rootHandle, data.common)
  }
}

async function writeOldSchema(
  rootHandle: FileSystemDirectoryHandle,
  schema: Schema,
): Promise<void> {
  const sdHandle = await getSchemasDir(rootHandle)
  const handle = await sdHandle.getFileHandle(`${sanitizeName(schema.schema)}.json`, { create: true })
  await writeJsonFile(handle, schema)
}

async function writeOldCommon(
  rootHandle: FileSystemDirectoryHandle,
  common: CommonDocument,
): Promise<void> {
  const handle = await getCommonFileHandle(rootHandle)
  await writeJsonFile(handle, common)
}

async function writeOldInitialData(
  rootHandle: FileSystemDirectoryHandle,
  schemaName: string,
  tableName: string,
  data: unknown,
): Promise<void> {
  const idHandle = await getInitialDataDir(rootHandle)
  const schemaDir = await idHandle.getDirectoryHandle(sanitizeName(schemaName), { create: true })
  const handle = await schemaDir.getFileHandle(`${sanitizeName(tableName)}.json`, { create: true })
  await writeJsonFile(handle, data)
}

// ─────────────────────────────── New layout read/write ───────────────────────────────

async function readNewLayout(rootHandle: FileSystemDirectoryHandle): Promise<ProjectData> {
  const currentDir = await getCurrentDir(rootHandle, false)
  const common = await readNewCommon(currentDir)
  const schemas = await readNewSchemas(currentDir)
  const initialData = await readNewInitialData(currentDir)
  return { common, schemas, initialData }
}

async function readNewCommon(currentDir: FileSystemDirectoryHandle): Promise<CommonDocument | null> {
  try {
    const handle = await getCurrentDatabaseFileHandle(currentDir, false)
    return await readJsonFile<CommonDocument>(handle)
  } catch {
    return null
  }
}

async function readNewSchemas(currentDir: FileSystemDirectoryHandle): Promise<Schema[]> {
  const result: Schema[] = []
  const schemasDir = await getCurrentSchemasDir(currentDir, false)
  for await (const schemaEntry of schemasDir.values()) {
    if (schemaEntry.kind !== 'directory') continue
    const schemaDir = schemaEntry as FileSystemDirectoryHandle
    for await (const tableEntry of schemaDir.values()) {
      if (tableEntry.kind !== 'directory') continue
      const tableDir = tableEntry as FileSystemDirectoryHandle
      try {
        const handle = await getTableFileHandle(tableDir, false)
        const tableJson = await readJsonFile<TableDocument>(handle)
        // New layout table.json structure: { schema, table } or already flattened;
        // normalized into the unified in-memory state
        const schemaName = schemaNameFromTable(tableJson) ?? schemaEntry.name
        let schema = result.find((s) => s.schema === schemaName)
        if (!schema) {
          schema = { schema: schemaName, tables: [] } as Schema
          result.push(schema)
        }
        schema.tables.push((tableJson.table ?? tableJson) as Table)
      } catch (e) {
        console.warn(`[structure-io] failed to parse table "${schemaEntry.name}/${tableEntry.name}":`, e)
      }
    }
  }
  return result
}

async function readNewInitialData(
  currentDir: FileSystemDirectoryHandle,
): Promise<Map<string, InitialData>> {
  const map = new Map<string, InitialData>()
  const schemasDir = await getCurrentSchemasDir(currentDir, false)
  for await (const schemaEntry of schemasDir.values()) {
    if (schemaEntry.kind !== 'directory') continue
    const schemaDir = schemaEntry as FileSystemDirectoryHandle
    for await (const tableEntry of schemaDir.values()) {
      if (tableEntry.kind !== 'directory') continue
      const tableDir = tableEntry as FileSystemDirectoryHandle
      try {
        const handle = await getInitialDataFileHandle(tableDir, false)
        const raw = await readJsonFile<unknown>(handle)
        const normalized = normalizeInitialData(raw)
        if (normalized) map.set(`${schemaEntry.name}/${tableEntry.name}`, normalized)
      } catch {
        // no initial-data.json
      }
    }
  }
  return map
}

async function writeNewLayout(rootHandle: FileSystemDirectoryHandle, data: ProjectData): Promise<void> {
  const currentDir = await getCurrentDir(rootHandle)
  if (data.common) {
    const handle = await getCurrentDatabaseFileHandle(currentDir)
    await writeJsonFile(handle, data.common)
  }
  const schemasDir = await getCurrentSchemasDir(currentDir)
  for (const schema of data.schemas) {
    const schemaDir = await getSchemaDirUnderCurrent(schemasDir, schema.schema)
    for (const table of schema.tables) {
      const tableDoc = table as TableDocument
      const tableName = tableDoc.name ?? tableDoc.table?.name
      if (!tableName) continue
      const tableDir = await getTableDirUnderSchema(schemaDir, tableName)
      const tableHandle = await getTableFileHandle(tableDir)
      await writeJsonFile(tableHandle, { schema: schema.schema, table })
      const key = `${schema.schema}/${tableName}`
      const initial = data.initialData.get(key)
      if (initial) {
        const initHandle = await getInitialDataFileHandle(tableDir)
        await writeJsonFile(initHandle, buildInitialDataExport(initial))
      }
    }
  }
}

// ─────────────────────────────── Public API ───────────────────────────────

function schemaNameFromTable(tableJson: TableDocument): string | undefined {
  if (typeof tableJson?.schema === 'string') return tableJson.schema
  if (typeof tableJson?.table?.schema === 'string') return tableJson.table.schema
  return undefined
}

function mapFromPairs(pairs: { key: string; data: InitialData }[]): Map<string, InitialData> {
  const map = new Map<string, InitialData>()
  for (const { key, data } of pairs) map.set(key, data)
  return map
}

/**
 * Read the project's full data into the unified in-memory state (automatically choosing the
 * old/new layout based on the version). After calling this, migration scripts only need to focus
 * on field-level changes.
 *
 * @param rootHandle project root directory handle
 * @param version    current structure version (decides whether to read the old or new layout)
 */
export async function readProject(
  rootHandle: FileSystemDirectoryHandle,
  version: string,
): Promise<ProjectData> {
  return isNewLayout(version) ? readNewLayout(rootHandle) : readOldLayout(rootHandle)
}

/**
 * Write the unified in-memory state back to disk (automatically choosing the old/new layout based
 * on the version). Used together with readProject: readProject(version) → change fields →
 * writeProject(version).
 *
 * @param rootHandle project root directory handle
 * @param version    target structure version (decides whether to write the old or new layout)
 * @param data       in-memory project data
 */
export async function writeProject(
  rootHandle: FileSystemDirectoryHandle,
  version: string,
  data: ProjectData,
): Promise<void> {
  return isNewLayout(version) ? writeNewLayout(rootHandle, data) : writeOldLayout(rootHandle, data)
}

/**
 * Only update common.struct_version (leaving all other data untouched).
 * The vast majority of data-level steps only need to advance the version number and can call this
 * directly.
 */
export async function bumpVersion(
  rootHandle: FileSystemDirectoryHandle,
  version: string,
  nextVersion: string,
): Promise<void> {
  const data = await readProject(rootHandle, version)
  if (data.common) {
    data.common.struct_version = nextVersion
    await writeProject(rootHandle, version, data)
  }
}
