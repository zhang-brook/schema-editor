import type { CommonConfig, Schema, SqlStatements, Table } from '@/types/schema'
import { normalizeInitialData } from '@/utils/initial-data-io'
import { DEFAULT_UNIFIED_TYPES } from '@/utils/unified-types'
import { COMMON_FILE, CURRENT_STRUCT_VERSION, ENVIRONMENTS_DIR, INITIAL_DATA_FILE, MIGRATIONS_DIR, OUTPUT_DIR, VERSIONS_DIR } from './layout'
import type { BrowserWorkspaceWriter } from './browser-workspace'
import { SaveCoordinator, type AutoSaveOptions, type FileChange, type SaveState, type StagedChange, type WorkspaceWriter } from './save-coordinator'
import { affectedSourceChanges, databasePath, fullSourceChanges, generatedFileChanges, projectOutputPaths, projectSourceFiles, schemaDirectory, schemaPrefix, tableDirectory, type ProjectDocuments } from './project-documents'
import { AI_GUIDE_FILE } from '@/utils/ai-guide'
import type { AffectedFile } from '@/core/history/command'

export function createDefaultCommonConfig(): CommonConfig {
  return {
    struct_version: CURRENT_STRUCT_VERSION,
    default_config: {
      mysql: { database: {}, table: { mysql_engine: 'InnoDB', mysql_charset: 'utf8mb4', mysql_collation: 'utf8mb4_0900_ai_ci' } },
      postgresql: { quote_identifiers: true },
      sqlite: { quote_identifiers: true },
    },
    common_used_fields: {}, type_case: 'keep', generate_ai_guide: false,
  }
}

/** 解析项目文档：只保证顶层是对象，字段形态由调用方逐项校验 */
function parseObject<T extends object>(content: string, path: string): T {
  const value: unknown = JSON.parse(content)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid project document: ${path}`)
  return value as T
}

/** 磁盘上的 current/database.json */
interface DatabaseDocument {
  schema_order?: string[]
}

/** 磁盘上的 schema.json：表定义按目录分散存放，这里只承载元信息与排序 */
interface SchemaDocument {
  schema?: string
  table_order?: string[]
  pre_sql?: SqlStatements
  post_sql?: SqlStatements
}

function sortByOrder<T>(items: T[], order: string[], name: (item: T) => string) {
  const positions = new Map(order.map((value, index) => [value, index]))
  items.sort((a, b) => (positions.get(name(a)) ?? Infinity) - (positions.get(name(b)) ?? Infinity))
}

export interface SessionWriter extends WorkspaceWriter {
  load(paths: readonly string[]): Promise<Map<string, string>>
  listFiles(directory: string): Promise<string[]>
  hasExternalChanges(paths: readonly string[]): Promise<boolean>
  /** 远端写入器（Git）：把保存口径的文件集合换算为相对快照的真实差异 */
  previewCommit?(changes: readonly FileChange[]): StagedChange[]
  /** 远端写入器（Git）：下一次保存使用的提交信息 */
  setCommitMessage?(message: string): void
}

export async function loadWorkspaceDocuments(writer: Pick<BrowserWorkspaceWriter, 'load' | 'listFiles'>): Promise<{ project: ProjectDocuments; files: Map<string, string> }> {
  const root = await writer.load([COMMON_FILE, databasePath])
  const commonText = root.get(COMMON_FILE)
  if (commonText === undefined) throw new Error(`Missing project document: ${COMMON_FILE}`)
  const common = parseObject<CommonConfig>(commonText, COMMON_FILE)
  if (!common.default_config?.mysql || !common.common_used_fields) throw new Error(`Invalid project document: ${COMMON_FILE}`)
  common.default_config.postgresql ??= { quote_identifiers: true }
  common.default_config.sqlite ??= { quote_identifiers: true }
  for (const field of Object.values(common.common_used_fields)) {
    if (field.field_type === '') delete field.field_type
  }
  if (!common.unified_types?.length) common.unified_types = JSON.parse(JSON.stringify(DEFAULT_UNIFIED_TYPES))
  const project: ProjectDocuments = { common, schemas: [], initialData: new Map() }
  const paths = await writer.listFiles(schemaPrefix.slice(0, -1))
  const metadataPaths = paths.filter(path => /^current\/schemas\/[^/]+\/schema\.json$/.test(path))
  const metadata = await writer.load(metadataPaths)
  const initialPaths: { path: string, key: string }[] = []
  for (const [path, content] of metadata) {
    const meta = parseObject<SchemaDocument>(content, path)
    if (typeof meta.schema !== 'string' || !meta.schema || path !== `${schemaDirectory(meta.schema)}/schema.json`) throw new Error(`Invalid schema document: ${path}`)
    const schema: Schema = { schema: meta.schema, tables: [], pre_sql: meta.pre_sql, post_sql: meta.post_sql }
    const directory = schemaDirectory(schema.schema)
    const tablePaths = paths.filter(candidate => candidate.startsWith(`${directory}/`) && candidate.slice(directory.length + 1).split('/').length === 2 && candidate.endsWith('/table.json'))
    const tables = await writer.load(tablePaths)
    for (const [tablePath, tableText] of tables) {
      const table = parseObject<Table>(tableText, tablePath)
      if (typeof table.name !== 'string' || !table.name || tablePath !== `${tableDirectory(schema.schema, table.name)}/table.json`) throw new Error(`Invalid table document: ${tablePath}`)
      table.fields ??= []
      table.indexes ??= []
      if (!Array.isArray(table.fields) || !Array.isArray(table.indexes)) throw new Error(`Invalid table document: ${tablePath}`)
      schema.tables.push(table)
      initialPaths.push({
        path: `${tableDirectory(schema.schema, table.name)}/${INITIAL_DATA_FILE}`,
        key: `${schema.schema}/${table.name}`,
      })
    }
    sortByOrder(schema.tables, meta.table_order ?? [], table => table.name)
    project.schemas.push(schema)
  }
  const initialData = await writer.load(initialPaths.map(entry => entry.path))
  for (const entry of initialPaths) {
    const text = initialData.get(entry.path)
    if (text === undefined) continue
    const initial = normalizeInitialData(JSON.parse(text))
    if (!initial) throw new Error(`Invalid initial data document: ${entry.path}`)
    project.initialData.set(entry.key, initial)
  }
  const databaseText = root.get(databasePath)
  const database: DatabaseDocument = databaseText === undefined ? {} : parseObject<DatabaseDocument>(databaseText, databasePath)
  sortByOrder(project.schemas, database.schema_order ?? [], schema => schema.schema)
  common.schema_order = project.schemas.map(schema => schema.schema)
  const auxiliaryPaths: string[] = []
  for (const directory of [VERSIONS_DIR, MIGRATIONS_DIR, ENVIRONMENTS_DIR]) {
    auxiliaryPaths.push(...(await writer.listFiles(directory)).filter(path => path.slice(directory.length + 1).split('/').length === 1 && path.endsWith('.json')))
  }
  const auxiliary = await writer.load([...auxiliaryPaths, ...projectOutputPaths(project)])
  return { project, files: new Map([...projectSourceFiles(project), ...auxiliary]) }
}

export type WorkspaceSession = ReturnType<typeof createWorkspaceSession>

export function createWorkspaceSession(options: {
  writer: SessionWriter
  files: ReadonlyMap<string, string>
  project: () => ProjectDocuments
  autoSave: Partial<AutoSaveOptions>
  onStateChange: (state: SaveState) => void
}) {
  const coordinator: SaveCoordinator = new SaveCoordinator({
    writer: options.writer,
    initialFiles: options.files,
    autoSave: options.autoSave,
    onStateChange: options.onStateChange,
    // 项目文档与派生文件（output/ 下的 SQL、AI 指南）分开控制自动写入
    classify: path => path.startsWith(`${OUTPUT_DIR}/`) || path === AI_GUIDE_FILE ? 'outputs' : 'docs',
    prepare: (changed, mode): FileChange[] => generatedFileChanges(options.project(), changed, coordinator.files, mode),
  })
  return {
    coordinator,
    changed(files: AffectedFile[]) {
      coordinator.update(affectedSourceChanges(options.project(), files, coordinator.files))
    },
    /** 手动保存：先补齐内存里的全部源文档，再整批落盘。 */
    async saveAll() {
      coordinator.update(fullSourceChanges(options.project(), coordinator.files))
      await coordinator.saveAll()
    },
    /** 提交预览：Git 模式下待提交的文件差异（其他写入器返回空） */
    previewCommitChanges(): StagedChange[] {
      if (!options.writer.previewCommit) return []
      return options.writer.previewCommit(coordinator.previewAll())
    },
    setCommitMessage(message: string) {
      options.writer.setCommitMessage?.(message)
    },
    async hasExternalChanges(paths: readonly string[]) {
      await coordinator.waitForIdle()
      return options.writer.hasExternalChanges(paths)
    },
  }
}
