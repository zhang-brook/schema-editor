import type { InitialData, Schema } from '@/types/schema'
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
} from '@/core/workspace/paths'
import { readJsonFile, writeJsonFile } from '@/core/workspace/handles'
import { sanitizeName } from '@/core/workspace/layout'
import { normalizeInitialData, buildInitialDataExport } from '@/utils/file-helpers'

/**
 * 结构迁移的公共磁盘 IO 层。
 *
 * 设计意图：无论是「目录结构调整」还是「字段/属性迁移（新增、改名、结构调整）」，
 * 每一步迁移的本质都是「读当前盘 → 改内存 → 写回当前盘」。因此本模块提供与具体版本
 * 无关的读写能力，让迁移脚本只专注于"字段怎么变"，而不必关心文件怎么摆。
 *
 * 关键点：读写逻辑按「结构版本」分发——
 * - 旧布局（0.0~0.4）：schemas/*.json + initial-data/* + common.json
 * - 新布局（1.0+）：current/schemas/<schema>/<table>/table.json + initial-data.json + database.json
 *
 * 未来新增字段级迁移（如 v1.0→v1.1）时，只需调用本模块的 readProject/writeProject，
 * 在内存态上做字段变更后写回即可，无需新增任何 IO 代码。
 */

/** 统一的内存态项目数据模型（与磁盘布局无关） */
export interface ProjectData {
  /** 全局配置（含 struct_version） */
  common: any
  /** 全部 schema（含 tables、fields、indexes 等完整结构） */
  schemas: Schema[]
  /** 初始数据，key 为 "<schemaName>/<tableName>" */
  initialData: Map<string, InitialData>
}

/** 该版本是否使用 new（current/）布局 */
function isNewLayout(version: string): boolean {
  // 1.0 起为 new 布局；0.x 为 old 布局
  const parts = version.split('.').map((n) => parseInt(n, 10) || 0)
  const major = parts[0] || 0
  return major >= 1
}

// ─────────────────────────────── 旧布局读写 ───────────────────────────────

async function readOldLayout(rootHandle: FileSystemDirectoryHandle): Promise<ProjectData> {
  const common = await readOldCommon(rootHandle)
  const schemas = await readOldSchemas(rootHandle)
  const initialData = await readOldInitialData(rootHandle)
  return { common, schemas, initialData: mapFromPairs(initialData) }
}

async function readOldCommon(rootHandle: FileSystemDirectoryHandle): Promise<any> {
  try {
    const handle = await getCommonFileHandle(rootHandle, false)
    return await readJsonFile(handle)
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
    // 无 schemas/ 目录
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
  common: any,
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

// ─────────────────────────────── 新布局读写 ───────────────────────────────

async function readNewLayout(rootHandle: FileSystemDirectoryHandle): Promise<ProjectData> {
  const currentDir = await getCurrentDir(rootHandle, false)
  const common = await readNewCommon(currentDir)
  const schemas = await readNewSchemas(currentDir)
  const initialData = await readNewInitialData(currentDir)
  return { common, schemas, initialData }
}

async function readNewCommon(currentDir: FileSystemDirectoryHandle): Promise<any> {
  try {
    const handle = await getCurrentDatabaseFileHandle(currentDir, false)
    return await readJsonFile(handle)
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
        const tableJson = await readJsonFile<any>(handle)
        // 新布局 table.json 结构：{ schema, table } 或已展开；归一化为统一内存态
        const schemaName = schemaNameFromTable(tableJson) ?? schemaEntry.name
        let schema = result.find((s) => s.schema === schemaName)
        if (!schema) {
          schema = { schema: schemaName, tables: [] } as Schema
          result.push(schema)
        }
        schema.tables.push(tableJson.table ?? tableJson)
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
        // 无 initial-data.json
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
      const tableName = (table as any).name ?? (table as any).table?.name
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

// ─────────────────────────────── 公共 API ───────────────────────────────

function schemaNameFromTable(tableJson: any): string | undefined {
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
 * 读取项目全量数据到统一内存态（按版本自动选择 old/new 布局）。
 * 迁移脚本调用此函数拿到内存态后，只需专注于字段级变更。
 *
 * @param rootHandle 项目根目录句柄
 * @param version    当前结构版本（决定读 old 还是 new 布局）
 */
export async function readProject(
  rootHandle: FileSystemDirectoryHandle,
  version: string,
): Promise<ProjectData> {
  return isNewLayout(version) ? readNewLayout(rootHandle) : readOldLayout(rootHandle)
}

/**
 * 将统一内存态写回磁盘（按版本自动选择 old/new 布局）。
 * 与 readProject 配对使用：readProject(version) → 改字段 → writeProject(version)。
 *
 * @param rootHandle 项目根目录句柄
 * @param version    目标结构版本（决定写 old 还是 new 布局）
 * @param data       内存态项目数据
 */
export async function writeProject(
  rootHandle: FileSystemDirectoryHandle,
  version: string,
  data: ProjectData,
): Promise<void> {
  return isNewLayout(version) ? writeNewLayout(rootHandle, data) : writeOldLayout(rootHandle, data)
}

/**
 * 仅更新 common.struct_version（不触碰其余数据）。
 * 绝大多数数据级步骤仅需推进版本号，可单独调用。
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
