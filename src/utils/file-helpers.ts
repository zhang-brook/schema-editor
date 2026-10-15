import { toRaw } from 'vue'
import type { InitialData, Schema, Table } from '@/types/schema'
import {
  getCommonFileHandle,
  getSchemasDir,
  getInitialDataDir,
  removeOldInitialDataFile,
  // ===== 新结构（current/）路径解析 =====
  getCurrentDir,
  getCurrentDatabaseFileHandle,
  getCurrentSchemasDir,
  getSchemaDirUnderCurrent,
  getTableDirUnderSchema,
  getTableFileHandle,
} from '@/core/workspace/paths'
import { CURRENT_STRUCT_VERSION, SCHEMA_FILE, sanitizeName } from '@/core/workspace/layout'
import {
  getOrCreateDir,
  getFileHandleSafe,
  readJsonFile,
  writeJsonFile,
  removeEntry,
} from '@/core/workspace/handles'
import { compareStructVersion } from './structure-migrations/version-utils'
import { writeInitialDataToNewStructure } from './initial-data-io'
import { buildSchemaWriteData, type SchemaWriteData } from '@/core/workspace/serialization'

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

// ===== 新结构（current/）读写 =====
//
// 目录布局：
//   common.json                      根配置（default_config / unified_types / common_used_fields）
//   current/
//     database.json                  schema_order（按版本可能不同的项）
//     schemas/
//       <schema>/                   文件名友好的模式名（sanitizeName）
//         schema.json               { schema: 原始名, table_order: string[] }
//         <table>/                  文件名友好的表名
//           table.json              单表定义
//           initial-data.json       行内化初始数据（对象格式）
//
// 旧的 schemas/、initial-data/ 平行目录仅在「从旧结构迁移」(migrateOldToNewStructure) 时读取。

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

/**
 * 判断根目录是否为空文件夹（无任何条目）。
 * 空文件夹视为「全新项目」，应直接初始化为新结构，而非提示升级旧结构。
 */
export async function isEmptyFolder(rootHandle: FileSystemDirectoryHandle): Promise<boolean> {
  for await (const _entry of rootHandle.values()) {
    return false
  }
  return true
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
  data: SchemaWriteData,
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

// ===== 旧结构 → 新结构迁移（打开旧项目时一次性触发） =====

/**
 * 将已准备好的内存态（旧结构经升级器处理后的结果）写入新结构磁盘布局。
 * 旧文件保留不删除（便于回退）。写盘后该项目即成为新结构。
 *
 * @param commonConfig  保留在根 common.json 的部分（与版本无关的配置）
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
  // 1. 根 common.json（仅保留与版本无关的配置）
  await writeCommonToHandle(rootHandle, data.commonConfig)

  // 2. current/database.json
  await writeDatabaseToHandle(rootHandle, data.databaseData)

  // 3. 各 schema 目录与 table 目录
  for (const schema of data.schemas) {
    await writeSchemaJsonToHandle(rootHandle, schema.schema, buildSchemaWriteData(schema))
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
