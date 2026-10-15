import { describe, expect, it, vi } from 'vitest'
import { reactive, ref, toRaw } from 'vue'
import type { Schema, Table } from '@/types/schema'
import { CommandManager, affectedDatabase, affectedSchema, affectedSql, affectedTable, type Command } from '@/core/history/command'
import { parseCreateTableStatements, type ParsedTable } from '@/utils/sql-parser'
import { sanitizeName } from '@/core/workspace/layout'
import { createImportSqlActions, type ImportSqlDeps } from './editor-import-sql'

const table = (name: string): Table => ({ name, comment: '', fields: [], indexes: [] })
function setup(source: Schema[] = []) {
  const manager = new CommandManager()
  const persist = vi.fn()
  manager.setPersistHook(persist)
  const schemas = reactive(source)
  const schemaOrder = ref(source.map(schema => schema.schema))
  const deps: ImportSqlDeps = {
    showImportSqlModal: ref(true),
    importSqlText: ref(''),
    importSqlDialect: ref('auto'),
    importSqlParsedTables: ref([]),
    importSqlErrors: ref([]),
    importSqlTargetMode: ref('new'),
    importSqlTargetSchemaIdx: ref(-1),
    importSqlNewSchemaName: ref('imported'),
    importSqlDetectedSchema: ref(null),
    importSqlTableNameEdits: reactive({}),
    commonConfig: ref(null),
    schemas,
    selectedSchemaIdx: ref(source.length ? 0 : -1),
    selectedTableIdx: ref(source[0]?.tables.length ? 0 : -1),
    syncSchemaOrder: vi.fn(() => { schemaOrder.value = schemas.map(schema => schema.schema) }),
    executeCommand: vi.fn((command: Command) => manager.execute(command)),
    showToast: vi.fn(),
    t: (key, options) => options?.count === undefined ? key : `${key}:${options.count}`,
  }
  const actions = createImportSqlActions(deps)
  const parse = (sql: string) => {
    deps.importSqlText.value = sql
    actions.parseImportSql()
  }
  return { ...deps, ...actions, manager, persist, schemaOrder, parse }
}

const dialectCases = [
  { dialect: 'mysql' as const, sql: "CREATE TABLE `users` (`id` BIGINT NOT NULL AUTO_INCREMENT, `name` VARCHAR(40) DEFAULT 'guest', PRIMARY KEY (`id`), UNIQUE KEY `uk_name` (`name`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='users';" },
  { dialect: 'postgresql' as const, sql: 'CREATE TABLE "public"."users" ("id" SERIAL PRIMARY KEY, "name" VARCHAR(40) UNIQUE); COMMENT ON TABLE "public"."users" IS \'users\';' },
  { dialect: 'sqlite' as const, sql: 'PRAGMA foreign_keys = ON; CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE);' },
]

describe('SQL import command factory', () => {
  it.each(dialectCases)('parses and imports $dialect to a new schema in one reversible command', ({ dialect, sql }) => {
    const s = setup([{ schema: 'existing', tables: [table('keep')] }])
    s.parse(sql)
    expect(s.importSqlDialect.value).toBe(dialect)
    expect(s.importSqlParsedTables.value).toHaveLength(1)
    expect(s.executeCommand).not.toHaveBeenCalled()
    s.confirmImportSql()
    expect(s.executeCommand).toHaveBeenCalledTimes(1)
    const imported = s.schemas[1]!
    expect(imported.tables).toHaveLength(1)
    expect(imported.tables[0]!.name).toBe('users')
    expect(imported.tables[0]!.fields.map(field => field.field_name)).toEqual(['id', 'name'])
    expect(imported.tables[0]!.fields[0]!.primary_key).toBe(true)
    expect(imported.tables[0]!.indexes.some(index => index.type === 'unique')).toBe(true)
    if (dialect === 'mysql') expect(imported.tables[0]!.mysql).toEqual({ mysql_engine: 'InnoDB', mysql_charset: 'utf8mb4' })
    expect(s.selectedSchemaIdx.value).toBe(1)
    expect(s.selectedTableIdx.value).toBe(0)
    expect(s.showImportSqlModal.value).toBe(false)
    const files = [affectedDatabase(), affectedSchema(imported.schema), affectedTable(imported.schema, 'users'), affectedSql()]
    expect(s.persist).toHaveBeenLastCalledWith(files)
    s.manager.undo()
    expect(s.schemas.map(schema => schema.schema)).toEqual(['existing'])
    expect(s.schemaOrder.value).toEqual(['existing'])
    expect(s.selectedSchemaIdx.value).toBe(0)
    expect(s.selectedTableIdx.value).toBe(0)
    expect(s.manager.canUndo).toBe(false)
    s.manager.redo()
    expect(s.schemas[1]).toBe(imported)
    expect(s.schemaOrder.value).toEqual(['existing', imported.schema])
    expect(s.persist.mock.calls.map(call => call[0])).toEqual([files, files, files])
    expect(s.syncSchemaOrder).toHaveBeenCalledTimes(3)
  })

  it.each(dialectCases)('appends $dialect tables to an existing schema and preserves old order/content', ({ dialect, sql }) => {
    const s = setup([{ schema: 'public', tables: [table('z'), table('a')], pre_sql: { sqlite: 'keep' } }, { schema: 'other', tables: [] }])
    s.parse(sql)
    s.importSqlDialect.value = dialect
    s.importSqlTargetMode.value = 'existing'
    s.importSqlTargetSchemaIdx.value = 0
    const existing = s.schemas[0]!.tables.slice()
    s.confirmImportSql()
    expect(s.schemas).toHaveLength(2)
    expect(s.schemas[0]!.tables.map(table => table.name)).toEqual(['z', 'a', 'users'])
    expect(s.selectedTableIdx.value).toBe(2)
    const files = [affectedSchema('public'), affectedTable('public', 'users'), affectedSql()]
    expect(s.persist).toHaveBeenLastCalledWith(files)
    s.manager.undo()
    expect(s.schemas[0]!.tables).toEqual(existing)
    expect(s.schemas[0]!.tables[0]).toBe(existing[0])
    expect(s.schemas[0]!.pre_sql).toEqual({ sqlite: 'keep' })
    s.manager.redo()
    expect(s.schemas[0]!.tables.map(table => table.name)).toEqual(['z', 'a', 'users'])
    expect(s.syncSchemaOrder).not.toHaveBeenCalled()
    expect(s.persist.mock.calls.map(call => call[0])).toEqual([files, files, files])
  })

  it('keeps composite table-level primary keys on fields instead of dropping them as indexes', () => {
    const s = setup()
    s.parse('CREATE TABLE orders (tenant_id BIGINT NOT NULL, id BIGINT NOT NULL, name VARCHAR(20), PRIMARY KEY (tenant_id, id), KEY idx_name (name));')
    s.confirmImportSql()
    const imported = s.schemas[0]!.tables[0]!
    expect(imported.fields.map(field => [field.field_name, !!field.primary_key, !!field.not_null]))
      .toEqual([['tenant_id', true, true], ['id', true, true], ['name', false, false]])
    expect(imported.indexes.map(index => index.name)).toEqual(['idx_name'])
  })

  it('imports multiple tables atomically and never coalesces consecutive batches', () => {
    const s = setup([{ schema: 'public', tables: [table('keep')] }])
    s.importSqlTargetMode.value = 'existing'
    s.importSqlTargetSchemaIdx.value = 0
    s.parse('CREATE TABLE a (id INT); CREATE TABLE b (id INT);')
    s.confirmImportSql()
    s.confirmImportSql()
    expect(s.schemas[0]!.tables.map(table => table.name)).toEqual(['keep', 'a', 'b', 'a_1', 'b_1'])
    expect(vi.mocked(s.executeCommand).mock.calls.every(([command]) => command.coalesceKey === undefined)).toBe(true)
    s.manager.undo()
    expect(s.schemas[0]!.tables.map(table => table.name)).toEqual(['keep', 'a', 'b'])
    s.manager.undo()
    expect(s.schemas[0]!.tables.map(table => table.name)).toEqual(['keep'])
    s.manager.redo()
    s.manager.redo()
    expect(s.schemas[0]!.tables.map(table => table.name)).toEqual(['keep', 'a', 'b', 'a_1', 'b_1'])
  })

  it('applies table name edits using the original parser index before filtering empty tables', () => {
    const s = setup()
    const empty: ParsedTable = { name: 'empty', columns: [], constraints: [], options: {}, ifNotExists: false, temporary: false }
    const valid = parseCreateTableStatements('CREATE TABLE real (id INT); CREATE TABLE second (id INT);').tables
    s.importSqlParsedTables.value = [empty, ...valid]
    s.importSqlTableNameEdits[0] = 'must_not_shift'
    s.importSqlTableNameEdits[1] = ' renamed '
    s.importSqlTableNameEdits[2] = '  '
    s.confirmImportSql()
    expect(s.schemas[0]!.tables.map(table => table.name)).toEqual(['renamed', 'second'])
  })

  it.each(['new', 'existing'] as const)('deduplicates repeated, sanitized and case-colliding names for %s schema', mode => {
    const s = setup(mode === 'existing' ? [{ schema: 'target', tables: [table('Users'), table('a_b')] }] : [])
    s.importSqlTargetMode.value = mode
    s.importSqlTargetSchemaIdx.value = mode === 'existing' ? 0 : -1
    const names = ['users', 'Users', 'users', 'a/b', 'a:b', 'a_b', 'SCHEMA.JSON']
    s.importSqlParsedTables.value = names.map(name => ({ ...parseCreateTableStatements('CREATE TABLE x (id INT);').tables[0]!, name }))
    s.confirmImportSql()
    const actual = s.schemas[0]!.tables.map(table => table.name)
    const disk = actual.map(name => sanitizeName(name).toLowerCase())
    expect(new Set(disk).size).toBe(disk.length)
    expect(disk).not.toContain('schema.json')
    if (mode === 'existing') expect(actual.slice(0, 2)).toEqual(['Users', 'a_b'])
    s.manager.undo()
    if (mode === 'existing') expect(s.schemas[0]!.tables.map(table => table.name)).toEqual(['Users', 'a_b'])
    else expect(s.schemas).toHaveLength(0)
    s.manager.redo()
    expect(s.schemas[0]!.tables.map(table => table.name)).toEqual(actual)
  })

  it('new schema names also avoid sanitized/case collisions and preserve order on undo', () => {
    const s = setup([{ schema: 'A_B', tables: [] }, { schema: 'a:b_1', tables: [] }])
    s.importSqlNewSchemaName.value = 'a/b'
    s.parse('CREATE TABLE x (id INT);')
    s.confirmImportSql()
    expect(s.schemaOrder.value).toEqual(['A_B', 'a:b_1', 'a/b_2'])
    s.manager.undo()
    expect(s.schemaOrder.value).toEqual(['A_B', 'a:b_1'])
    s.manager.redo()
    expect(s.schemaOrder.value).toEqual(['A_B', 'a:b_1', 'a/b_2'])
  })

  it('missing or unusable new schema/table names get safe defaults', () => {
    const s = setup()
    s.parse('CREATE TABLE x (id INT);')
    s.importSqlNewSchemaName.value = '  '
    s.importSqlTableNameEdits[0] = 'CON'
    s.confirmImportSql()
    expect(s.schemas[0]!.schema).toBe('imported')
    expect(s.schemas[0]!.tables[0]!.name).toBe('table')
  })

  it.each([-1, 3, 0.5, NaN])('invalid existing target %s does not modify data, close modal or report success', target => {
    const s = setup([{ schema: 'public', tables: [] }])
    s.parse('CREATE TABLE x (id INT);')
    s.importSqlTargetMode.value = 'existing'
    s.importSqlTargetSchemaIdx.value = target
    s.confirmImportSql()
    expect(s.schemas).toEqual([{ schema: 'public', tables: [] }])
    expect(s.showImportSqlModal.value).toBe(true)
    expect(s.showToast).toHaveBeenLastCalledWith('importSqlModal.selectSchema')
    expect(s.executeCommand).not.toHaveBeenCalled()
    expect(s.persist).not.toHaveBeenCalled()
  })

  it('a target deleted while the modal is open is rejected', () => {
    const s = setup([{ schema: 'public', tables: [] }])
    s.openImportSqlModal(0)
    s.parse('CREATE TABLE x (id INT);')
    s.schemas.splice(0, 1)
    s.confirmImportSql()
    expect(s.schemas).toEqual([])
    expect(s.executeCommand).not.toHaveBeenCalled()
    expect(s.showImportSqlModal.value).toBe(true)
  })

  it.each(['', '   ', 'SELECT 1;', 'CREATE TABLE empty ();'])('empty or filtered SQL %j is a no-op', sql => {
    const s = setup()
    s.parse(sql)
    s.confirmImportSql()
    expect(s.schemas).toEqual([])
    expect(s.executeCommand).not.toHaveBeenCalled()
    expect(s.showToast).toHaveBeenLastCalledWith('importSqlModal.noValidTables')
    expect(s.showImportSqlModal.value).toBe(true)
  })

  it('import snapshots are isolated from parser refs, UI name edits and later mutable objects on redo', () => {
    const s = setup([{ schema: 'public', tables: [table('keep')] }])
    s.importSqlTargetMode.value = 'existing'
    s.importSqlTargetSchemaIdx.value = 0
    s.parse("CREATE TABLE users (id INT, name VARCHAR(20) DEFAULT 'guest');")
    s.importSqlTableNameEdits[0] = 'renamed'
    s.confirmImportSql()
    const imported = s.schemas[0]!.tables[1]!
    const snapshot = structuredClone(toRaw(imported))
    s.importSqlParsedTables.value[0]!.columns[0]!.name = 'mutated'
    s.importSqlTableNameEdits[0] = 'changed'
    imported.fields[0]!.field_name = 'direct mutation'
    s.manager.undo()
    imported.name = 'detached mutation'
    s.manager.redo()
    expect(s.schemas[0]!.tables[1]).toStrictEqual(snapshot)
    expect(s.schemas[0]!.tables[1]).toBe(imported)
    expect(s.persist).toHaveBeenLastCalledWith([affectedSchema('public'), affectedTable('public', 'renamed'), affectedSql()])
  })

  it('new schema redo resets detached snapshot mutations and selection', () => {
    const s = setup()
    s.parse('CREATE TABLE x (id INT); CREATE TABLE y (id INT);')
    s.confirmImportSql()
    const created = s.schemas[0]!
    s.manager.undo()
    created.schema = 'mutated'
    created.tables[0]!.fields = []
    created.tables.push(table('outside'))
    s.manager.redo()
    expect(s.schemas[0]!.schema).toBe('imported')
    expect(s.schemas[0]!.tables.map(table => table.name)).toEqual(['x', 'y'])
    expect(s.schemas[0]!.tables[0]!.fields).toHaveLength(1)
    expect(s.selectedSchemaIdx.value).toBe(0)
    expect(s.selectedTableIdx.value).toBe(0)
  })

  it('modal reset and schema detection remain transient and never issue commands', () => {
    const s = setup([{ schema: 'public', tables: [] }])
    s.importSqlTableNameEdits[0] = 'edited'
    s.openImportSqlModal(0)
    expect(s.importSqlTableNameEdits).toEqual({})
    expect(s.importSqlDialect.value).toBe('auto')
    expect(s.importSqlTargetMode.value).toBe('existing')
    s.parse('CREATE TABLE public.x (id INT);')
    expect(s.importSqlDetectedSchema.value).toBe('public')
    expect(s.importSqlTargetSchemaIdx.value).toBe(0)
    s.parse('CREATE TABLE elsewhere.x (id INT);')
    expect(s.importSqlTargetMode.value).toBe('new')
    expect(s.importSqlNewSchemaName.value).toBe('elsewhere')
    s.parse('')
    expect(s.importSqlParsedTables.value).toEqual([])
    expect(s.importSqlErrors.value).toEqual([])
    expect(s.importSqlDetectedSchema.value).toBeNull()
    expect(s.executeCommand).not.toHaveBeenCalled()
  })
})
