import { toRaw } from 'vue'
import type { InitialData } from '@/types/schema'

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
 * 弹出文件夹选择器，读取项目结构：
 *   - common.json（根目录）
 *   - schema/ 子目录下的所有 .json 文件
 * 返回 { rootHandle, schemaHandle, commonData, schemaFiles[] }
 */
export async function openProjectFolder(): Promise<{
  rootHandle: FileSystemDirectoryHandle
  schemaHandle: FileSystemDirectoryHandle
  commonData: unknown | null
  schemaFiles: { name: string; data: unknown }[]
}> {
  const rootHandle: FileSystemDirectoryHandle = await window.showDirectoryPicker()
  let commonData: unknown | null = null
  let schemaHandle: FileSystemDirectoryHandle | null = null
  const schemaFiles: { name: string; data: unknown }[] = []

  // 逐条扫描根目录
  for await (const entry of rootHandle.values()) {
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

    if (name === 'schemas' && handle.kind === 'directory') {
      schemaHandle = handle
      console.log('[openProjectFolder] schemas/ directory found')
    }
  }

  // 读取 schemas/ 子目录
  try {
    const sdHandle = await rootHandle.getDirectoryHandle('schemas')
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
    schemaHandle = await rootHandle.getDirectoryHandle('schemas', { create: true })
  }

  return { rootHandle, schemaHandle, commonData, schemaFiles }
}

/**
 * 将数据写入 common.json
 */
export async function writeCommonToHandle(rootHandle: FileSystemDirectoryHandle, data: unknown): Promise<void> {
  const handle = await rootHandle.getFileHandle('common.json', { create: true })
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
  const outputHandle = await rootHandle.getDirectoryHandle('output', { create: true })
  const dialectHandle = await outputHandle.getDirectoryHandle(dialect, { create: true })
  const fileHandle = await dialectHandle.getFileHandle(filename, { create: true })
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
    const outputHandle = await rootHandle.getDirectoryHandle('output', { create: false })
    const dialectHandle = await outputHandle.getDirectoryHandle(dialect, { create: false })
    await dialectHandle.removeEntry(filename)
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
    initialDataHandle = await rootHandle.getDirectoryHandle('initial-data')
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
          console.log(`[readInitialData] loaded "${schemaName}/${tableName}" (${normalized.rows.length} rows)`)
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

/** 归一化原始 JSON 数据为 InitialData 格式 — 兼容旧格式纯数组 */
function normalizeInitialData(raw: unknown): InitialData | null {
  if (Array.isArray(raw)) {
    return { rows: raw }
  }
  if (raw && typeof raw === 'object' && Array.isArray((raw as any).rows)) {
    const obj = raw as Record<string, any>
    const result: InitialData = { rows: obj.rows }
    if (Array.isArray(obj.row_comments)) {
      result.row_comments = obj.row_comments
    }
    if (Array.isArray(obj.field_comments)) {
      result.field_comments = obj.field_comments
    }
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
 * 序列化优化：若注释数组全为 null 则只写 rows 数组（最小文件体积）
 */
export async function writeInitialDataToHandle(
  rootHandle: FileSystemDirectoryHandle,
  schemaName: string,
  tableName: string,
  data: InitialData
): Promise<void> {
  const initialDataHandle = await rootHandle.getDirectoryHandle('initial-data', { create: true })
  const schemaHandle = await initialDataHandle.getDirectoryHandle(schemaName, { create: true })
  const fileHandle = await schemaHandle.getFileHandle(`${tableName}.json`, { create: true })
  const writable = await fileHandle.createWritable()
  // 优化：若注释全为 null，只写 rows 数组
  if (isAllNull(data.row_comments) && isAllNull(data.field_comments)) {
    await writable.write(JSON.stringify(toRaw(data.rows), null, jsonFileIndent))
  } else {
    await writable.write(JSON.stringify(toRaw(data), null, jsonFileIndent))
  }
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
    const initialDataHandle = await rootHandle.getDirectoryHandle('initial-data')
    const schemaHandle = await initialDataHandle.getDirectoryHandle(schemaName)
    await schemaHandle.removeEntry(`${tableName}.json`)
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
