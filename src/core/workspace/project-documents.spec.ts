import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Table } from '@/types/schema'
import { affectedCommon, affectedDatabase, affectedInitialData, affectedSchema, affectedSql, affectedTable } from '@/core/history/command'
import { DIALECT_GENERATORS } from '@/utils/sql-generator'
import { ALL_SQL_DIALECTS, fmtPrePostSql, getGlobalPostSql, getGlobalPreSql } from '@/utils/sql-generator/shared'
import { AI_GUIDE_FILE } from '@/utils/ai-guide'
import { SaveCoordinator, type FileChange } from './save-coordinator'
import { affectedSourceChanges, databasePath, generatedFileChanges, jsonContent, projectOutputPaths, projectSourceFiles, schemaDirectory, tableDirectory, type ProjectDocuments } from './project-documents'

const table = (name: string): Table => ({ name, comment: '', fields: [{ field_name: 'id', field_type: 'int' }], indexes: [] })
const tablePath = (schema: string, name: string) => `${tableDirectory(schema, name)}/table.json`
const initialPath = (schema: string, name: string) => `${tableDirectory(schema, name)}/initial-data.json`
const schemaPath = (schema: string) => `${schemaDirectory(schema)}/schema.json`
const asMap = (changes: FileChange[]) => new Map(changes.map(change => [change.path, change.content]))
function apply(files: Map<string, string>, changes: FileChange[]) {
  for (const { path, content } of changes) {
    if (content === null) files.delete(path)
    else files.set(path, content)
  }
}
function fixture(): ProjectDocuments {
  return {
    common: {
      default_config: {
        mysql: { database: {}, table: { mysql_engine: 'InnoDB', mysql_charset: 'utf8mb4', mysql_collation: 'utf8mb4_bin' }, pre_sql: 'SELECT 1', post_sql: 'SELECT 2' },
        postgresql: { quote_identifiers: true },
      },
      common_used_fields: {}, generate_ai_guide: false, schema_order: ['stale'],
    },
    schemas: [{ schema: 'app', tables: [table('users'), table('roles')] }, { schema: 'audit', tables: [table('events')] }],
    initialData: new Map([['app/users', { rows: [{ data: { id: 1 } }] }]]),
  }
}
function withOutputs(project: ProjectDocuments) {
  const files = projectSourceFiles(project)
  apply(files, generatedFileChanges(project, [], files, 'manual'))
  return files
}

afterEach(() => vi.restoreAllMocks())

describe('project source documents', () => {
  it('serializes canonical documents without schema order leaking into common', () => {
    const project = fixture()
    project.initialData.set('orphan/table', { rows: [] })
    const files = projectSourceFiles(project)
    expect(files.size).toBe(8)
    expect(JSON.parse(files.get('common.json')!)).not.toHaveProperty('schema_order')
    expect(JSON.parse(files.get(databasePath)!)).toEqual({ schema_order: ['app', 'audit'] })
    expect(JSON.parse(files.get(schemaPath('app'))!)).toEqual({ schema: 'app', table_order: ['users', 'roles'] })
    expect(files.has(initialPath('orphan', 'table'))).toBe(false)
  })

  it('serializes only the edited table, never traversing another table', () => {
    const project = fixture()
    const previous = projectSourceFiles(project)
    project.schemas[0]!.tables[0]!.comment = 'changed'
    Object.defineProperty(project.schemas[1]!.tables[0], 'fields', { get: () => { throw new Error('unrelated serialization') } })
    const changes = affectedSourceChanges(project, [affectedTable('app', 'users'), affectedSql()], previous)
    expect(changes).toHaveLength(1)
    expect(changes[0]!.path).toBe(tablePath('app', 'users'))
    expect(JSON.parse(changes[0]!.content!).comment).toBe('changed')
  })

  it('deduplicates repeated affected paths', () => {
    const project = fixture()
    expect(affectedSourceChanges(project, [affectedCommon(), affectedCommon(), affectedTable('app', 'users'), affectedTable('app', 'users')], projectSourceFiles(project))).toHaveLength(2)
  })

  it('reorders schemas using only database metadata', () => {
    const project = fixture()
    const previous = projectSourceFiles(project)
    project.schemas.reverse()
    expect(affectedSourceChanges(project, [affectedDatabase()], previous)).toEqual([{ path: databasePath, content: jsonContent({ schema_order: ['audit', 'app'] }) }])
  })

  it('reorders tables without serializing existing tables', () => {
    const project = fixture()
    const previous = projectSourceFiles(project)
    project.schemas[0]!.tables.reverse()
    const changes = affectedSourceChanges(project, [affectedSchema('app')], previous)
    expect(changes).toHaveLength(1)
    expect(JSON.parse(changes[0]!.content!).table_order).toEqual(['roles', 'users'])
  })

  it('adds and removes only initial data for a row edit or deletion', () => {
    const project = fixture()
    const previous = projectSourceFiles(project)
    project.initialData.set('app/users', { rows: [{ data: { id: 2 } }] })
    const changes = affectedSourceChanges(project, [affectedInitialData('app', 'users')], previous)
    expect(changes).toEqual([{ path: initialPath('app', 'users'), content: jsonContent({ rows: [{ data: { id: 2 } }] }) }])
    project.initialData.delete('app/users')
    expect(affectedSourceChanges(project, [affectedInitialData('app', 'users')], previous)).toEqual([{ path: initialPath('app', 'users'), content: null }])
  })

  it('creates an entire new schema subtree, including initial data', () => {
    const project = fixture()
    const previous = projectSourceFiles(project)
    project.schemas.push({ schema: 'new:schema', tables: [table('a:b'), table('c')] })
    project.initialData.set('new:schema/a:b', { rows: [] })
    const changes = asMap(affectedSourceChanges(project, [affectedSchema('new:schema')], previous))
    expect([...changes.keys()]).toEqual([schemaPath('new:schema'), tablePath('new:schema', 'a:b'), initialPath('new:schema', 'a:b'), tablePath('new:schema', 'c'), initialPath('new:schema', 'c')])
    expect(changes.get(initialPath('new:schema', 'a:b'))).toBe(jsonContent({ rows: [] }))
    expect(changes.get(initialPath('new:schema', 'c'))).toBeNull()
  })

  it('renames a table and restores both paths and data on undo', () => {
    const project = fixture()
    const previous = projectSourceFiles(project)
    const original = new Map(previous)
    const affected = [affectedSchema('app'), affectedTable('app', 'users'), affectedTable('app', 'people')]
    project.schemas[0]!.tables[0]!.name = 'people'
    project.initialData.set('app/people', project.initialData.get('app/users')!)
    project.initialData.delete('app/users')
    apply(previous, affectedSourceChanges(project, affected, previous))
    expect(previous.has(tablePath('app', 'users'))).toBe(false)
    expect(previous.has(initialPath('app', 'users'))).toBe(false)
    expect(previous.get(initialPath('app', 'people'))).toBe(original.get(initialPath('app', 'users')))
    project.schemas[0]!.tables[0]!.name = 'users'
    project.initialData.set('app/users', project.initialData.get('app/people')!)
    project.initialData.delete('app/people')
    apply(previous, affectedSourceChanges(project, affected, previous))
    expect(previous).toEqual(original)
  })

  it('handles old path descriptors for table and schema renames', () => {
    const project = fixture()
    const previous = projectSourceFiles(project)
    project.schemas[0]!.tables[1]!.name = 'permissions'
    let changes = asMap(affectedSourceChanges(project, [{ kind: 'table', schema: 'app', table: 'permissions', oldTable: 'roles' }], previous))
    expect(changes.get(tablePath('app', 'roles'))).toBeNull()
    expect(changes.get(tablePath('app', 'permissions'))).toBeTypeOf('string')
    project.schemas[1]!.schema = 'logs'
    changes = asMap(affectedSourceChanges(project, [{ kind: 'schema', schema: 'logs', oldSchema: 'audit' }], previous))
    expect(changes.get(schemaPath('audit'))).toBeNull()
    expect(changes.get(tablePath('audit', 'events'))).toBeNull()
    expect(changes.get(tablePath('logs', 'events'))).toBeTypeOf('string')
  })

  it('deletes and restores a schema with all of its child documents', () => {
    const project = fixture()
    const previous = projectSourceFiles(project)
    const original = new Map(previous)
    const removed = project.schemas.shift()!
    apply(previous, affectedSourceChanges(project, [affectedSchema('app'), affectedDatabase()], previous))
    expect([...previous.keys()].some(path => path.startsWith(`${schemaDirectory('app')}/`))).toBe(false)
    expect(previous.get(tablePath('audit', 'events'))).toBe(original.get(tablePath('audit', 'events')))
    project.schemas.unshift(removed)
    apply(previous, affectedSourceChanges(project, [affectedSchema('app'), affectedDatabase()], previous))
    expect(previous).toEqual(original)
  })

  it('moves a table between schemas without losing initial data', () => {
    const project = fixture()
    const previous = projectSourceFiles(project)
    const moved = project.schemas[0]!.tables.shift()!
    project.schemas[1]!.tables.push(moved)
    project.initialData.set('audit/users', project.initialData.get('app/users')!)
    project.initialData.delete('app/users')
    apply(previous, affectedSourceChanges(project, [affectedSchema('app'), affectedSchema('audit')], previous))
    expect(previous.has(tablePath('app', 'users'))).toBe(false)
    expect(previous.has(initialPath('app', 'users'))).toBe(false)
    expect(previous.has(tablePath('audit', 'users'))).toBe(true)
    expect(previous.has(initialPath('audit', 'users'))).toBe(true)
  })

  it('does not remove version documents during structural deletion', () => {
    const project = fixture()
    const previous = projectSourceFiles(project)
    previous.set('versions/v1.json', '{}')
    project.schemas.length = 0
    apply(previous, affectedSourceChanges(project, [affectedSchema('app'), affectedSchema('audit')], previous))
    expect(previous.get('versions/v1.json')).toBe('{}')
  })
})

describe('derived document invalidation', () => {
  it.each(ALL_SQL_DIALECTS)('preserves existing combined output semantics for %s', dialect => {
    const project = fixture()
    const outputs = asMap(generatedFileChanges(project, [], projectSourceFiles(project), 'manual'))
    const generators = DIALECT_GENERATORS[dialect]
    const pre = getGlobalPreSql(project.common, dialect)
    const post = getGlobalPostSql(project.common, dialect)
    const allSchemaSql = [pre ? fmtPrePostSql(pre) + '\n' : '', project.schemas.map(schema => generators.schema(schema, project.common)).join('\n\n'), post ? fmtPrePostSql(post) + '\n' : ''].join('')
    const initial = generators.initialData(project.schemas, project.initialData, project.common)
    expect(outputs.get(`output/${dialect}/__all_schemas__.sql`)).toBe(allSchemaSql)
    expect(outputs.get(`output/${dialect}/__initial_data__.sql`)).toBe(initial)
    expect(outputs.get(`output/${dialect}/__all__.sql`)).toBe(allSchemaSql + (initial.trim() ? '\n\n' + initial.trim() : ''))
  })

  it('regenerates only the affected schema DDL', () => {
    const project = fixture()
    const previous = withOutputs(project)
    const spies = ALL_SQL_DIALECTS.map(dialect => vi.spyOn(DIALECT_GENERATORS[dialect], 'schema'))
    project.schemas[0]!.tables[0]!.comment = 'changed'
    generatedFileChanges(project, [tablePath('app', 'users')], previous, 'auto')
    for (const spy of spies) {
      expect(spy).toHaveBeenCalledExactlyOnceWith(project.schemas[0], project.common)
    }
  })

  it('initial data edits do not regenerate any schema DDL', () => {
    const project = fixture()
    const previous = withOutputs(project)
    const spies = ALL_SQL_DIALECTS.map(dialect => vi.spyOn(DIALECT_GENERATORS[dialect], 'schema'))
    project.initialData.get('app/users')!.rows![0]!.data.id = 2
    const outputs = asMap(generatedFileChanges(project, [initialPath('app', 'users')], previous, 'auto'))
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    expect(outputs.get('output/mysql/__initial_data__.sql')).not.toBe(previous.get('output/mysql/__initial_data__.sql'))
    expect(outputs.get('output/mysql/__all_schemas__.sql')).toBe(previous.get('output/mysql/__all_schemas__.sql'))
  })

  it('schema order changes reuse DDL but reorder merged output', () => {
    const project = fixture()
    const previous = withOutputs(project)
    const spy = vi.spyOn(DIALECT_GENERATORS.mysql, 'schema')
    project.schemas.reverse()
    const outputs = asMap(generatedFileChanges(project, [databasePath], previous, 'auto'))
    expect(spy).not.toHaveBeenCalled()
    expect(outputs.get('output/mysql/__all_schemas__.sql')!.indexOf(previous.get('output/mysql/audit.sql')!)).toBeLessThan(outputs.get('output/mysql/__all_schemas__.sql')!.indexOf(previous.get('output/mysql/app.sql')!))
  })

  it('common changes regenerate every schema and remove disabled dialect outputs', () => {
    const project = fixture()
    const previous = withOutputs(project)
    project.common!.enabled_dialects = ['mysql']
    const mysql = vi.spyOn(DIALECT_GENERATORS.mysql, 'schema')
    const postgresql = vi.spyOn(DIALECT_GENERATORS.postgresql, 'schema')
    const outputs = asMap(generatedFileChanges(project, ['common.json'], previous, 'auto'))
    expect(mysql).toHaveBeenCalledTimes(2)
    expect(postgresql).not.toHaveBeenCalled()
    for (const path of previous.keys()) if (path.startsWith('output/postgresql/') || path.startsWith('output/sqlite/')) expect(outputs.get(path)).toBeNull()
  })

  it('removes stale schema output after rename or delete', () => {
    const project = fixture()
    const previous = withOutputs(project)
    project.schemas[1]!.schema = 'logs'
    const outputs = asMap(generatedFileChanges(project, [schemaPath('audit'), schemaPath('logs')], previous, 'auto'))
    for (const dialect of ALL_SQL_DIALECTS) {
      expect(outputs.get(`output/${dialect}/audit.sql`)).toBeNull()
      expect(outputs.get(`output/${dialect}/logs.sql`)).toBeTypeOf('string')
    }
  })

  it('deletes empty summaries instead of leaving stale output', () => {
    const project = fixture()
    const previous = withOutputs(project)
    project.schemas = []
    project.initialData.clear()
    for (const dialect of ALL_SQL_DIALECTS) vi.spyOn(DIALECT_GENERATORS[dialect], 'initialData').mockReturnValue('')
    const outputs = asMap(generatedFileChanges(project, [databasePath], previous, 'auto'))
    for (const path of previous.keys()) if (path.startsWith('output/')) expect(outputs.get(path)).toBeNull()
  })

  it('does not generate output when saving only version, migration or environment documents', () => {
    const project = fixture()
    expect(generatedFileChanges(project, ['versions/v1.json', 'migrations/m1.json', 'environments/e1.json'], projectSourceFiles(project), 'auto')).toEqual([])
  })

  it('reuses prepared output when retrying failed output writes', () => {
    const project = fixture()
    const previous = withOutputs(project)
    const ddl = vi.spyOn(DIALECT_GENERATORS.mysql, 'schema')
    const dml = vi.spyOn(DIALECT_GENERATORS.mysql, 'initialData')
    const outputs = asMap(generatedFileChanges(project, ['output/mysql/__all__.sql'], previous, 'auto'))
    expect(ddl).not.toHaveBeenCalled()
    expect(dml).not.toHaveBeenCalled()
    expect(outputs.get('output/mysql/__all__.sql')).toBe(previous.get('output/mysql/__all__.sql'))
  })

  it('manual save generates missing files and the AI guide defaults to enabled', () => {
    const project = fixture()
    delete project.common!.generate_ai_guide
    const outputs = asMap(generatedFileChanges(project, [], new Map(), 'manual'))
    expect(outputs.get(AI_GUIDE_FILE)).toContain('JSON')
    expect(outputs.get('output/mysql/app.sql')).toBeTypeOf('string')
    project.common!.generate_ai_guide = false
    expect(asMap(generatedFileChanges(project, ['common.json'], new Map(), 'auto')).get(AI_GUIDE_FILE)).toBeNull()
  })

  it('lists only owned generated paths for initial loading', () => {
    const project = fixture()
    expect(projectOutputPaths(project)).toHaveLength(16)
    expect(projectOutputPaths(project)).toContain(AI_GUIDE_FILE)
    expect(projectOutputPaths(project)).toContain('output/mysql/__all__.sql')
    expect(new Set(projectOutputPaths(project)).size).toBe(16)
  })

  it('coordinator suppresses unchanged generated output and unrelated JSON writes', async () => {
    const project = fixture()
    const initialFiles = withOutputs(project)
    const save = vi.fn(async (changes: readonly FileChange[]) => ({ savedPaths: changes.map(change => change.path) }))
    const coordinator = new SaveCoordinator({
      writer: { supportsAutoSave: true, save }, initialFiles,
      prepare: (changed, mode) => generatedFileChanges(project, changed, coordinator.files, mode),
    })
    project.initialData.get('app/users')!.rows![0]!.data.id = 2
    coordinator.update(affectedSourceChanges(project, [affectedInitialData('app', 'users')], coordinator.files))
    await coordinator.saveChanges()
    expect(save).toHaveBeenCalledTimes(1)
    const paths = save.mock.calls[0]![0].map(change => change.path)
    expect(paths).toHaveLength(7)
    expect(paths).toContain(initialPath('app', 'users'))
    expect(paths).not.toContain('common.json')
    expect(paths).not.toContain(tablePath('app', 'users'))
    expect(paths).not.toContain('output/mysql/app.sql')
    expect(paths).not.toContain('output/mysql/__all_schemas__.sql')
    expect(coordinator.state.dirty).toBe(false)
    await coordinator.dispose()
  })
})
