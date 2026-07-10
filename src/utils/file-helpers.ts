import { toRaw } from 'vue'
import type { InitialData, Schema, Table } from '@/types/schema'
import {
  getCommonFileHandle,
  getSchemasDir,
  getInitialDataDir,
  getOldInitialDataFileHandle,
  removeOldInitialDataFile,
  getOutputDir,
  getOutputDialectDir,
  getOutputSqlFileHandle,
  removeOutputSqlFile,
  // ===== 新结构（current/）路径解析 =====
  getCurrentDir,
  getCurrentDatabaseFileHandle,
  getCurrentSchemasDir,
  getSchemaDirUnderCurrent,
  getTableDirUnderSchema,
  getTableFileHandle,
  getInitialDataFileHandle,
} from '@/core/workspace/paths'
import { CURRENT_STRUCT_VERSION } from '@/core/workspace/layout'
import {
  getOrCreateDir,
  getFileHandleSafe,
  readJsonFile,
  writeJsonFile,
  removeEntry,
} from '@/core/workspace/handles'
import {
  SCHEMAS_DIR,
  CURRENT_DIR,
  DATABASE_FILE,
  SCHEMA_FILE,
  TABLE_FILE,
  INITIAL_DATA_FILE,
  sanitizeName,
} from '@/core/workspace/layout'

const jsonFileIndent = 4

// ===== File System Access API —— 基于 handle 的文件夹读写 =====

/**
 *  检查浏览器是否支持 File System Access API
 *
 * see: https://developer.mozilla.org/zh-CN/docs/Web/API/File_System_API
 */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/**
 * 弹出文件夹选择器（或接收已拖入的 handle），读取项目结构：
 *   - common.json（根目录）
 *   - schema/ 子目录下的所有 .json 文件
 * 返回 { rootHandle, schemaHandle, commonData, schemaFiles[] }
 */
export async function openProjectFolder(rootHandle?: FileSystemDirectoryHandle): Promise<{
  rootHandle: FileSystemDirectoryHandle
  schemaHandle: FileSystemDirectoryHandle
  commonData: unknown | null
  schemaFiles: { name: string; data: unknown }[]
}> {
  const resolvedRootHandle: FileSystemDirectoryHandle = rootHandle ?? await window.showDirectoryPicker()
  let commonData: unknown | null = null
  let schemaHandle: FileSystemDirectoryHandle | null = null
  const schemaFiles: { name: string; data: unknown }[] = []

  // 逐条扫描根目录
  for await (const entry of resolvedRootHandle.values()) {
    const handle: FileSystemFileHandle | FileSystemDirectoryHandle = entry
    const name: string = handle.name
    console.log(`[openProjectFolder] root entry: "${name}" kind=${handle.kind}`)

    if (name === 'common.json' && handle.kind === 'file') {
      try {
        const file = await handle.getFile()
        commonData = JSON.parse(await file.text())
        console.log('[openProjectFolder] common.json loaded')
      } catch (e) { console.warn('[openProjectFolder] common.json parse error:', e) }
    }

    if (name === SCHEMAS_DIR && handle.kind === 'directory') {
      schemaHandle = handle
      console.log('[openProjectFolder] schemas/ directory found')
    }
  }

  // 读取 schemas/ 子目录
  try {
    const sdHandle = await getSchemasDir(resolvedRootHandle)
    schemaHandle = sdHandle
    console.log('[openProjectFolder] iterating schemas/ entries...')
    for await (const entry of sdHandle.values()) {
      const fHandle: FileSystemFileHandle | FileSystemDirectoryHandle = entry
      const fName: string = fHandle.name
      console.log(`[openProjectFolder]   schemas entry: "${fName}" kind=${fHandle.kind}`)
      if (fName.endsWith('.json') && fHandle.kind === 'file') {
        try {
          const file = await fHandle.getFile()
          schemaFiles.push({ name: fName, data: JSON.parse(await file.text()) })
          console.log(`[openProjectFolder]   -> loaded "${fName}"`)
        } catch (e) { console.warn(`[openProjectFolder]   -> failed "${fName}":`, e) }
      }
    }
    console.log(`[openProjectFolder] schema files found: ${schemaFiles.length}`)
  } catch {
    console.log('[openProjectFolder] no schemas/ directory, creating one')
    schemaHandle = await getSchemasDir(resolvedRootHandle, true)
  }

  return { rootHandle: resolvedRootHandle, schemaHandle, commonData, schemaFiles }
}

// ===== 新结构（current/）读写 =====
//
// 目录布局：
//   common.json                      根配置（default_config / unified_types / common_used_fields）
//   current/
//     database.json                  schema_order（按基线可能不同的项）
//     schemas/
//       <schema>/                   文件名友好的模式名（sanitizeName）
//         schema.json               { schema: 原始名, table_order: string[] }
//         <table>/                  文件名友好的表名
//           table.json              单表定义
//           initial-data.json       行内化初始数据（对象格式）
//
// 旧的 schemas/、initial-data/ 平行目录仅在「从旧结构迁移」(migrateOldToNewStructure) 时读取。

export interface NewStructureProject {
  rootHandle: FileSystemDirectoryHandle
  /** current/database.json 内容（含 schema_order） */
  databaseData: { schema_order?: string[] } | null
  /** 每个 schema 的原始名、table 排序、已加载的表定义 */
  schemas: {
    schema: string
    table_order: string[]
    tables: Table[]
  }[]
  /** 行内化的初始数据，key 为 `${schemaName}/${tableName}` */
  initialData: { key: string; data: InitialData }[]
}

/**
 * 判断根目录是否已是最新结构。
 *
 * 以根 common.json 中的 struct_version 与代码中 CURRENT_STRUCT_VERSION 比对，
 * 而非依赖 current/ 目录是否存在（空目录残留会误判为已升级）。
 * 版本 >= 当前版本即视为新结构；无 common.json 或版本更低则视为旧结构，需升级。
 */
export async function isNewStructure(rootHandle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const commonHandle = await getCommonFileHandle(rootHandle, false)
    const data = await readJsonFile<{ struct_version?: string }>(commonHandle)
    const version = data?.struct_version || '0.0'
    return compareStructVersion(version, CURRENT_STRUCT_VERSION) >= 0
  } catch {
    // 无根 common.json：视为旧结构，需走升级流程
    return false
  }
}

/** 语义化版本比较：a >= b 返回 >= 0，a < b 返回 < 0（仅比较数字段，忽略非数字后缀） */
function compareStructVersion(a: string, b: string): number {
  const aParts = a.split('.').map((n) => parseInt(n, 10) || 0)
  const bParts = b.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(aParts.length, bParts.length)
  for (let i = 0; i < len; i++) {
    const diff = (aParts[i] || 0) - (bParts[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * 打开新结构项目：读取 current/database.json + 各 table.json + 各 initial-data.json。
 * 调用前不要求 current/ 已存在——若没有则返回一个空项目骨架（由调用方后续写盘创建）。
 */
export async function openProjectFolderNew(rootHandle?: FileSystemDirectoryHandle): Promise<NewStructureProject> {
  const resolvedRootHandle: FileSystemDirectoryHandle = rootHandle ?? await window.showDirectoryPicker()

  const result: NewStructureProject = {
    rootHandle: resolvedRootHandle,
    databaseData: null,
    schemas: [],
    initialData: [],
  }

  let currentDir: FileSystemDirectoryHandle
  try {
    currentDir = await getCurrentDir(resolvedRootHandle, false)
  } catch {
    // 尚未有新结构，返回空骨架（首次打开空白项目）
    return result
  }

  // 读取 current/database.json
  try {
    const dbHandle = await getCurrentDatabaseFileHandle(currentDir, false)
    result.databaseData = await readJsonFile<{ schema_order?: string[] }>(dbHandle)
  } catch {
    result.databaseData = null
  }

  // 读取 current/schemas/ 下的各 schema 目录
  let schemasDir: FileSystemDirectoryHandle
  try {
    schemasDir = await getCurrentSchemasDir(currentDir, false)
  } catch {
    return result
  }

  for await (const schemaEntry of schemasDir.values()) {
    if (schemaEntry.kind !== 'directory') continue
    const schemaDir = schemaEntry as FileSystemDirectoryHandle

    // 读 schema.json
    let schemaMeta: { schema?: string; table_order?: string[] } = {}
    try {
      const schemaJsonHandle = await getFileHandleSafe(schemaDir, SCHEMA_FILE, false)
      schemaMeta = await readJsonFile(schemaJsonHandle)
    } catch {
      // 无 schema.json 跳过该目录
      continue
    }
    if (!schemaMeta.schema) continue

    const loadedSchema = {
      schema: schemaMeta.schema,
      table_order: schemaMeta.table_order ?? [],
      tables: [] as Table[],
    }

    // 遍历该 schema 下的 table 目录
    for await (const tableEntry of schemaDir.values()) {
      if (tableEntry.kind !== 'directory') continue
      const tableDir = tableEntry as FileSystemDirectoryHandle

      // 读 table.json
      let tableData: Table | null = null
      try {
        const tableJsonHandle = await getTableFileHandle(tableDir, false)
        tableData = await readJsonFile<Table>(tableJsonHandle)
      } catch {
        tableData = null
      }
      if (!tableData || !tableData.name) continue

      // 补全缺省字段（与旧加载逻辑一致）
      if (!tableData.indexes) tableData.indexes = []
      if (!tableData.fields) tableData.fields = []
      loadedSchema.tables.push(tableData)

      // 读 initial-data.json（可选）
      try {
        const initHandle = await getInitialDataFileHandle(tableDir, false)
        const initParsed = await readJsonFile(initHandle)
        const normalized = normalizeInitialData(initParsed)
        if (normalized) {
          result.initialData.push({
            key: `${schemaMeta.schema}/${tableData.name}`,
            data: normalized,
          })
        }
      } catch {
        // 无 initial-data.json，跳过
      }
    }

    // 按 table_order 排序（不在列表中的保留原位）
    const order = loadedSchema.table_order
    if (order.length > 0) {
      const orderMap = new Map<string, number>()
      order.forEach((name, i) => orderMap.set(name, i))
      loadedSchema.tables.sort((a, b) => {
        const ai = orderMap.get(a.name)
        const bi = orderMap.get(b.name)
        if (ai === undefined && bi === undefined) return 0
        if (ai === undefined) return 1
        if (bi === undefined) return -1
        return ai - bi
      })
    }

    result.schemas.push(loadedSchema)
  }

  // 按 schema_order 排序（不在列表中的保留原位）
  const schemaOrder = result.databaseData?.schema_order ?? []
  if (schemaOrder.length > 0) {
    const orderMap = new Map<string, number>()
    schemaOrder.forEach((name, i) => orderMap.set(name, i))
    result.schemas.sort((a, b) => {
      const ai = orderMap.get(a.schema)
      const bi = orderMap.get(b.schema)
      if (ai === undefined && bi === undefined) return 0
      if (ai === undefined) return 1
      if (bi === undefined) return -1
      return ai - bi
    })
  }

  return result
}

/** 将 database.json 写入 current/ */
export async function writeDatabaseToHandle(
  rootHandle: FileSystemDirectoryHandle,
  data: { schema_order?: string[] },
): Promise<void> {
  const currentDir = await getCurrentDir(rootHandle)
  const handle = await getCurrentDatabaseFileHandle(currentDir)
  await writeJsonFile(handle, data)
}

/** 将 schema.json 写入 current/schemas/<schema>/ */
export async function writeSchemaJsonToHandle(
  rootHandle: FileSystemDirectoryHandle,
  schemaName: string,
  data: { schema: string; table_order: string[] },
): Promise<void> {
  const currentDir = await getCurrentDir(rootHandle)
  const schemasDir = await getCurrentSchemasDir(currentDir)
  const schemaDir = await getSchemaDirUnderCurrent(schemasDir, sanitizeName(schemaName))
  const handle = await getFileHandleSafe(schemaDir, SCHEMA_FILE)
  await writeJsonFile(handle, data)
}

/** 将单表 table.json 写入 current/schemas/<schema>/<table>/ */
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

/** 删除整张表目录 current/schemas/<schema>/<table>/ */
export async function deleteTableDirFromHandle(
  rootHandle: FileSystemDirectoryHandle,
  schemaName: string,
  tableName: string,
): Promise<void> {
  try {
    const currentDir = await getCurrentDir(rootHandle, false)
    const schemasDir = await getCurrentSchemasDir(currentDir, false)
    const schemaDir = await getSchemaDirUnderCurrent(schemasDir, sanitizeName(schemaName), false)
    await removeEntry(schemaDir, sanitizeName(tableName), { recursive: true })
  } catch {
    // 目录不存在，静默忽略
  }
}

/**
 * 清理某 schema 目录下「磁盘存在、但内存态已不存在」的表目录。
 *
 * 用于修复「表名变更时旧 table.json 未被删除、仅创建了新目录」的问题：
 * 表名经 auto-sync 直接双向绑定改名后，旧目录 current/schemas/<schema>/<oldTable>/
 * 仍残留，本函数依据内存态中的真实表名集合，删除已失效的表目录。
 *
 * 仅删除不在 `currentTableNames`（sanitize 后的磁盘友好名集合）中的表子目录，
 * 不会误删仍在使用的表目录。
 */
export async function pruneTableDirsFromHandle(
  rootHandle: FileSystemDirectoryHandle,
  schemaName: string,
  currentTableNames: string[],
): Promise<void> {
  // 大小写不敏感匹配：Windows 等大小写不敏感文件系统上，磁盘目录名可能与
  // 表名大小写不同（如 users / Users 指向同一物理目录）。若用大小写敏感的
  // Set 判断，会误将「正在使用」的目录当作失效目录删掉，进而连带删除其中的
  // initial-data.json（详见 renameTable 场景）。
  const validNames = new Set(currentTableNames.map(name => sanitizeName(name).toLowerCase()))
  try {
    const currentDir = await getCurrentDir(rootHandle, false)
    const schemasDir = await getCurrentSchemasDir(currentDir, false)
    const schemaDir = await getSchemaDirUnderCurrent(schemasDir, sanitizeName(schemaName), false)

    for await (const entry of schemaDir.values()) {
      if (entry.kind !== 'directory') continue
      // 跳过 schema.json 之外的非表目录（理论上 schema 目录下只有 table 子目录 + schema.json）
      if (validNames.has(entry.name.toLowerCase())) continue
      await removeEntry(schemaDir, entry.name, { recursive: true })
    }
  } catch {
    // schema 目录不存在，静默忽略
  }
}

/** 删除整个 schema 目录 current/schemas/<schema>/ */
export async function deleteSchemaDirFromHandle(
  rootHandle: FileSystemDirectoryHandle,
  schemaName: string,
): Promise<void> {
  try {
    const currentDir = await getCurrentDir(rootHandle, false)
    const schemasDir = await getCurrentSchemasDir(currentDir, false)
    await removeEntry(schemasDir, sanitizeName(schemaName), { recursive: true })
  } catch {
    // 目录不存在，静默忽略
  }
}

/**
 * 将初始数据写入 current/schemas/<schema>/<table>/initial-data.json
 * v0.3+：永远使用完整对象格式。
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

  // 构建干净的导出对象，只包含已配置的属性
  const exportData: Record<string, any> = {}
  if (data.rows) exportData.rows = toRaw(data.rows)
  if (data.row_comments && !isAllNull(data.row_comments)) {
    exportData.row_comments = toRaw(data.row_comments)
  }
  if (data.field_comments && !isAllNull(data.field_comments)) {
    exportData.field_comments = toRaw(data.field_comments)
  }
  if (data.skip_rows && !isAllNull(data.skip_rows)) {
    exportData.skip_rows = toRaw(data.skip_rows)
  }
  const hasPreSql = !!(data.pre_sql && (data.pre_sql.mysql || data.pre_sql.postgresql))
  if (hasPreSql) exportData.pre_sql = toRaw(data.pre_sql)
  const hasPostSql = !!(data.post_sql && (data.post_sql.mysql || data.post_sql.postgresql))
  if (hasPostSql) exportData.post_sql = toRaw(data.post_sql)

  await writeJsonFile(handle, exportData)
}

/** 删除 current/schemas/<schema>/<table>/initial-data.json */
export async function deleteInitialDataFromNewStructure(
  rootHandle: FileSystemDirectoryHandle,
  schemaName: string,
  tableName: string,
): Promise<void> {
  try {
    const currentDir = await getCurrentDir(rootHandle, false)
    const schemasDir = await getCurrentSchemasDir(currentDir, false)
    const schemaDir = await getSchemaDirUnderCurrent(schemasDir, sanitizeName(schemaName), false)
    const tableDir = await getTableDirUnderSchema(schemaDir, sanitizeName(tableName), false)
    await removeEntry(tableDir, INITIAL_DATA_FILE)
  } catch {
    // 文件或目录不存在，静默忽略
  }
}

// ===== 旧结构 → 新结构迁移（打开旧项目时一次性触发） =====

/**
 * 将已准备好的内存态（旧结构经升级器处理后的结果）写入新结构磁盘布局。
 * 旧文件保留不删除（便于回退）。写盘后该项目即成为新结构。
 *
 * @param commonConfig  保留在根 common.json 的部分（与基线无关的配置）
 * @param databaseData  current/database.json 内容（schema_order 等）
 * @param schemas       升级后的完整内存态（含 tables）
 * @param transformTable 将内存态中的单表转换为可写出的 table.json 对象
 * @param initialData   行内化到各 table 目录的初始数据
 */
export async function migrateOldToNewStructure(
  rootHandle: FileSystemDirectoryHandle,
  data: {
    commonConfig: any
    databaseData: { schema_order?: string[] }
    schemas: Schema[]
    transformTable: (schema: Schema, table: Table) => Table
    initialData: { key: string; data: InitialData }[]
  },
): Promise<void> {
  // 1. 根 common.json（仅保留与基线无关的配置）
  await writeCommonToHandle(rootHandle, data.commonConfig)

  // 2. current/database.json
  await writeDatabaseToHandle(rootHandle, data.databaseData)

  // 3. 各 schema 目录与 table 目录
  for (const schema of data.schemas) {
    const tableOrder = schema.tables.map(t => t.name)
    await writeSchemaJsonToHandle(rootHandle, schema.schema, {
      schema: schema.schema,
      table_order: tableOrder,
    })
    for (const table of schema.tables) {
      const transformed = data.transformTable(schema, table)
      await writeTableToHandle(rootHandle, schema.schema, transformed)
    }
  }

  // 4. initial-data 行内化到各 table 目录
  for (const { key, data: initData } of data.initialData) {
    const sep = key.indexOf('/')
    const schemaName = key.substring(0, sep)
    const tableName = key.substring(sep + 1)
    await writeInitialDataToNewStructure(rootHandle, schemaName, tableName, initData)
  }
}

/**
 * 迁移完成后清理「已迁移」的旧结构文件，杜绝回退导致新结构字段丢失。
 *
 * 原则：升级了哪里就处理哪里——只删除已被整体迁移的旧文件，不删除整个目录
 * （目录可能含用户其他无关文件）：
 *   - 每个旧 schemas/<schema>.json（已迁移为 current/schemas/<schema>/ 下文件）
 *   - 每个旧 initial-data/<schema>/<table>.json（已行内化为 current/.../initial-data.json）
 * 旧根 common.json 在迁移时已被覆盖重写为新结构，无需删除。
 */
export async function cleanupOldStructure(
  rootHandle: FileSystemDirectoryHandle,
  oldSchemas: Schema[],
  oldInitialDataKeys: string[],
): Promise<void> {
  // 1. 删除旧 schemas/<schema>.json
  try {
    const sdHandle = await getSchemasDir(rootHandle, false)
    for (const schema of oldSchemas) {
      await removeEntry(sdHandle, `${sanitizeName(schema.schema)}.json`)
    }
  } catch {
    // 无 schemas/ 目录，跳过
  }

  // 2. 删除旧 initial-data/<schema>/<table>.json
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
        // 该旧 initial-data 文件不存在，跳过
      }
    }
  } catch {
    // 无 initial-data/ 目录，跳过
  }
}

/** 读取旧结构 schemas/*.json 到内存态（供迁移升级使用） */
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
    // 无 schemas/ 目录
  }
  return result
}

/**
 * 将数据写入 common.json
 */
export async function writeCommonToHandle(rootHandle: FileSystemDirectoryHandle, data: unknown): Promise<void> {
  const handle = await getCommonFileHandle(rootHandle)
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(toRaw(data), null, jsonFileIndent))
  await writable.close()
}

/**
 * 将 schema 数据写入 schema/<filename>.json
 */
export async function writeSchemaToHandle(schemaHandle: FileSystemDirectoryHandle, filename: string, data: unknown): Promise<void> {
  const handle = await schemaHandle.getFileHandle(filename, { create: true })
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(toRaw(data), null, jsonFileIndent))
  await writable.close()
}

/**
 * 从 schema/ 目录删除文件
 */
export async function deleteSchemaFromHandle(schemaHandle: FileSystemDirectoryHandle, filename: string): Promise<void> {
  await schemaHandle.removeEntry(filename)
}

/**
 * 将 SQL 文件写入 output/<dialect>/<filename>.sql
 * 目录不存在时自动创建
 */
export async function writeSqlToOutput(
  rootHandle: FileSystemDirectoryHandle,
  dialect: string,
  filename: string,
  content: string
): Promise<void> {
  const outputHandle = await getOutputDir(rootHandle)
  const dialectHandle = await getOutputDialectDir(outputHandle, dialect)
  const fileHandle = await getOutputSqlFileHandle(dialectHandle, filename)
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
}

/**
 * 从 output/<dialect>/ 目录删除文件
 */
export async function deleteSqlFromOutput(
  rootHandle: FileSystemDirectoryHandle,
  dialect: string,
  filename: string
): Promise<void> {
  try {
    const outputHandle = await getOutputDir(rootHandle, false)
    const dialectHandle = await getOutputDialectDir(outputHandle, dialect, false)
    await removeOutputSqlFile(dialectHandle, filename)
  } catch {
    // 文件可能不存在，忽略
  }
}

// ===== Initial Data 文件读写 =====

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

/** 归一化原始 JSON 数据为 InitialData 格式（v0.3+ 只接受对象格式，数组格式已由 structure-migrations 迁移） */
function normalizeInitialData(raw: unknown): InitialData | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, any>
    const result: InitialData = {}
    if (Array.isArray(obj.rows)) result.rows = obj.rows
    if (Array.isArray(obj.row_comments)) result.row_comments = obj.row_comments
    if (Array.isArray(obj.field_comments)) result.field_comments = obj.field_comments
    if (Array.isArray(obj.skip_rows)) result.skip_rows = obj.skip_rows
    if (obj.pre_sql && typeof obj.pre_sql === 'object') result.pre_sql = { ...obj.pre_sql }
    if (obj.post_sql && typeof obj.post_sql === 'object') result.post_sql = { ...obj.post_sql }
    return result
  }
  return null
}

/** 检查数组是否全为 null（或 undefined） */
function isAllNull(arr: (unknown | null)[] | undefined): boolean {
  if (!arr) return true
  return arr.every(v => v === null || v === undefined)
}

/**
 * 将初始数据写入 initial-data/<schemaName>/<tableName>.json
 * v0.3+：永远使用完整对象格式 { rows, row_comments?, field_comments?, pre_sql?, post_sql? }
 */
export async function writeInitialDataToHandle(
  rootHandle: FileSystemDirectoryHandle,
  schemaName: string,
  tableName: string,
  data: InitialData
): Promise<void> {
  const initialDataHandle = await getInitialDataDir(rootHandle)
  const schemaHandle = await getOrCreateDir(initialDataHandle, schemaName)
  const fileHandle = await getOldInitialDataFileHandle(schemaHandle, tableName)
  const writable = await fileHandle.createWritable()

  // 构建干净的导出对象，只包含已配置的属性
  const exportData: Record<string, any> = {}
  if (data.rows) exportData.rows = toRaw(data.rows)
  if (data.row_comments && !isAllNull(data.row_comments)) {
    exportData.row_comments = toRaw(data.row_comments)
  }
  if (data.field_comments && !isAllNull(data.field_comments)) {
    exportData.field_comments = toRaw(data.field_comments)
  }
  if (data.skip_rows && !isAllNull(data.skip_rows)) {
    exportData.skip_rows = toRaw(data.skip_rows)
  }
  const hasPreSql = !!(data.pre_sql && (data.pre_sql.mysql || data.pre_sql.postgresql))
  if (hasPreSql) exportData.pre_sql = toRaw(data.pre_sql)
  const hasPostSql = !!(data.post_sql && (data.post_sql.mysql || data.post_sql.postgresql))
  if (hasPostSql) exportData.post_sql = toRaw(data.post_sql)

  await writable.write(JSON.stringify(exportData, null, jsonFileIndent))
  await writable.close()
}

/**
 * 删除 initial-data/<schemaName>/<tableName>.json
 */
export async function deleteInitialDataFromHandle(
  rootHandle: FileSystemDirectoryHandle,
  schemaName: string,
  tableName: string
): Promise<void> {
  try {
    const initialDataHandle = await getInitialDataDir(rootHandle, false)
    const schemaHandle = await getOrCreateDir(initialDataHandle, schemaName, false)
    await removeOldInitialDataFile(schemaHandle, tableName)
  } catch {
    // 文件或目录不存在，静默忽略
  }
}

// ===== 业务无关的工具函数 =====


/**
 * 解析默认值输入
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
 * 格式化显示默认值
 */
export function displayDefault(val: any): string {
  if (val === undefined || val === null) return ''
  return String(val)
}

/**
 * 解析字段长度
 */
export function parseFieldLengthInput(val: string): number | null {
  if (val === '' || val === undefined || val === null) return null
  const str = String(val).trim()
  if (str === '') return null
  if (/^-?\d+$/.test(str)) return parseInt(str, 10)
  return null
}

/**
 * 格式化显示字段长度
 */
export function displayFieldLength(val: any): string {
  if (val === null || val === undefined) return ''
  return String(val)
}

/**
 * 解析字段小数位
 */
export function parseFieldScaleInput(val: string): number | null {
  return parseFieldLengthInput(val)
}

/**
 * 格式化显示字段小数位
 */
export function displayFieldScale(val: any): string {
  return displayFieldLength(val)
}

/**
 * 文本转注释数组
 */
export function commentTextToArray(text: string): (string | null)[] {
  return text.split('\n').map(line => line === '' ? null : line)
}

/**
 * 注释数组转文本
 */
export function commentArrayToText(arr: string | (string | null)[]): string {
  if (Array.isArray(arr)) {
    return arr.map(item => item === null ? '' : item).join('\n')
  }
  return arr
}
