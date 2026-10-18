import type { InitialData, InitialDataRow, JsonObject, LegacyInitialData, SqlStatements } from '../types/schema'
import {
  getCurrentDir,
  getCurrentSchemasDir,
  getSchemaDirUnderCurrent,
  getTableDirUnderSchema,
  getInitialDataFileHandle,
  getInitialDataDir,
} from '../core/workspace/paths'
import { writeJsonFile } from '../core/workspace/handles'
import { sanitizeName } from '../core/workspace/layout'

// ===== Initial Data file read/write =====

/**
 * Write initial data to current/schemas/<schema>/<table>/initial-data.json
 * v1.1+: always uses the inline structure (rows: [{ data, field_comments?, is_skip?, row_comment? }]).
 */
export async function writeInitialDataToNewStructure(
  rootHandle: FileSystemDirectoryHandle,
  schemaName: string,
  tableName: string,
  data: InitialData,
): Promise<void> {
  const currentDir = await getCurrentDir(rootHandle)
  const schemasDir = await getCurrentSchemasDir(currentDir)
  const schemaDir = await getSchemaDirUnderCurrent(schemasDir, sanitizeName(schemaName))
  const tableDir = await getTableDirUnderSchema(schemaDir, sanitizeName(tableName))
  const handle = await getInitialDataFileHandle(tableDir)

  // Build a clean export object (inline structure, only non-empty fields)
  const exportData = buildInitialDataExport(data)

  await writeJsonFile(handle, exportData)
}

// ===== Initial Data file reading and normalization =====

/**
 * Read all initial data files from the initial-data/ directory
 * Backward compatible: the old plain-array format is automatically upgraded to { rows: [...] }
 * // Previously: returned [{ key: "schemaName/tableName", data: [...] }, ...]
 */
export async function readInitialDataFromHandle(
  rootHandle: FileSystemDirectoryHandle
): Promise<{ key: string; data: InitialData }[]> {
  const result: { key: string; data: InitialData }[] = []

  let initialDataHandle: FileSystemDirectoryHandle
  try {
    initialDataHandle = await getInitialDataDir(rootHandle, false)
  } catch {
    // initial-data/ directory does not exist, return empty
    return result
  }

  // Iterate over schema subdirectories
  for await (const schemaEntry of initialDataHandle.values()) {
    const schemaHandle: FileSystemDirectoryHandle | FileSystemFileHandle = schemaEntry
    if (schemaHandle.kind !== 'directory') continue
    const schemaName: string = schemaHandle.name

    // Iterate over the .json files in each schema directory
    for await (const fileEntry of schemaHandle.values()) {
      const fHandle: FileSystemFileHandle | FileSystemDirectoryHandle = fileEntry
      const fName: string = fHandle.name
      if (!fName.endsWith('.json') || fHandle.kind !== 'file') continue

      const tableName = fName.slice(0, -5) // strip .json
      try {
        const file = await fHandle.getFile()
        const parsed = JSON.parse(await file.text())
        const normalized = normalizeInitialData(parsed)
        if (normalized) {
          result.push({ key: `${schemaName}/${tableName}`, data: normalized })
          console.log(`[readInitialData] loaded "${schemaName}/${tableName}" (${normalized.rows?.length ?? 0} rows)`)
        } else {
          console.warn(`[readInitialData] "${schemaName}/${fName}" invalid format, skipping`)
        }
      } catch (e) {
        console.warn(`[readInitialData] failed to parse "${schemaName}/${fName}":`, e)
      }
    }
  }

  return result
}

/**
 * Normalizes raw JSON data into the inline InitialData structure (idempotent).
 * Handles three input shapes:
 *   1. plain array [...]            → { rows: [{ data: r }] }
 *   2. old "parallel arrays" object → merges rows/row_comments/field_comments/skip_rows into inline rows
 *   3. new "inline" object          → returned as-is (rows elements carry data)
 */
export function normalizeInitialData(raw: unknown): InitialData | null {
  // Plain array: wrap directly into inline rows
  if (Array.isArray(raw)) {
    return { rows: raw.map((r: unknown) => ({ data: (r ?? {}) as JsonObject })) }
  }

  if (raw && typeof raw === 'object') {
    // The old on-disk format is read through the LegacyInitialData view, with per-field runtime guards
    const obj = raw as LegacyInitialData
    const result: InitialData = {}

    if (Array.isArray(obj.rows)) {
      result.rows = mergeToInlineRows(obj)
    }
    if (obj.pre_sql && typeof obj.pre_sql === 'object') result.pre_sql = { ...obj.pre_sql }
    if (obj.post_sql && typeof obj.post_sql === 'object') result.post_sql = { ...obj.post_sql }
    return result
  }

  return null
}

/**
 * Merges "parallel array" or already-inlined rows into inline InitialDataRow[] (idempotent).
 * - If a rows element is already inline ({ data: ... }), keep it as-is (fill in comments/skip marks from the parallel arrays).
 * - If a rows element is a bare data object (old format), wrap it as { data: ... } and read comments/skip marks from the parallel arrays.
 */
function mergeToInlineRows(obj: LegacyInitialData): InitialDataRow[] {
  const rows = obj.rows ?? []
  const rowComments = obj.row_comments
  const fieldComments = obj.field_comments
  const skipRows = obj.skip_rows

  return rows.map((r, i) => {
    const raw = r ?? {}
    // Already inline (has a data key): keep as-is, fill from the parallel arrays only when missing
    const isInline = raw.data !== undefined && typeof raw.data === 'object'
    const row: InitialDataRow = isInline
      ? {
          data: (raw.data ?? {}) as JsonObject,
          ...(raw.field_comments ? { field_comments: raw.field_comments as Record<string, string> } : {}),
          ...(raw.expr_fields ? { expr_fields: raw.expr_fields as Record<string, boolean> } : {}),
          ...(raw.is_skip === true ? { is_skip: true } : {}),
          ...(raw.row_comment ? { row_comment: raw.row_comment as string } : {}),
        }
      : { data: raw }

    if (!isInline) {
      const fc = fieldComments?.[i]
      if (fc && Object.keys(fc).length > 0) row.field_comments = { ...fc }

      if (skipRows?.[i] === true) row.is_skip = true

      const rc = rowComments?.[i]
      if (rc) row.row_comment = rc
    }

    return row
  })
}

/** Clean document written to initial-data.json (inline structure, non-empty fields only); a type alias to allow structural assignment */
type InlineRowExport = {
  data: JsonObject
  field_comments?: Record<string, string>
  expr_fields?: Record<string, boolean>
  is_skip?: true
  row_comment?: string
}

type InitialDataExportDocument = {
  rows?: InlineRowExport[]
  pre_sql?: SqlStatements
  post_sql?: SqlStatements
}

/**
 * Builds a clean export object for inline InitialData: writes only non-empty fields to keep on-disk files lean.
 * Each row emits field_comments / is_skip / row_comment only when they have values.
 */
export function buildInitialDataExport(data: InitialData): InitialDataExportDocument {
  const exportData: InitialDataExportDocument = {}

  if (data.rows) {
    exportData.rows = data.rows.map(row => {
      const out: InlineRowExport = { data: row.data }
      if (row.field_comments && Object.keys(row.field_comments).length > 0) {
        out.field_comments = row.field_comments
      }
      if (row.expr_fields && Object.keys(row.expr_fields).length > 0) {
        out.expr_fields = row.expr_fields
      }
      if (row.is_skip === true) out.is_skip = true
      if (row.row_comment) out.row_comment = row.row_comment
      return out
    })
  }

  const hasPreSql = !!(data.pre_sql && Object.keys(data.pre_sql).length > 0)
  if (hasPreSql) exportData.pre_sql = data.pre_sql
  const hasPostSql = !!(data.post_sql && Object.keys(data.post_sql).length > 0)
  if (hasPostSql) exportData.post_sql = data.post_sql

  return exportData
}
