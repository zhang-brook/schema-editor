import type { CommonConfig, InitialData, Schema } from '../../types/schema'
import type { AffectedFile } from '../history/command'
import type { FileChange, SaveMode } from './save-coordinator'
import { COMMON_FILE, CURRENT_DIR, DATABASE_FILE, SCHEMAS_DIR, SCHEMA_FILE, TABLE_FILE, INITIAL_DATA_FILE, OUTPUT_DIR, sanitizeName } from './layout'
import { buildCommonWriteData, buildSchemaWriteData, buildTableExportData } from './serialization'
import { buildInitialDataExport } from '../../utils/initial-data-io'
import { DIALECT_GENERATORS } from '../../utils/sql-generator'
import { ALL_SQL_DIALECTS, fmtPrePostSql, getGlobalPreSql, getGlobalPostSql } from '../../utils/sql-generator/shared'
import { AI_GUIDE_FILE, generateAiGuideMarkdown, loadGenerateAiGuide } from '../../utils/ai-guide'

export interface ProjectDocuments {
  common: CommonConfig | null
  schemas: Schema[]
  initialData: Map<string, InitialData>
}

export const databasePath = `${CURRENT_DIR}/${DATABASE_FILE}`
export const schemaPrefix = `${CURRENT_DIR}/${SCHEMAS_DIR}/`
export const jsonContent = (value: unknown) => JSON.stringify(value, null, 4)
export const schemaDirectory = (name: string) => `${schemaPrefix}${sanitizeName(name)}`
export const tableDirectory = (schema: string, table: string) => `${schemaDirectory(schema)}/${sanitizeName(table)}`

export function projectSourceFiles(project: ProjectDocuments): Map<string, string> {
  const files = new Map<string, string>()
  if (project.common) files.set(COMMON_FILE, jsonContent(buildCommonWriteData(project.common)))
  files.set(databasePath, jsonContent({ schema_order: project.schemas.map(schema => schema.schema) }))
  for (const schema of project.schemas) {
    files.set(`${schemaDirectory(schema.schema)}/${SCHEMA_FILE}`, jsonContent(buildSchemaWriteData(schema)))
    for (const table of schema.tables) {
      const dir = tableDirectory(schema.schema, table.name)
      files.set(`${dir}/${TABLE_FILE}`, jsonContent(buildTableExportData(table)))
      const initial = project.initialData.get(`${schema.schema}/${table.name}`)
      if (initial) files.set(`${dir}/${INITIAL_DATA_FILE}`, jsonContent(buildInitialDataExport(initial)))
    }
  }
  return files
}

export function affectedSourceChanges(project: ProjectDocuments, affected: readonly AffectedFile[], previous: ReadonlyMap<string, string>): FileChange[] {
  const changes = new Map<string, string | null>()
  const removePrefix = (prefix: string) => {
    for (const path of previous.keys()) if (path.startsWith(`${prefix}/`)) changes.set(path, null)
  }
  const updateInitial = (schema: string, table: string) => {
    const data = project.initialData.get(`${schema}/${table}`)
    changes.set(`${tableDirectory(schema, table)}/${INITIAL_DATA_FILE}`, data ? jsonContent(buildInitialDataExport(data)) : null)
  }
  const updateTable = (schemaName: string, tableName: string) => {
    const schema = project.schemas.find(item => item.schema === schemaName)
    const table = schema?.tables.find(item => item.name === tableName)
    const directory = tableDirectory(schemaName, tableName)
    if (!table) { removePrefix(directory); return }
    const path = `${directory}/${TABLE_FILE}`
    changes.set(path, jsonContent(buildTableExportData(table)))
    if (!previous.has(path)) updateInitial(schemaName, tableName)
  }
  const updateSchema = (name: string) => {
    const schema = project.schemas.find(item => item.schema === name)
    const directory = schemaDirectory(name)
    if (!schema) { removePrefix(directory); return }
    changes.set(`${directory}/${SCHEMA_FILE}`, jsonContent(buildSchemaWriteData(schema)))
    const validDirectories = new Set(schema.tables.map(table => `${tableDirectory(name, table.name)}/`))
    for (const path of previous.keys()) {
      if (!path.startsWith(`${directory}/`) || path === `${directory}/${SCHEMA_FILE}`) continue
      const tableDir = `${path.slice(0, path.lastIndexOf('/'))}/`
      if (!validDirectories.has(tableDir)) changes.set(path, null)
    }
    for (const table of schema.tables) {
      if (!previous.has(`${tableDirectory(name, table.name)}/${TABLE_FILE}`)) updateTable(name, table.name)
    }
  }
  for (const file of affected) {
    switch (file.kind) {
      case 'common':
        if (project.common) changes.set(COMMON_FILE, jsonContent(buildCommonWriteData(project.common)))
        break
      case 'database':
        changes.set(databasePath, jsonContent({ schema_order: project.schemas.map(schema => schema.schema) }))
        break
      case 'schema':
        if (file.oldSchema) updateSchema(file.oldSchema)
        if (file.schema) updateSchema(file.schema)
        break
      case 'table':
        if (file.schema && file.oldTable) updateTable(file.oldSchema ?? file.schema, file.oldTable)
        if (file.schema && file.table) updateTable(file.schema, file.table)
        break
      case 'initial-data':
        if (file.schema && file.table) updateInitial(file.schema, file.table)
        break
    }
  }
  return [...changes].map(([path, content]) => ({ path, content }))
}

/** Full manual save: write every in-memory source document and remove project files that no longer exist. */
export function fullSourceChanges(project: ProjectDocuments, previous: ReadonlyMap<string, string>): FileChange[] {
  const files = projectSourceFiles(project)
  const changes: FileChange[] = [...files].map(([path, content]) => ({ path, content }))
  for (const path of previous.keys()) {
    if (files.has(path) || path === AI_GUIDE_FILE || path.startsWith(`${OUTPUT_DIR}/`)) continue
    if (path === COMMON_FILE || path.startsWith(`${CURRENT_DIR}/`)) changes.push({ path, content: null })
  }
  return changes
}

export function projectOutputPaths(project: ProjectDocuments): string[] {
  return ALL_SQL_DIALECTS.flatMap(dialect => [
    ...project.schemas.map(schema => `${OUTPUT_DIR}/${dialect}/${sanitizeName(schema.schema)}.sql`),
    ...['__all_schemas__', '__initial_data__', '__all__'].map(name => `${OUTPUT_DIR}/${dialect}/${name}.sql`),
  ]).concat(AI_GUIDE_FILE)
}

export function generatedFileChanges(project: ProjectDocuments, changedPaths: readonly string[], previous: ReadonlyMap<string, string>, mode: SaveMode): FileChange[] {
  const all = mode === 'manual' || changedPaths.includes(COMMON_FILE)
  const structureChanged = all || changedPaths.includes(databasePath) || changedPaths.some(path => path.startsWith(schemaPrefix))
  const retryOutput = changedPaths.some(path => path.startsWith(`${OUTPUT_DIR}/`))
  const changes = new Map<string, string | null>()
  if (structureChanged || retryOutput) {
    const configured = project.common?.enabled_dialects
    const enabled = configured?.length ? ALL_SQL_DIALECTS.filter(d => configured.includes(d)) : ALL_SQL_DIALECTS
    const touchedSchemas = new Set(changedPaths.filter(path => path.startsWith(schemaPrefix)).map(path => path.slice(schemaPrefix.length).split('/')[0]))
    const ddlSchemas = new Set(changedPaths.filter(path => path.startsWith(schemaPrefix) && !path.endsWith(`/${INITIAL_DATA_FILE}`)).map(path => path.slice(schemaPrefix.length).split('/')[0]))
    const validPaths = new Set<string>()
    for (const dialect of enabled) {
      const generators = DIALECT_GENERATORS[dialect]
      const schemaSql: string[] = []
      for (const schema of project.schemas) {
        const name = sanitizeName(schema.schema)
        const path = `${OUTPUT_DIR}/${dialect}/${name}.sql`
        const sql = all || ddlSchemas.has(name) || !previous.has(path)
          ? generators.schema(schema, project.common)
          : previous.get(path)!
        changes.set(path, sql)
        validPaths.add(path)
        schemaSql.push(sql)
      }
      const preSql = getGlobalPreSql(project.common, dialect)
      const postSql = getGlobalPostSql(project.common, dialect)
      const allSchemaSql = [
        preSql ? fmtPrePostSql(preSql) + '\n' : '',
        schemaSql.join('\n\n'),
        postSql ? fmtPrePostSql(postSql) + '\n' : '',
      ].join('')
      const initialPath = `${OUTPUT_DIR}/${dialect}/__initial_data__.sql`
      const initialSql = all || touchedSchemas.size > 0 || changedPaths.includes(databasePath) || !previous.has(initialPath)
        ? generators.initialData(project.schemas, project.initialData, project.common)
        : previous.get(initialPath)!
      const outputs: [string, string | null][] = [
        [`${OUTPUT_DIR}/${dialect}/__all_schemas__.sql`, schemaSql.length > 0 ? allSchemaSql : null],
        [initialPath, initialSql.trim() ? initialSql : null],
        [`${OUTPUT_DIR}/${dialect}/__all__.sql`, schemaSql.length > 0 || initialSql.trim()
          ? [allSchemaSql, initialSql.trim() ? '\n\n' + initialSql.trim() : ''].join('') : null],
      ]
      for (const [path, content] of outputs) {
        changes.set(path, content)
        validPaths.add(path)
      }
    }
    for (const path of previous.keys()) {
      if (path.startsWith(`${OUTPUT_DIR}/`) && !validPaths.has(path)) changes.set(path, null)
    }
  }
  if (all || changedPaths.includes(AI_GUIDE_FILE)) {
    changes.set(AI_GUIDE_FILE, loadGenerateAiGuide(project.common) ? generateAiGuideMarkdown() : null)
  }
  return [...changes].map(([path, content]) => ({ path, content }))
}
