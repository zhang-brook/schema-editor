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

// ===== Initial Data 文件读写 =====

/**
 * 将初始数据写入 current/schemas/<schema>/<table>/initial-data.json
 * v1.1+：永远使用行内结构（rows: [{ data, field_comments?, is_skip?, row_comment? }]）。
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

  // 构建干净的导出对象（行内结构，只写非空字段）
  const exportData = buildInitialDataExport(data)

  await writeJsonFile(handle, exportData)
}

// ===== Initial Data 文件读取与归一化 =====

/**
 * 从 initial-data/ 目录读取所有初始数据文件
 * 向后兼容：旧格式纯数组自动升级为 { rows: [...] }
 * // 以前: 返回 [{ key: "schemaName/tableName", data: [...] }, ...]
 */
export async function readInitialDataFromHandle(
  rootHandle: FileSystemDirectoryHandle
): Promise<{ key: string; data: InitialData }[]> {
  const result: { key: string; data: InitialData }[] = []

  let initialDataHandle: FileSystemDirectoryHandle
  try {
    initialDataHandle = await getInitialDataDir(rootHandle, false)
  } catch {
    // initial-data/ 目录不存在，返回空
    return result
  }

  // 遍历 schema 子目录
  for await (const schemaEntry of initialDataHandle.values()) {
    const schemaHandle: FileSystemDirectoryHandle | FileSystemFileHandle = schemaEntry
    if (schemaHandle.kind !== 'directory') continue
    const schemaName: string = schemaHandle.name

    // 遍历每个 schema 目录下的 .json 文件
    for await (const fileEntry of schemaHandle.values()) {
      const fHandle: FileSystemFileHandle | FileSystemDirectoryHandle = fileEntry
      const fName: string = fHandle.name
      if (!fName.endsWith('.json') || fHandle.kind !== 'file') continue

      const tableName = fName.slice(0, -5) // 去掉 .json
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
 * 归一化原始 JSON 数据为行内 InitialData 结构（幂等）。
 * 兼容三种输入：
 *   1. 纯数组 [...]          → { rows: [{ data: r }] }
 *   2. 旧「平行数组」对象     → 合并 rows/row_comments/field_comments/skip_rows 为行内
 *   3. 新「行内」对象         → 原样返回（rows 元素带 data）
 */
export function normalizeInitialData(raw: unknown): InitialData | null {
  // 纯数组：直接包成行内 rows
  if (Array.isArray(raw)) {
    return { rows: raw.map((r: unknown) => ({ data: (r ?? {}) as JsonObject })) }
  }

  if (raw && typeof raw === 'object') {
    // 磁盘旧格式按 LegacyInitialData 视图取值，内部逐字段仍做运行时防御
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
 * 将「平行数组」或「已行内化」的 rows 统一合并为行内 InitialDataRow[]（幂等）。
 * - 若 rows 元素已是 { data: ... } 行内格式，原样保留（补齐平行数组中的注释/跳过标记）。
 * - 若 rows 元素是裸数据对象（旧格式），则包成 { data: ... } 并从平行数组读取注释/跳过标记。
 */
function mergeToInlineRows(obj: LegacyInitialData): InitialDataRow[] {
  const rows = obj.rows ?? []
  const rowComments = obj.row_comments
  const fieldComments = obj.field_comments
  const skipRows = obj.skip_rows

  return rows.map((r, i) => {
    const raw = r ?? {}
    // 已是行内格式（带 data 键）：原样沿用，仅在缺省时从平行数组补齐
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

/** 写出到 initial-data.json 的干净文档（行内结构，只含非空字段）；用 type 别名以便结构式赋值 */
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
 * 构建行内 InitialData 的干净导出对象：只写非空字段，保持磁盘文件精简。
 * 每行仅在有值时输出 field_comments / is_skip / row_comment。
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
