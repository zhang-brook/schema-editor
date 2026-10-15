import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, reactive, ref } from 'vue'
import { CommandManager, type AffectedFile, type Command } from '@/core/history/command'
import type { CommonConfig, Field, Index, InitialData, Schema, Table } from '@/types/schema'
import type { SqlDialect } from '@/utils/sql-generator/shared'
import { confirmDialog } from '@/composables/useConfirm'
import { createCrudActions, type CrudDeps } from './editor-crud'

vi.mock('@/composables/useConfirm', () => ({ confirmDialog: vi.fn(async () => true) }))

const dialects: SqlDialect[] = ['mysql', 'postgresql', 'sqlite']
function makeTable(name: string): Table {
  return {
    name, comment: '',
    fields: [{ field_name: 'id', field_type: 'int' }, { field_name: 'code', field_type: 'varchar', field_length: 20 }, { field_name: 'extra' }],
    indexes: [
      { type: 'unique', columns: [{ name: 'id', mysql: { sort_order: 'DESC' } }] },
      { type: 'index', columns: [{ name: 'id' }, { name: 'code', postgresql: { sort_order: 'ASC' } }] },
      { name: 'code_idx', type: 'index', columns: [{ name: 'code' }] },
    ],
    comment_before_fields: { id: ['id comment', null, 'end'], code: 'code comment' },
    partition: { mysql: { strategy: 'HASH', columns: ['id'] }, postgresql: { columns: ['id', 'code'] }, sqlite: { columns: ['id'] } },
  }
}
function fixture(execute?: (command: Command) => void) {
  const schemas = reactive<Schema[]>([
    { schema: 'alpha', tables: [makeTable('users'), makeTable('posts')], pre_sql: { mysql: 'schema before' }, post_sql: { sqlite: 'schema after' } },
    { schema: 'beta', tables: [makeTable('users')] },
  ])
  const manager = new CommandManager()
  const persist = vi.fn<(files: AffectedFile[]) => void>()
  manager.setPersistHook(persist)
  const key = (schema: string, table: string) => `${schema}/${table}`
  const initialDataMap = reactive(new Map<string, InitialData>())
  for (const schema of schemas) for (const table of schema.tables) {
    initialDataMap.set(key(schema.schema, table.name), {
      rows: [{ data: { id: 1, code: 'a' }, field_comments: { id: 'identity' }, expr_fields: { id: true } }],
      pre_sql: { mysql: 'before rows' }, post_sql: { sqlite: 'after rows' },
    })
  }
  const deps: CrudDeps = {
    schemas,
    commonConfig: ref<CommonConfig>({
      default_config: { mysql: { database: {}, table: { mysql_engine: '', mysql_charset: '', mysql_collation: '' } }, postgresql: { quote_identifiers: true } },
      common_used_fields: { shared: { field_name: 'shared', field_type: 'text' } }, schema_order: ['alpha', 'beta'],
    }),
    selectedSchemaIdx: ref(0), selectedTableIdx: ref(0),
    expandedFields: reactive(new Set<string>()), expandedIndexes: reactive(new Set<string>()), settingsTab: ref('structure'),
    addFieldSchemaIdx: ref(0), addFieldTableIdx: ref(0), addFieldMode: ref('normal'), newFieldName: ref('new_field'),
    newFieldSelectCommon: ref(''), newFieldSelectCommons: ref([]), newFieldUnifiedType: ref(''), showAddFieldModal: ref(false),
    initialDataMap, initialDataDeletedKeys: new Set(), currentSchema: computed(() => schemas[0]), initialDataKey: key,
    executeCommand: execute ?? (cmd => manager.execute(cmd)), showToast: vi.fn(), t: (key: string) => key,
  }
  const actions = createCrudActions(deps)
  const table = schemas[0]!.tables[0]!
  return { deps, actions, manager, persist, schemas, table, field: table.fields[0]!, index: table.indexes[0]!, data: initialDataMap.get('alpha/users')! }
}
type Fixture = ReturnType<typeof fixture>
function state(f: Fixture) {
  return JSON.parse(JSON.stringify({ schemas: f.schemas, order: f.deps.commonConfig.value?.schema_order, data: [...f.deps.initialDataMap].sort(([a], [b]) => a.localeCompare(b)) }))
}
async function roundTrip(f: Fixture, operation: () => unknown, verify?: () => void) {
  f.manager.breakCoalescing()
  const before = state(f)
  await operation()
  const after = state(f)
  expect(after).not.toEqual(before)
  verify?.()
  const files = f.persist.mock.calls.at(-1)![0]
  for (let n = 0; n < 2; n++) {
    f.manager.undo()
    expect(state(f)).toEqual(before)
    expect(f.persist.mock.calls.at(-1)![0]).toEqual(files)
    f.manager.redo()
    expect(state(f)).toEqual(after)
    expect(f.persist.mock.calls.at(-1)![0]).toEqual(files)
    verify?.()
  }
}
function expectPaths(f: Fixture, pairs: [string, string][]) {
  const files = f.persist.mock.calls.at(-1)![0]
  for (const [schema, table] of pairs) {
    expect(files).toContainEqual({ kind: 'schema', schema })
    expect(files).toContainEqual({ kind: 'table', schema, table })
    expect(files).toContainEqual({ kind: 'initial-data', schema, table })
  }
  expect(files.every(file => !file.oldSchema && !file.oldTable)).toBe(true)
}

beforeEach(() => { vi.mocked(confirmDialog).mockResolvedValue(true) })

describe('schema / table structure commands', () => {
  it('adds schemas with symmetric schema_order and separate undo entries', async () => {
    const f = fixture()
    await roundTrip(f, () => f.actions.addSchema('gamma'))
    f.actions.addSchema('delta')
    f.manager.undo()
    expect(f.schemas.map(s => s.schema)).toEqual(['alpha', 'beta', 'gamma'])
    f.manager.undo()
    expect(f.deps.commonConfig.value!.schema_order).toEqual(['alpha', 'beta'])
  })

  it('adds unique new_table/new_table2 names without coalescing', () => {
    const f = fixture()
    f.actions.addTable(0)
    f.actions.addTable(0)
    expect(f.schemas[0]!.tables.map(t => t.name)).toEqual(['users', 'posts', 'new_table', 'new_table2'])
    f.manager.undo()
    expect(f.schemas[0]!.tables.at(-1)!.name).toBe('new_table')
    f.manager.undo()
    expect(f.schemas[0]!.tables).toHaveLength(2)
    f.manager.redo(); f.manager.redo()
    expect(f.schemas[0]!.tables).toHaveLength(4)
  })

  it.each(['', '   ', '.', '..', '___', 'a/b', 'a\\b', 'a:b', 'a*', 'a\u0000b', 'nul', 'CON.txt', 'com1', 'trailing.'])('rejects invalid schema/table name %j', name => {
    const f = fixture()
    f.actions.addSchema(name)
    f.actions.renameSchema(0, name)
    expect(f.actions.renameTable(0, 0, name)).toBe(false)
    expect(f.manager.canUndo).toBe(false)
  })

  it('rejects same, case-insensitive and sanitized path collisions (also self aliases)', () => {
    const f = fixture()
    for (const name of ['alpha', 'ALPHA', '_alpha_', 'alPHA']) f.actions.addSchema(name)
    f.actions.renameSchema(0, 'BETA')
    f.actions.renameSchema(0, 'Alpha')
    for (const name of ['posts', 'POSTS', '_posts_', 'Users', '_users_']) expect(f.actions.renameTable(0, 0, name)).toBe(false)
    f.actions.moveTableToSchema(0, 0, 1, 0)
    expect(f.manager.canUndo).toBe(false)
    expect(f.schemas[0]!.tables[0]).toBe(f.table)
  })

  it('generated names avoid sanitized/case collisions too', () => {
    const f = fixture()
    f.schemas[0]!.tables.push(makeTable('_NEW_TABLE_'), makeTable('USERS_COPY'))
    f.schemas.push({ schema: '_ALPHA_COPY_', tables: [] })
    f.actions.addTable(0)
    expect(f.schemas[0]!.tables.at(-1)!.name).toBe('new_table2')
    f.actions.copyTable(0, 0)
    expect(f.schemas[0]!.tables[1]!.name).toBe('users_copy2')
    f.actions.copySchema(0)
    expect(f.schemas[1]!.schema).toBe('alpha_copy2')
  })

  it('moves schemas and tables entirely inside apply, retaining selection and order', async () => {
    const f = fixture()
    await roundTrip(f, () => f.actions.moveSchema(0, 1), () => expect(f.schemas.map(s => s.schema)).toEqual(['beta', 'alpha']))
    f.manager.undo()
    await roundTrip(f, () => f.actions.moveTable(0, 0, 2), () => {
      expect(f.schemas[0]!.tables.map(t => t.name)).toEqual(['posts', 'users'])
      expect(f.deps.selectedTableIdx.value).toBe(1)
    })
  })

  it('moves tables across schemas and migrates rows with both paths on undo/redo', async () => {
    const f = fixture()
    const data = f.deps.initialDataMap.get('alpha/posts')
    await roundTrip(f, () => f.actions.moveTableToSchema(0, 1, 1, 1), () => {
      expect(f.schemas[0]!.tables.map(t => t.name)).toEqual(['users'])
      expect(f.schemas[1]!.tables.map(t => t.name)).toEqual(['users', 'posts'])
      expect(f.deps.initialDataMap.get('beta/posts')).toBe(data)
      expectPaths(f, [['alpha', 'posts'], ['beta', 'posts']])
      expect(f.deps.initialDataDeletedKeys.has('alpha/posts')).toBe(true)
      expect(f.deps.initialDataDeletedKeys.has('beta/posts')).toBe(false)
    })
    f.manager.undo()
    expect(f.deps.initialDataDeletedKeys.has('beta/posts')).toBe(true)
    expect(f.deps.initialDataDeletedKeys.has('alpha/posts')).toBe(false)
  })

  it('schema rename affects old/new schema, all tables and initial-data, including absent data', async () => {
    const f = fixture()
    f.deps.initialDataMap.delete('alpha/posts')
    await roundTrip(f, () => f.actions.renameSchema(0, 'renamed'), () => {
      expect(f.deps.initialDataMap.get('renamed/users')).toBe(f.data)
      expectPaths(f, [['alpha', 'users'], ['alpha', 'posts'], ['renamed', 'users'], ['renamed', 'posts']])
      expect(f.deps.commonConfig.value!.schema_order).toEqual(['renamed', 'beta'])
    })
  })

  it('table rename migrates data and declares old/new paths', async () => {
    const f = fixture()
    await roundTrip(f, () => f.actions.renameTable(0, 0, 'customers'), () => {
      expectPaths(f, [['alpha', 'users'], ['alpha', 'customers']])
      expect(f.deps.initialDataMap.get('alpha/customers')).toBe(f.data)
      expect(f.deps.initialDataMap.has('alpha/users')).toBe(false)
    })
  })

  it.each(['table', 'schema'] as const)('delete %s snapshots values but restores older command identities', async kind => {
    const f = fixture()
    f.actions.updateFieldProp(f.table, f.field, 'comment', 'edited')
    const schema = f.schemas[0]!
    const field = f.field
    const index = f.index
    const data = f.data
    const before = state(f)
    if (kind === 'schema') await f.actions.deleteSchema(0)
    else await f.actions.deleteTable(0, 0)
    expectPaths(f, kind === 'schema' ? [['alpha', 'users'], ['alpha', 'posts']] : [['alpha', 'users']])
    field.comment = 'detached pollution'
    index.columns[0]!.mysql!.sort_order = 'ASC'
    data.rows![0]!.data.id = 99
    f.table.fields = []
    f.manager.undo()
    expect(state(f)).toEqual(before)
    expect(f.schemas[0]).toBe(schema)
    expect(f.schemas[0]!.tables[0]!.fields[0]).toBe(field)
    expect(f.schemas[0]!.tables[0]!.indexes[0]).toBe(index)
    expect(f.deps.initialDataMap.get('alpha/users')).toBe(data)
    f.manager.undo()
    expect(field.comment).toBeUndefined()
    f.manager.redo()
    expect(field.comment).toBe('edited')
    f.manager.redo()
    expect(f.deps.initialDataMap.has('alpha/users')).toBe(false)
    f.manager.undo()
    expect(state(f)).toEqual(before)
  })

  it.each(['table', 'schema'] as const)('copy %s includes SQL/child files and isolates source and detached snapshots', async kind => {
    const f = fixture()
    await roundTrip(f, () => kind === 'schema' ? f.actions.copySchema(0) : f.actions.copyTable(0, 0))
    const copySchema = kind === 'schema' ? f.schemas[1]! : f.schemas[0]!
    const copy = copySchema.tables[kind === 'schema' ? 0 : 1]!
    const key = f.deps.initialDataKey(copySchema.schema, copy.name)
    const copyData = f.deps.initialDataMap.get(key)!
    expect(copy).not.toBe(f.table)
    expect(copyData).not.toBe(f.data)
    if (kind === 'schema') {
      expect(copySchema.pre_sql).toEqual({ mysql: 'schema before' })
      expect(copySchema.post_sql).toEqual({ sqlite: 'schema after' })
      expectPaths(f, [['alpha_copy', 'users'], ['alpha_copy', 'posts']])
    }
    f.manager.undo()
    f.field.comment = 'source changed'
    f.data.rows![0]!.data.id = 90
    copy.fields[0]!.comment = 'detached changed'
    copyData.rows![0]!.data.id = 91
    f.manager.redo()
    expect(copy.fields[0]!.comment).toBeUndefined()
    expect(copyData.rows![0]!.data.id).toBe(1)
    expect(f.deps.initialDataMap.get(key)).toBe(copyData)
  })

  it('cancelled confirmations leave all data and history untouched', async () => {
    vi.mocked(confirmDialog).mockResolvedValue(false)
    const f = fixture()
    const before = state(f)
    await f.actions.deleteSchema(0)
    await f.actions.deleteTable(0, 0)
    await f.actions.deleteField(f.table, 0)
    await f.actions.deleteIndex(f.table, 0)
    expect(state(f)).toEqual(before)
    expect(f.manager.canUndo).toBe(false)
  })
})

describe('field actions and related data', () => {
  it('renames index columns, comments, all partitions and row data/comments/expressions atomically', async () => {
    const f = fixture()
    f.data.rows![0]!.data.renamed = 'orphan to restore'
    f.data.rows![0]!.field_comments!.renamed = 'orphan comment'
    f.table.comment_before_fields!.renamed = 'orphan before'
    await roundTrip(f, () => f.actions.updateFieldName(f.table, f.field, ' renamed '), () => {
      expect(f.index.columns[0]!.name).toBe('renamed')
      expect(f.table.comment_before_fields!.id).toBeUndefined()
      expect(f.table.comment_before_fields!.renamed).toEqual(['id comment', null, 'end'])
      for (const db of dialects) expect(f.table.partition![db]!.columns).toContain('renamed')
      expect(f.data.rows![0]!.data).toEqual({ renamed: 1, code: 'a' })
      expect(f.data.rows![0]!.field_comments).toEqual({ renamed: 'identity' })
      expect(f.data.rows![0]!.expr_fields).toEqual({ renamed: true })
      expect(f.persist.mock.calls.at(-1)![0]).toContainEqual({ kind: 'initial-data', schema: 'alpha', table: 'users' })
    })
  })

  it('rejects duplicate field names and routes generic field-name changes through linked rename', async () => {
    const f = fixture()
    f.actions.updateFieldName(f.table, f.field, 'CODE')
    expect(f.manager.canUndo).toBe(false)
    await roundTrip(f, () => f.actions.updateFieldProps(f.table, f.field, { field_name: 'pk', primary_key: true }), () => {
      expect(f.index.columns[0]!.name).toBe('pk')
      expect(f.field.primary_key).toBe(true)
    })
  })

  it('delete field removes empty indexes and pre-comments, preserves existing data/partition semantics', async () => {
    const f = fixture()
    const data = JSON.stringify(f.data)
    await roundTrip(f, () => f.actions.deleteField(f.table, 0), () => {
      expect(f.table.fields.map(f => f.field_name)).toEqual(['code', 'extra'])
      expect(f.table.indexes).toHaveLength(2)
      expect(f.table.indexes[0]!.columns).toEqual([{ name: 'code', postgresql: { sort_order: 'ASC' } }])
      expect(f.table.comment_before_fields).toEqual({ code: 'code comment' })
      expect(f.table.partition!.mysql!.columns).toEqual(['id'])
      expect(JSON.stringify(f.data)).toBe(data)
    })
  })

  it('common field selection has no preparation mutations and restores removed indexes/comments', async () => {
    const f = fixture()
    f.field.use_common_used_fields = true
    f.deps.addFieldMode.value = 'common'
    f.deps.newFieldSelectCommons.value = ['shared', 'code', 'shared']
    await roundTrip(f, () => f.actions.confirmAddField(), () => {
      expect(f.table.fields.map(f => f.field_name)).toEqual(['code', 'extra', 'shared'])
      expect(f.table.indexes).toHaveLength(2)
      expect(f.persist.mock.calls.at(-1)![0]).not.toContainEqual({ kind: 'common' })
    })
  })

  it('named/direct adds and field reordering have independent structural history', async () => {
    const f = fixture()
    await roundTrip(f, () => f.actions.confirmAddField())
    f.actions.directAddField(0, 0)
    f.actions.directAddField(0, 0)
    f.manager.undo()
    expect(f.table.fields.filter(f => f.field_name === '')).toHaveLength(1)
    f.manager.redo()
    await roundTrip(f, () => f.actions.moveField(f.table, 0, f.table.fields.length))
    await roundTrip(f, () => f.actions.moveFieldUp(f.table, 2))
    await roundTrip(f, () => f.actions.moveFieldDown(f.table, 0))
  })

  const properties: [keyof Field, unknown][] = [
    ['comment', 'hello'], ['field_type', 'numeric'], ['field_length', 40], ['field_scale', 3],
    ['field_length_disabled', true], ['field_scale_disabled', true], ['not_null', true], ['primary_key', true],
    ['default', false], ['quote_default', true], ['on_update_current_timestamp', true],
    ['on_update_current_timestamp_precision', 3], ['is_commented_out', true],
  ]
  it.each(properties)('scalar field %s execute/undo/redo', async (prop, value) => {
    const f = fixture()
    await roundTrip(f, () => f.actions.updateFieldProp(f.table, f.field, prop, value))
  })

  it('unified type/default compound patches clean properties and restore missing-vs-present keys', async () => {
    const f = fixture()
    f.field.quote_default = true
    f.field.default = 'value'
    await roundTrip(f, () => f.actions.updateFieldProps(f.table, f.field, { unified_type: 'text', field_type: undefined, quote_default: undefined }))
    expect(Object.hasOwn(f.field, 'field_type')).toBe(false)
    expect(Object.hasOwn(f.field, 'quote_default')).toBe(false)
    await roundTrip(f, () => f.actions.updateFieldProps(f.table, f.field, { default: undefined, quote_default: undefined }))
    expect(Object.hasOwn(f.field, 'default')).toBe(false)
  })

  it.each(dialects)('%s field overrides use owner table and cleanup empty overrides', async db => {
    const f = fixture()
    await roundTrip(f, () => f.actions.setFieldOverrideValue(f.field, db, 'field_length', '32'), () => {
      expect(f.field[db]?.field_length).toBe(32)
      expect(f.persist.mock.calls.at(-1)![0]).toEqual([{ kind: 'table', schema: 'alpha', table: 'users' }, { kind: 'sql' }])
    })
    await roundTrip(f, () => f.actions.setFieldOverrideValue(f.field, db, 'field_length', ''), () => expect(Object.hasOwn(f.field, db)).toBe(false))
    await roundTrip(f, () => f.actions.setFieldOverrideValue(f.field, db, 'field_scale', '2'))
    await roundTrip(f, () => f.actions.setFieldOverrideValue(f.field, db, 'default', false))
  })

  it('comment option enabling is atomic; add/remove are not coalesced; edits and cleanup round-trip', async () => {
    const f = fixture()
    await roundTrip(f, () => f.actions.setFieldCommentOptionsEnabled(f.table, f.field, true), () => expect(f.field.comment_options).toEqual([{ label: '', value: '' }]))
    await roundTrip(f, () => f.actions.updateFieldCommentOption(f.table, f.field, 0, 'label', 'enabled'))
    for (const db of dialects) {
      await roundTrip(f, () => f.actions.updateFieldCommentOption(f.table, f.field, 0, db, '1'))
      await roundTrip(f, () => f.actions.updateFieldCommentOption(f.table, f.field, 0, db, ''))
      expect(Object.hasOwn(f.field.comment_options![0]!, db)).toBe(false)
    }
    f.actions.addFieldCommentOption(f.table, f.field)
    f.actions.addFieldCommentOption(f.table, f.field)
    f.manager.undo()
    expect(f.field.comment_options).toHaveLength(2)
    f.manager.redo()
    await roundTrip(f, () => f.actions.removeFieldCommentOption(f.table, f.field, 0))
    expect(f.persist.mock.calls.at(-1)![0]).toEqual([{ kind: 'table', schema: 'alpha', table: 'users' }, { kind: 'sql' }])
  })

  it('common-field owner fallback affects common instead of treating field name as table', async () => {
    const f = fixture()
    const field = f.deps.commonConfig.value!.common_used_fields.shared!
    f.actions.setFieldOverrideValue(field, 'mysql', 'field_type', 'bigint')
    expect(f.persist.mock.calls.at(-1)![0]).toEqual([{ kind: 'common' }, { kind: 'sql' }])
    f.manager.undo(); expect(field.mysql).toBeUndefined()
    f.manager.redo(); expect(field.mysql).toEqual({ field_type: 'bigint' })
    f.actions.addFieldCommentOption(f.table, field)
    expect(f.persist.mock.calls.at(-1)![0]).toEqual([{ kind: 'common' }, { kind: 'sql' }])
    f.manager.undo(); expect(field.comment_options).toBeUndefined()
    f.manager.redo(); expect(field.comment_options).toHaveLength(1)
  })
})

describe('index, table SQL and merging', () => {
  it('index add/delete/sort restores exact order, nested overrides and older object identities', async () => {
    const f = fixture()
    await roundTrip(f, () => f.actions.addIndex(f.table))
    await roundTrip(f, () => f.actions.moveIndex(f.table, 0, f.table.indexes.length))
    await roundTrip(f, () => f.actions.moveIndexUp(f.table, 2))
    await roundTrip(f, () => f.actions.moveIndexDown(f.table, 0))
    await roundTrip(f, () => f.actions.deleteIndex(f.table, 0))
    expect(new Set(f.table.indexes).size).toBe(f.table.indexes.length)
  })

  it.each([
    { name: '{pre}custom{post}' }, { type: 'index' }, { using: 'BTREE' }, { comment: 'index comment' },
    { pre_comment: 'before index' }, { use_default_name: true }, { active_only: true },
    { logical_delete: { field: 'deleted_at', predicate: 'deleted_at IS NULL', mysql_strategy: 'functional' } },
  ] satisfies Partial<Index>[])('index patch %j is undoable', async patch => {
    const f = fixture()
    await roundTrip(f, () => f.actions.updateIndex(f.table, f.index, patch))
  })

  it('columns are atomic detached snapshots, including nested dialect values', async () => {
    const f = fixture()
    const columns: Index['columns'] = [{ name: 'code', sort_order: 'ASC', mysql: { sort_order: 'DESC' }, sqlite: { sort_order: 'ASC' } }]
    await roundTrip(f, () => f.actions.updateIndex(f.table, f.index, { columns }))
    columns[0]!.mysql!.sort_order = 'ASC'
    expect(f.index.columns[0]!.mysql!.sort_order).toBe('DESC')
    f.actions.updateIndex(f.table, f.index, { columns: [{ name: 'extra' }] })
    f.manager.undo()
    expect(f.index.columns[0]!.name).toBe('code')
    f.manager.undo()
    expect(f.index.columns[0]!.name).toBe('id')
    f.manager.redo()
    expect(f.index.columns[0]!.mysql!.sort_order).toBe('DESC')
    await roundTrip(f, () => f.actions.setIndexColumns(f.index, 'code, extra'))
  })

  it.each(dialects)('%s unnamed index override identity and cleanup are isolated', async db => {
    const f = fixture()
    const second = f.table.indexes[1]!
    f.actions.setIndexOverrideValue(f.index, db, 'name', 'a')
    f.actions.setIndexOverrideValue(second, db, 'name', 'b')
    f.manager.undo()
    expect(second[db]).toBeUndefined()
    expect(f.index[db]?.name).toBe('a')
    f.manager.undo()
    expect(f.index[db]).toBeUndefined()
    f.manager.redo(); f.manager.redo()
    await roundTrip(f, () => f.actions.setIndexOverrideValue(second, db, 'name', ''))
    expect(Object.hasOwn(second, db)).toBe(false)
  })

  it('coalesces only same target/property, including caller-provided keys', () => {
    const f = fixture()
    f.actions.updateFieldProp(f.table, f.field, 'comment', 'a', 'comment')
    f.actions.updateFieldProp(f.table, f.field, 'comment', 'abc', 'comment')
    f.manager.undo(); expect(f.field.comment).toBeUndefined()
    f.manager.redo(); expect(f.field.comment).toBe('abc')
    const otherTable = f.schemas[1]!.tables[0]!
    f.actions.updateFieldProp(otherTable, otherTable.fields[0]!, 'comment', 'other', 'comment')
    f.manager.undo(); expect(f.field.comment).toBe('abc')
    f.actions.directAddField(0, 0); f.actions.directAddField(0, 0)
    const first = f.table.fields.at(-2)!, second = f.table.fields.at(-1)!
    f.actions.updateFieldProp(f.table, first, 'comment', 'first', 'same')
    f.actions.updateFieldProp(f.table, second, 'comment', 'second', 'same')
    f.manager.undo(); expect(second.comment).toBe(''); expect(first.comment).toBe('first')
    f.actions.updateIndex(f.table, f.index, { comment: 'first' })
    f.actions.updateIndex(f.table, f.table.indexes[1]!, { comment: 'second' })
    f.manager.undo(); expect(f.index.comment).toBe('first'); expect(f.table.indexes[1]!.comment).toBeUndefined()
  })

  it('comment option scalar merging respects field identity', () => {
    const f = fixture()
    const second = f.table.fields[1]!
    f.actions.setFieldCommentOptionsEnabled(f.table, f.field, true)
    f.actions.setFieldCommentOptionsEnabled(f.table, second, true)
    f.actions.updateFieldCommentOption(f.table, f.field, 0, 'label', 'a')
    f.actions.updateFieldCommentOption(f.table, f.field, 0, 'label', 'abc')
    f.actions.updateFieldCommentOption(f.table, second, 0, 'label', 'other')
    f.manager.undo(); expect(second.comment_options![0]!.label).toBe('')
    f.manager.undo(); expect(f.field.comment_options![0]!.label).toBe('')
    f.manager.redo(); expect(f.field.comment_options![0]!.label).toBe('abc')
  })

  it('table comment and mysql settings round-trip, preserve siblings and clean empty objects', async () => {
    const f = fixture()
    await roundTrip(f, () => f.actions.updateTable(f.table, { comment: 'table comment' }))
    await roundTrip(f, () => f.actions.setCommentBeforeTable(f.table, 'before\n\nend'))
    expect(f.actions.commentBeforeTableText(f.table)).toBe('before\n\nend')
    await roundTrip(f, () => f.actions.setCommentBeforeTable(f.table, ''))
    delete f.table.comment_before_fields
    await roundTrip(f, () => f.actions.setCommentBeforeField(f.table, 'id', 'before'))
    f.manager.undo(); expect(Object.hasOwn(f.table, 'comment_before_fields')).toBe(false)
    f.manager.redo()
    await roundTrip(f, () => f.actions.setCommentBeforeField(f.table, 'id', ''))
    expect(Object.hasOwn(f.table, 'comment_before_fields')).toBe(false)
    const setters = [f.actions.setTableMysqlEngine, f.actions.setTableMysqlCharset, f.actions.setTableMysqlCollation]
    for (const setter of setters) await roundTrip(f, () => setter(f.table, 'configured'))
    for (const setter of setters) await roundTrip(f, () => setter(f.table, ''))
    expect(Object.hasOwn(f.table, 'mysql')).toBe(false)
  })

  it.each(dialects)('%s table/schema pre/post SQL and partition updates clean and restore state', async db => {
    const f = fixture()
    for (const setter of [f.actions.setTablePreSql, f.actions.setTablePostSql]) {
      await roundTrip(f, () => setter(f.table, db, '  SELECT 1;  '))
      await roundTrip(f, () => setter(f.table, db, ''))
    }
    for (const setter of [f.actions.setSchemaPreSql, f.actions.setSchemaPostSql]) {
      await roundTrip(f, () => setter(f.schemas[0]!, db, '  SELECT 2;  '))
      await roundTrip(f, () => setter(f.schemas[0]!, db, ''))
    }
    const cfg = { strategy: 'RANGE', columns: ['code'], expression: '' }
    await roundTrip(f, () => f.actions.setTablePartition(f.table, db, cfg))
    cfg.columns.push('external')
    expect(f.table.partition![db]!.columns).toEqual(['code'])
    const read = f.actions.getTablePartition(f.table, db)
    read.columns!.push('also external')
    expect(f.table.partition![db]!.columns).toEqual(['code'])
    await roundTrip(f, () => f.actions.setTablePartition(f.table, db, {}))
    expect(f.table.partition?.[db]).toBeUndefined()
  })
})

describe('command construction is side-effect free', () => {
  const operations: [string, (f: Fixture) => unknown][] = [
    ['moveSchema', f => f.actions.moveSchema(0, 1)],
    ['moveTable', f => f.actions.moveTable(0, 0, 2)],
    ['moveTableToSchema', f => f.actions.moveTableToSchema(0, 1, 1, 0)],
    ['moveField', f => f.actions.moveField(f.table, 0, 3)],
    ['moveIndex', f => f.actions.moveIndex(f.table, 0, 3)],
    ['addSchema', f => f.actions.addSchema('new')],
    ['addTable', f => f.actions.addTable(0)],
    ['copySchema', f => f.actions.copySchema(0)],
    ['copyTable', f => f.actions.copyTable(0, 0)],
    ['deleteSchema', f => f.actions.deleteSchema(0)],
    ['deleteTable', f => f.actions.deleteTable(0, 0)],
    ['deleteField', f => f.actions.deleteField(f.table, 0)],
    ['deleteIndex', f => f.actions.deleteIndex(f.table, 0)],
    ['commonSelection', f => { f.deps.addFieldMode.value = 'common'; f.field.use_common_used_fields = true; f.deps.newFieldSelectCommons.value = ['shared']; return f.actions.confirmAddField() }],
  ]
  it.each(operations)('%s mutates persisted state only inside apply and never coalesces', async (name, operation) => {
    const commands: Command[] = []
    const f = fixture(cmd => commands.push(cmd))
    if (name === 'commonSelection') f.field.use_common_used_fields = true
    const before = state(f)
    await operation(f)
    expect(state(f)).toEqual(before)
    expect(commands).toHaveLength(1)
    const cmd = commands[0]!
    expect(cmd.coalesceKey).toBeUndefined()
    cmd.apply()
    const after = state(f)
    expect(after).not.toEqual(before)
    cmd.revert(); expect(state(f)).toEqual(before)
    cmd.apply(); expect(state(f)).toEqual(after)
  })
})
