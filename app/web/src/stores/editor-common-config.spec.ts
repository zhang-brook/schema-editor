import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, reactive, ref } from 'vue'
import commonFieldsPanel from '@/components/settings/sections/CommonUsedFieldsPanel.vue?raw'
import unifiedTypesPanel from '@/components/settings/sections/UnifiedTypesPanel.vue?raw'
import type { CommonConfig, Field, InitialData, Schema, UnifiedTypeDefinition } from 'schema-editor-core/types/schema'
import { CommandManager, affectedCommon, affectedInitialData, affectedSql, affectedTable, type AffectedFile, type Command } from 'schema-editor-core/core/history/command'
import { confirmDialog } from '@/composables/useConfirm'
import { createCommonConfigActions } from './editor-common-config'

vi.mock('@/composables/useConfirm', () => ({ confirmDialog: vi.fn(async () => true) }))

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const definition = (name: string): UnifiedTypeDefinition => ({
  name, description: '', mysql: { type: 'VARCHAR', length: 32 }, postgresql: { type: 'TEXT' },
})

function fixture() {
  const commonConfig = ref<CommonConfig | null>({
    default_config: {
      mysql: { database: {}, table: { mysql_engine: 'InnoDB', mysql_charset: 'utf8mb4', mysql_collation: '' } },
      postgresql: { quote_identifiers: true },
    },
    common_used_fields: {
      id: { field_name: 'id', field_type: 'bigint', unified_type: 'U', comment: '', mysql: { field_type: 'BIGINT' }, comment_options: [{ label: 'old', value: '1' }] },
      flag: { field_name: 'flag', field_type: 'boolean' },
      note: { field_name: 'note', field_type: 'text' },
    },
    unified_types: [definition('U'), definition('V'), definition('W')],
  })
  const schemas = reactive<Schema[]>([
    { schema: 'public', tables: [
      {
        name: 'users', comment: '',
        fields: [{ field_name: 'id', use_common_used_fields: true, unified_type: 'U', mysql: { field_length: 10 } }, { field_name: 'local', unified_type: 'V' }],
        indexes: [
          { type: 'unique', columns: [{ name: 'id', mysql: { sort_order: 'DESC' } }, { name: 'local' }] },
          { type: 'index', columns: [{ name: 'id' }] },
        ],
        comment_before_fields: { id: ['before', null, 'after'], renamed: 'orphan comment', local: 'untouched' },
      },
      { name: 'unrelated', comment: '', fields: [{ field_name: 'id' }], indexes: [] },
    ] },
    { schema: 'audit', tables: [{ name: 'users', comment: '', fields: [{ field_name: 'id', use_common_used_fields: true }, { field_name: 'other', unified_type: 'U' }], indexes: [{ type: 'index', columns: [{ name: 'id' }] }] }] },
  ])
  const initialDataMap = reactive(new Map<string, InitialData>([
    ['public/users', { rows: [
      { data: { id: { nested: ['value'] }, local: 1, renamed: 'orphan data' }, field_comments: { id: 'id comment', renamed: 'orphan row comment' }, expr_fields: { id: false, renamed: true }, row_comment: 'keep' },
      { data: { id: null, local: 2 }, field_comments: { id: 'second' }, expr_fields: { id: true }, is_skip: true },
    ], pre_sql: { mysql: 'SELECT 1' } }],
    ['audit/users', { rows: [{ data: { other: 9 } }] }],
    ['public/unrelated', { rows: [{ data: { id: 4 } }] }],
  ]))
  const manager = new CommandManager()
  const persist = vi.fn<(files: AffectedFile[]) => void>()
  manager.setPersistHook(persist)
  const executeCommand = vi.fn((command: Command) => manager.execute(command))
  const showToast = vi.fn()
  const actions = createCommonConfigActions({ commonConfig, schemas, initialDataMap, executeCommand, showToast, t: key => key })
  const config = () => commonConfig.value!
  const field = () => config().common_used_fields.id!
  const type = () => config().unified_types!.find(item => item.name === 'U')!
  const state = () => copy({ common: config(), schemas, data: [...initialDataMap] })
  return { actions, manager, persist, executeCommand, showToast, commonConfig, config, schemas, initialDataMap, field, type, state }
}

describe('common configuration commands', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    vi.mocked(confirmDialog).mockResolvedValue(true)
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('renames definition, all table/index/comment references and row keys as one atomic command', () => {
    const f = fixture()
    const before = f.state()
    const unrelated = f.schemas[0]!.tables[1]!
    const untouchedDefinition = f.config().common_used_fields.flag
    const ordered = computed(() => f.actions.getOrderedCommonUsedFields().map(field => field.field_name))
    expect(f.actions.updateCommonUsedFieldName('id', ' renamed ')).toBe(true)
    expect(f.executeCommand).toHaveBeenCalledTimes(1)
    expect(f.executeCommand.mock.calls[0]![0].coalesceKey).toBeUndefined()
    expect(f.config().common_used_fields.id).toBeUndefined()
    expect(f.config().common_used_fields.renamed).toMatchObject({ field_name: 'renamed', unified_type: 'U' })
    expect(ordered.value).toEqual(['renamed', 'flag', 'note'])
    const table = f.schemas[0]!.tables[0]!
    expect(table.fields[0]!.field_name).toBe('renamed')
    expect(table.indexes.map(index => index.columns[0])).toEqual([{ name: 'renamed', mysql: { sort_order: 'DESC' } }, { name: 'renamed' }])
    expect(table.comment_before_fields).toEqual({ renamed: ['before', null, 'after'], local: 'untouched' })
    expect(f.schemas[1]!.tables[0]!.fields[0]!.field_name).toBe('renamed')
    expect(f.initialDataMap.get('public/users')!.rows).toEqual([
      { data: { renamed: { nested: ['value'] }, local: 1 }, field_comments: { renamed: 'id comment' }, expr_fields: { renamed: false }, row_comment: 'keep' },
      { data: { renamed: null, local: 2 }, field_comments: { renamed: 'second' }, expr_fields: { renamed: true }, is_skip: true },
    ])
    const files = [affectedCommon(), affectedSql(), affectedTable('public', 'users'), affectedInitialData('public', 'users'), affectedTable('audit', 'users')]
    expect(f.persist).toHaveBeenLastCalledWith(files)
    const after = f.state()
    for (let repeat = 0; repeat < 3; repeat++) {
      f.manager.undo()
      expect(f.state()).toEqual(before)
      expect(ordered.value).toEqual(['id', 'flag', 'note'])
      expect(f.manager.canUndo).toBe(false)
      expect(f.persist).toHaveBeenLastCalledWith(files)
      f.manager.redo()
      expect(f.state()).toEqual(after)
      expect(f.persist).toHaveBeenLastCalledWith(files)
    }
    expect(f.schemas[0]!.tables[1]).toBe(unrelated)
    expect(f.config().common_used_fields.flag).toBe(untouchedDefinition)
  })

  it('renames explicit field order and restores it exactly', () => {
    const f = fixture()
    f.config().common_used_field_order = ['flag', 'id', 'note']
    f.actions.updateCommonUsedFieldName('id', 'renamed')
    expect(f.config().common_used_field_order).toEqual(['flag', 'renamed', 'note'])
    f.manager.undo()
    expect(f.config().common_used_field_order).toEqual(['flag', 'id', 'note'])
  })

  it('rejects empty/duplicate names, missing definitions and table-name collisions without commands', () => {
    const f = fixture()
    const before = f.state()
    for (const name of ['', '  ', 'flag', ' id ', 'local']) expect(f.actions.updateCommonUsedFieldName('id', name)).toBe(false)
    expect(f.actions.updateCommonUsedFieldName('missing', 'renamed')).toBe(false)
    for (const name of ['', '  ', 'V', ' U ']) expect(f.actions.renameUnifiedType('U', name)).toBe(false)
    expect(f.actions.renameUnifiedType('missing', 'new')).toBe(false)
    for (const name of ['', '  ', ' id ']) expect(f.actions.addCommonUsedField(name)).toBe(false)
    for (const name of ['', '  ', ' U ']) expect(f.actions.addUnifiedType(name)).toBe(false)
    expect(f.state()).toEqual(before)
    expect(f.manager.canUndo).toBe(false)
    expect(f.persist).not.toHaveBeenCalled()
  })

  it('deletes referencing fields, empty indexes, comments and row keys; undo preserves nested data', async () => {
    const f = fixture()
    f.config().common_used_field_order = ['id', 'flag', 'note']
    const before = f.state()
    expect(await f.actions.deleteCommonUsedField('id')).toBe(true)
    expect(confirmDialog).toHaveBeenCalledTimes(1)
    expect(f.config().common_used_fields.id).toBeUndefined()
    expect(f.config().common_used_field_order).toEqual(['flag', 'note'])
    expect(f.schemas[0]!.tables[0]!.fields).toEqual([{ field_name: 'local', unified_type: 'V' }])
    expect(f.schemas[0]!.tables[0]!.indexes).toEqual([{ type: 'unique', columns: [{ name: 'local' }] }])
    expect(f.schemas[1]!.tables[0]!.indexes).toEqual([])
    expect(f.schemas[0]!.tables[0]!.comment_before_fields).toEqual({ renamed: 'orphan comment', local: 'untouched' })
    expect(f.initialDataMap.get('public/users')!.rows![1]).toEqual({ data: { local: 2 }, field_comments: {}, expr_fields: {}, is_skip: true })
    expect(f.schemas[0]!.tables[1]!.fields[0]!.field_name).toBe('id')
    expect(f.initialDataMap.get('public/unrelated')!.rows![0]!.data.id).toBe(4)
    const after = f.state()
    for (let repeat = 0; repeat < 3; repeat++) {
      f.manager.undo()
      expect(f.state()).toEqual(before)
      f.manager.redo()
      expect(f.state()).toEqual(after)
    }
    expect(f.persist).toHaveBeenLastCalledWith([affectedCommon(), affectedSql(), affectedTable('public', 'users'), affectedInitialData('public', 'users'), affectedTable('audit', 'users')])
    expect(f.executeCommand.mock.calls[0]![0].coalesceKey).toBeUndefined()
  })

  it('delete snapshots are detached from removed nested fields and indexes', async () => {
    const f = fixture()
    const oldDefinition = f.field()
    const oldField = f.schemas[0]!.tables[0]!.fields[0]!
    const oldIndex = f.schemas[0]!.tables[0]!.indexes[0]!
    await f.actions.deleteCommonUsedField('id')
    oldDefinition.comment_options![0]!.label = 'corrupt'
    oldField.mysql!.field_length = 999
    oldIndex.columns[0]!.mysql!.sort_order = 'ASC'
    f.manager.undo()
    expect(f.field().comment_options![0]!.label).toBe('old')
    expect(f.schemas[0]!.tables[0]!.fields[0]!.mysql!.field_length).toBe(10)
    expect(f.schemas[0]!.tables[0]!.indexes[0]!.columns[0]!.mysql!.sort_order).toBe('DESC')
  })

  it('cancellation and a project switch during confirmation do not mutate anything', async () => {
    const f = fixture()
    const before = f.state()
    vi.mocked(confirmDialog).mockResolvedValueOnce(false)
    expect(await f.actions.deleteCommonUsedField('id')).toBe(false)
    expect(f.state()).toEqual(before)
    let resolve!: (confirmed: boolean) => void
    vi.mocked(confirmDialog).mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done }))
    const pending = f.actions.deleteCommonUsedField('id')
    f.commonConfig.value = copy(f.config())
    resolve(true)
    expect(await pending).toBe(false)
    expect(f.persist).not.toHaveBeenCalled()
  })

  it('takes deletion snapshots after confirmation, not before the user edits', async () => {
    const f = fixture()
    let resolve!: (confirmed: boolean) => void
    vi.mocked(confirmDialog).mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done }))
    const pending = f.actions.deleteCommonUsedField('id')
    f.actions.updateCommonUsedField('id', { comment: 'while confirming' })
    resolve(true)
    await pending
    f.manager.undo()
    expect(f.field().comment).toBe('while confirming')
    f.manager.undo()
    expect(f.field().comment).toBe('')
  })

  it('common text updates coalesce only for the same identity and property, with complete final patches', () => {
    const f = fixture()
    f.actions.updateCommonUsedField('id', { comment: 'a', field_length: 5 }, true)
    f.actions.updateCommonUsedField('id', { comment: 'abc', field_length: 5 }, true)
    f.manager.undo()
    expect(f.field().comment).toBe('')
    expect(f.field().field_length).toBeUndefined()
    expect(f.manager.canUndo).toBe(false)
    f.manager.redo()
    expect(f.field()).toMatchObject({ comment: 'abc', field_length: 5 })
    f.actions.updateCommonUsedField('id', { field_type: 'TEXT' }, true)
    f.actions.updateCommonUsedField('flag', { field_type: 'INT' }, true)
    f.manager.undo()
    expect(f.config().common_used_fields.flag!.field_type).toBe('boolean')
    expect(f.field().field_type).toBe('TEXT')
    f.manager.undo()
    expect(f.field().field_type).toBe('bigint')
    expect(f.persist).toHaveBeenLastCalledWith([affectedCommon(), affectedSql()])
  })

  it('field snapshots are deep, detached from patch arguments and live values on replay', () => {
    const f = fixture()
    const oldOptions = f.field().comment_options!
    const patch = { comment_options: [{ label: 'new', value: '2', mysql: '3' }], default: { nested: ['new'] } }
    f.actions.updateCommonUsedField('id', patch)
    patch.comment_options[0]!.label = 'argument mutated'
    patch.default.nested.push('argument mutated')
    oldOptions[0]!.label = 'old alias mutated'
    f.field().comment_options![0]!.label = 'live mutated'
    f.manager.undo()
    expect(f.field().comment_options).toEqual([{ label: 'old', value: '1' }])
    f.manager.redo()
    expect(f.field().comment_options).toEqual([{ label: 'new', value: '2', mysql: '3' }])
    expect(f.field().default).toEqual({ nested: ['new'] })
    expect(f.actions.updateCommonUsedField('id', { field_name: 'bad' } as Partial<Field>)).toBe(false)
  })

  it('unified field selection atomically clears incompatible properties and retains metrics', () => {
    const f = fixture()
    f.field().quote_default = true
    f.field().field_length = 10
    const before = copy(f.field())
    f.actions.updateCommonUsedField('id', { unified_type: 'V' })
    expect(f.field().field_type).toBeUndefined()
    expect(f.field().quote_default).toBeUndefined()
    expect(f.field().field_length).toBe(10)
    f.manager.undo()
    expect(f.field()).toEqual(before)
    expect(f.manager.canUndo).toBe(false)
    f.manager.redo()
    expect(f.field().unified_type).toBe('V')
  })

  it('common overrides own common.json, distinguish field/dialect/property and restore absence', () => {
    const f = fixture()
    f.actions.setCommonUsedFieldOverrideValue('id', 'sqlite', 'field_length', '1')
    f.actions.setCommonUsedFieldOverrideValue('id', 'sqlite', 'field_length', '12')
    f.manager.undo()
    expect(f.field()).not.toHaveProperty('sqlite')
    expect(f.manager.canUndo).toBe(false)
    f.manager.redo()
    expect(f.field().sqlite).toEqual({ field_length: 12 })
    f.actions.setCommonUsedFieldOverrideValue('id', 'sqlite', 'field_scale', '2')
    f.actions.setCommonUsedFieldOverrideValue('id', 'mysql', 'field_scale', '3')
    f.actions.setCommonUsedFieldOverrideValue('flag', 'mysql', 'field_scale', '4')
    f.manager.undo()
    expect(f.config().common_used_fields.flag!.mysql).toBeUndefined()
    f.manager.undo()
    expect(f.field().mysql).toEqual({ field_type: 'BIGINT' })
    f.manager.undo()
    expect(f.field().sqlite).toEqual({ field_length: 12 })
    f.actions.setCommonUsedFieldOverrideValue('id', 'sqlite', 'field_length', '')
    expect(f.field().sqlite).toBeUndefined()
    f.manager.undo()
    expect(f.field().sqlite).toEqual({ field_length: 12 })
    expect(f.persist.mock.calls.every(([files]) => JSON.stringify(files) === JSON.stringify([affectedCommon(), affectedSql()]))).toBe(true)
  })

  it('field order moves and adds/deletes are independent commands with legacy order restored', async () => {
    const f = fixture()
    const names = () => f.actions.getOrderedCommonUsedFields().map(field => field.field_name)
    f.actions.moveCommonUsedField(0, 2)
    f.actions.moveCommonUsedField(0, 1)
    expect(names()).toEqual(['note', 'flag', 'id'])
    f.manager.undo()
    expect(names()).toEqual(['flag', 'note', 'id'])
    f.manager.undo()
    expect(names()).toEqual(['id', 'flag', 'note'])
    expect(f.config()).not.toHaveProperty('common_used_field_order')
    f.manager.redo()
    f.manager.redo()
    f.actions.addCommonUsedField(' added ')
    expect(names()).toEqual(['note', 'flag', 'id', 'added'])
    await f.actions.deleteCommonUsedField('added')
    f.manager.undo()
    expect(names()).toEqual(['note', 'flag', 'id', 'added'])
    f.manager.undo()
    expect(names()).toEqual(['note', 'flag', 'id'])
    expect(f.executeCommand.mock.calls.every(([command]) => command.coalesceKey === undefined)).toBe(true)
    for (const [from, to] of [[-1, 1], [0, 5], [1, 1], [0.5, 1]]) expect(f.actions.moveCommonUsedField(from!, to!)).toBe(false)
  })

  it('unified rename includes definition, common references, both schemas and no unnecessary initial data', () => {
    const f = fixture()
    const before = f.state()
    expect(f.actions.renameUnifiedType('U', ' Renamed ')).toBe(true)
    expect(f.config().unified_types![0]!.name).toBe('Renamed')
    expect(f.field().unified_type).toBe('Renamed')
    expect(f.schemas[0]!.tables[0]!.fields[0]!.unified_type).toBe('Renamed')
    expect(f.schemas[1]!.tables[0]!.fields[1]!.unified_type).toBe('Renamed')
    expect(f.schemas[0]!.tables[0]!.fields[1]!.unified_type).toBe('V')
    expect(f.executeCommand).toHaveBeenCalledTimes(1)
    const files = [affectedCommon(), affectedSql(), affectedTable('public', 'users'), affectedTable('audit', 'users')]
    expect(f.persist).toHaveBeenLastCalledWith(files)
    const after = f.state()
    for (let repeat = 0; repeat < 2; repeat++) {
      f.manager.undo()
      expect(f.state()).toEqual(before)
      expect(f.manager.canUndo).toBe(false)
      f.manager.redo()
      expect(f.state()).toEqual(after)
      expect(f.persist).toHaveBeenLastCalledWith(files)
    }
  })

  it('definition updates remain undoable after later rename and delete restore new objects', async () => {
    const f = fixture()
    const before = f.state()
    f.actions.updateCommonUsedField('id', { comment: 'edited' }, true)
    f.actions.updateCommonUsedFieldName('id', 'renamed')
    await f.actions.deleteCommonUsedField('renamed')
    f.manager.undo()
    f.manager.undo()
    f.manager.undo()
    expect(f.state()).toEqual(before)
    f.manager.redo()
    expect(f.field().comment).toBe('edited')
    f.manager.redo()
    expect(f.config().common_used_fields.renamed!.comment).toBe('edited')
  })

  it('unified properties and mappings use separate identity/property keys and detached snapshots', () => {
    const f = fixture()
    f.actions.updateUnifiedType('U', { description: 'a' }, true)
    f.actions.updateUnifiedType('U', { description: 'abc' }, true)
    f.manager.undo()
    expect(f.type().description).toBe('')
    expect(f.manager.canUndo).toBe(false)
    f.manager.redo()
    expect(f.type().description).toBe('abc')
    f.actions.updateUnifiedType('V', { description: 'V description' }, true)
    f.manager.undo()
    expect(f.config().unified_types![1]!.description).toBe('')
    const oldMapping = f.type().mysql
    f.actions.setUnifiedTypeMappingValue('U', 'mysql', 'type', 'B')
    f.actions.setUnifiedTypeMappingValue('U', 'mysql', 'type', 'BIGINT')
    oldMapping.length = 999
    f.manager.undo()
    expect(f.type().mysql).toEqual({ type: 'VARCHAR', length: 32 })
    f.manager.redo()
    expect(f.type().mysql).toEqual({ type: 'BIGINT', length: 32 })
    f.actions.setUnifiedTypeMappingValue('U', 'mysql', 'length', '20')
    f.actions.setUnifiedTypeMappingValue('U', 'postgresql', 'length', '10')
    f.actions.setUnifiedTypeMappingValue('V', 'postgresql', 'length', '30')
    f.manager.undo()
    f.manager.undo()
    expect(f.type().postgresql.length).toBeUndefined()
    expect(f.type().mysql.length).toBe(20)
    f.manager.undo()
    expect(f.type().mysql.length).toBe(32)
    expect(f.persist).toHaveBeenLastCalledWith([affectedCommon(), affectedSql()])
  })

  it('optional SQLite type mapping creation/clear, boolean and input mode are reversible', () => {
    const f = fixture()
    f.actions.setUnifiedTypeMappingValue('U', 'sqlite', 'type', 'T')
    f.actions.setUnifiedTypeMappingValue('U', 'sqlite', 'type', 'TEXT')
    f.manager.undo()
    expect(f.type()).not.toHaveProperty('sqlite')
    f.manager.redo()
    expect(f.type().sqlite).toEqual({ type: 'TEXT' })
    f.actions.setUnifiedTypeMappingValue('U', 'sqlite', 'scale', '2')
    f.actions.setUnifiedTypeMappingValue('U', 'sqlite', 'type', '')
    expect(f.type().sqlite).toEqual({ type: '', scale: 2 })
    f.actions.setUnifiedTypeMappingValue('U', 'sqlite', 'scale', '')
    expect(f.type()).not.toHaveProperty('sqlite')
    f.manager.undo()
    expect(f.type().sqlite).toEqual({ type: '', scale: 2 })
    f.actions.updateUnifiedType('U', { quote_default: true })
    f.actions.updateUnifiedType('U', { default_input: 'boolean' })
    f.manager.undo()
    expect(f.type().default_input).toBeUndefined()
    expect(f.type().quote_default).toBe(true)
    f.manager.undo()
    expect(f.type().quote_default).toBeUndefined()
  })

  it('type add does not initialize outside apply; delete restores nested mappings without clearing references', () => {
    const f = fixture()
    delete f.config().unified_types
    f.executeCommand.mockImplementationOnce(command => {
      expect(f.config()).not.toHaveProperty('unified_types')
      f.manager.execute(command)
    })
    f.actions.addUnifiedType('U')
    f.manager.undo()
    expect(f.config()).not.toHaveProperty('unified_types')
    f.manager.redo()
    const oldType = f.type()
    f.actions.deleteUnifiedType(0)
    oldType.mysql.type = 'corrupt'
    expect(f.field().unified_type).toBe('U')
    expect(f.schemas[0]!.tables[0]!.fields[0]!.unified_type).toBe('U')
    f.manager.undo()
    expect(f.type().mysql.type).toBe('VARCHAR')
    f.manager.undo()
    expect(f.config().unified_types).toBeUndefined()
    expect(f.executeCommand.mock.calls.every(([command]) => command.coalesceKey === undefined)).toBe(true)
  })

  it('type sorting does not rename references and is independent of edits/add/delete', () => {
    const f = fixture()
    const names = () => f.config().unified_types!.map(type => type.name)
    f.actions.moveUnifiedType(0, 2)
    f.actions.moveUnifiedType(0, 1)
    expect(names()).toEqual(['W', 'V', 'U'])
    expect(f.field().unified_type).toBe('U')
    f.manager.undo()
    expect(names()).toEqual(['V', 'W', 'U'])
    f.manager.undo()
    expect(names()).toEqual(['U', 'V', 'W'])
    f.manager.redo()
    f.manager.redo()
    f.actions.updateUnifiedType('U', { description: 'after sorting' }, true)
    f.actions.renameUnifiedType('U', 'Renamed')
    f.actions.deleteUnifiedType(2)
    f.manager.undo()
    f.manager.undo()
    f.manager.undo()
    expect(f.type().description).toBe('')
    expect(names()).toEqual(['W', 'V', 'U'])
    for (const [from, to] of [[-1, 1], [0, 5], [1, 1]]) expect(f.actions.moveUnifiedType(from!, to!)).toBe(false)
  })

  it('global SQL coalescing restores exact optional dialect presence and final state', () => {
    const f = fixture()
    const before = copy(f.config().default_config)
    f.actions.setGlobalPreSql('sqlite', ' A ')
    f.actions.setGlobalPreSql('sqlite', ' ABC ')
    f.manager.undo()
    expect(f.config().default_config).toEqual(before)
    expect(f.manager.canUndo).toBe(false)
    f.manager.redo()
    expect(f.config().default_config.sqlite).toEqual({ quote_identifiers: true, pre_sql: 'ABC' })
    f.actions.setGlobalPostSql('sqlite', 'POST')
    f.actions.setGlobalPreSql('mysql', 'MYSQL')
    f.manager.undo()
    expect(f.config().default_config.mysql.pre_sql).toBeUndefined()
    expect(f.config().default_config.sqlite!.post_sql).toBe('POST')
    f.manager.undo()
    expect(f.config().default_config.sqlite!.post_sql).toBeUndefined()
    expect(f.persist).toHaveBeenLastCalledWith([affectedCommon(), affectedSql()])
  })

  it('logical-delete patches replay terminal state and use property-specific coalescing keys', () => {
    const f = fixture()
    const patch = { field: 'a', predicate: 'id > 0' }
    f.actions.setLogicalDelete(patch)
    patch.field = 'mutated argument'
    f.actions.setLogicalDelete({ field: 'abc', predicate: 'id > 0' })
    f.manager.undo()
    expect(f.config()).not.toHaveProperty('logical_delete')
    expect(f.manager.canUndo).toBe(false)
    f.manager.redo()
    expect(f.config().logical_delete).toEqual({ field: 'abc', predicate: 'id > 0' })
    f.actions.setLogicalDelete({ enabled: true })
    f.manager.undo()
    expect(f.config().logical_delete).toEqual({ field: 'abc', predicate: 'id > 0' })
    f.actions.setLogicalDelete({ field: '', predicate: undefined })
    expect(f.config()).not.toHaveProperty('logical_delete')
    f.manager.undo()
    expect(f.config().logical_delete).toEqual({ field: 'abc', predicate: 'id > 0' })
  })

  it('remaining setters restore raw optional values, never mark unrelated tables', () => {
    const f = fixture()
    const before = f.state()
    f.actions.setProjectName('a')
    f.actions.setProjectName('abc')
    expect(f.persist).toHaveBeenLastCalledWith([affectedCommon()])
    f.actions.setProjectDescription('description')
    f.actions.setCommonMysqlEngine('MyISAM')
    f.actions.setCommonMysqlCharset('utf8')
    f.actions.setCommonMysqlCollation('utf8_general_ci')
    f.actions.setCommonPostgresqlQuoteIdentifiers(false)
    f.actions.setCommonSqliteQuoteIdentifiers(false)
    f.actions.setTableDdlMode('create')
    f.actions.setCommonTypeCase('uppercase')
    expect(f.actions.getGlobalInitialDataInsertMode()).toBe('insert')
    f.actions.setGlobalInitialDataInsertMode('overwrite')
    const after = f.state()
    while (f.manager.canUndo) f.manager.undo()
    expect(f.state()).toEqual(before)
    expect(f.config()).not.toHaveProperty('type_case')
    expect(f.config()).not.toHaveProperty('initial_data_insert_mode')
    expect(f.config().default_config).not.toHaveProperty('sqlite')
    expect(f.config().default_config).not.toHaveProperty('table_ddl_mode')
    while (f.manager.canRedo) f.manager.redo()
    expect(f.state()).toEqual(after)
    expect(f.persist.mock.calls.every(([files]) => files.every(file => file.kind === 'common' || file.kind === 'sql'))).toBe(true)
  })

  it.each([['CommonUsedFieldsPanel.vue', commonFieldsPanel], ['UnifiedTypesPanel.vue', unifiedTypesPanel]])('%s binds persisted values without shared mutations or rebuild actions', (_filename, source) => {
    expect(source).not.toMatch(/v-model(?:\.[\w]+)*="(?:field|ut)\./)
    expect(source).not.toMatch(/\b(?:field|ut)\.[\w.]+\s*=(?!=)/)
    expect(source).not.toMatch(/rebuildCommonUsedFieldsFromArray|rebuildUnifiedTypesFromArray|syncUnifiedTypes/)
    expect(source).not.toContain('store.setFieldOverrideValue(')
    expect(source).not.toMatch(/local(?:Fields|UnifiedTypes)\.value\.(?:push|splice)/)
  })
})
