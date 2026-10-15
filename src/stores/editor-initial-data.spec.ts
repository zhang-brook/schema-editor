import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, reactive, ref, toRaw, watch, nextTick } from 'vue'
import type { InitialData, InitialDataRow, Schema } from '@/types/schema'
import { CommandManager, affectedInitialData, affectedSql, type Command } from '@/core/history/command'
import { parseDefaultInput } from '@/utils/file-helpers'
import { buildInitialDataExport } from '@/utils/initial-data-io'
import { createInitialDataActions } from './editor-initial-data'

function setup(data?: InitialData) {
  const schemas = reactive<Schema[]>([
    { schema: 'public', tables: [{ name: 'users', comment: '', fields: [], indexes: [] }, { name: 'other', comment: '', fields: [], indexes: [] }] },
    { schema: 'other', tables: [{ name: 'users', comment: '', fields: [], indexes: [] }] },
  ])
  const schemaIndex = ref(0)
  const tableIndex = ref(0)
  const currentSchema = computed(() => schemas[schemaIndex.value])
  const currentTable = computed(() => currentSchema.value?.tables[tableIndex.value])
  const initialDataMap = reactive(new Map<string, InitialData>())
  if (data) initialDataMap.set('public/users', data)
  const initialDataDeletedKeys = reactive(new Set<string>())
  const manager = new CommandManager()
  const persist = vi.fn()
  manager.setPersistHook(persist)
  const executeCommand = vi.fn((command: Command) => manager.execute(command))
  const actions = createInitialDataActions({
    schemas, currentSchema, currentTable, initialDataMap, initialDataDeletedKeys, executeCommand,
    t: key => key,
  })
  return { ...actions, manager, persist, executeCommand, initialDataMap, initialDataDeletedKeys, schemaIndex, tableIndex }
}

const expectedFiles = [affectedInitialData('public', 'users'), affectedSql()]
const richRow = (): InitialDataRow => ({
  data: { id: 0, enabled: false, value: null, missing: undefined, time: 'CURRENT_TIMESTAMP()', nested: { items: [0, false, null] } },
  field_comments: { id: 'identifier', time: 'expression' },
  expr_fields: { time: true, id: false },
  row_comment: 'row',
  is_skip: false,
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
})
afterEach(() => vi.useRealTimers())

describe('initial data entry commands', () => {
  it('getters and table/schema switching never create data or history', () => {
    const s = setup()
    expect(s.currentInitialDataKey.value).toBe('public/users')
    expect(s.currentInitialData.value).toBeUndefined()
    s.tableIndex.value = 1
    expect(s.currentInitialData.value).toBeUndefined()
    s.schemaIndex.value = 1
    s.tableIndex.value = 0
    expect(s.currentInitialDataKey.value).toBe('other/users')
    s.schemaIndex.value = -1
    expect(s.currentInitialDataKey.value).toBeNull()
    expect(s.currentInitialData.value).toBeUndefined()
    expect(s.initialDataMap.size).toBe(0)
    expect(s.executeCommand).not.toHaveBeenCalled()
  })

  it('explicit initialization atomically creates {}, restores tombstones, and does not merge', () => {
    const s = setup()
    s.initialDataDeletedKeys.add('public/users')
    s.addInitialData('public', 'users')
    expect(s.currentInitialData.value).toStrictEqual({})
    expect(s.initialDataDeletedKeys.has('public/users')).toBe(false)
    s.addInitialData('public', 'users')
    expect(s.executeCommand).toHaveBeenCalledTimes(1)
    expect(s.executeCommand.mock.calls[0]![0].coalesceKey).toBeUndefined()
    s.manager.undo()
    expect(s.currentInitialData.value).toBeUndefined()
    expect(s.initialDataDeletedKeys.has('public/users')).toBe(true)
    s.manager.redo()
    expect(s.currentInitialData.value).toStrictEqual({})
    expect(s.persist.mock.calls.map(call => call[0])).toEqual([expectedFiles, expectedFiles, expectedFiles])
  })

  it('JSON replacement snapshots both inputs deeply and restores identities used by older row commands', () => {
    const old = { rows: [richRow()], pre_sql: { mysql: 'before' } }
    const s = setup(old)
    const row = s.currentInitialData.value!.rows![0]!
    s.setInitialDataCell('public', 'users', row, 'id', 7)
    const input = { rows: [{ data: { id: 100, nested: { flag: false } } }], post_sql: { sqlite: 'after' } }
    s.setInitialDataObject('public', 'users', input)
    input.rows[0]!.data.nested.flag = true
    input.post_sql.sqlite = 'caller mutation'
    old.rows[0]!.data.nested.items.push(99)
    const replaced = s.currentInitialData.value!
    expect(replaced.rows![0]!.data.nested.flag).toBe(false)
    s.manager.undo()
    expect(toRaw(s.currentInitialData.value!.rows![0]!)).toBe(toRaw(row))
    expect(row.data.id).toBe(7)
    expect(row.data.nested.items).toEqual([0, false, null])
    s.manager.undo()
    expect(row.data.id).toBe(0)
    s.manager.redo()
    expect(row.data.id).toBe(7)
    replaced.rows![0]!.data.id = -1
    replaced.post_sql!.sqlite = 'detached mutation'
    s.manager.redo()
    expect(s.currentInitialData.value).toStrictEqual({ rows: [{ data: { id: 100, nested: { flag: false } } }], post_sql: { sqlite: 'after' } })
    expect(s.executeCommand.mock.calls[1]![0].coalesceKey).toBeUndefined()
  })

  it.each([{}, { rows: [] }])('JSON empty input %j retains the established deletion convention', empty => {
    const s = setup({ rows: [richRow()] })
    s.setInitialDataObject('public', 'users', empty)
    expect(s.currentInitialData.value).toBeUndefined()
    expect(s.initialDataDeletedKeys.has('public/users')).toBe(true)
    s.manager.undo()
    expect(s.currentInitialData.value).toStrictEqual({ rows: [richRow()] })
    s.manager.redo()
    expect(s.currentInitialData.value).toBeUndefined()
  })

  it('explicit delete snapshots the data and preserves empty optional properties on undo', () => {
    const data: InitialData = { rows: [], pre_sql: {} }
    const s = setup(data)
    s.deleteInitialData('public', 'users')
    data.rows!.push(richRow())
    s.manager.undo()
    expect(s.currentInitialData.value).toStrictEqual({ rows: [], pre_sql: {} })
    s.manager.redo()
    expect(s.currentInitialData.value).toBeUndefined()
    expect(s.persist).toHaveBeenLastCalledWith(expectedFiles)
  })
})

describe('initial data row property commands', () => {
  it.each(['0', 'false', '-1.5', 'CURRENT_TIMESTAMP()', ''])('cell default input %j survives undo/redo without a spurious own key', input => {
    const s = setup({ rows: [{ data: {} }] })
    const row = s.currentInitialData.value!.rows![0]!
    s.setInitialDataCell('public', 'users', row, 'value', parseDefaultInput(input))
    if (!input) {
      expect(s.executeCommand).not.toHaveBeenCalled()
      return
    }
    expect(row.data.value).toBe(parseDefaultInput(input))
    s.manager.undo()
    expect(Object.hasOwn(row.data, 'value')).toBe(false)
    s.manager.redo()
    expect(row.data.value).toBe(parseDefaultInput(input))
    expect(s.persist.mock.calls.map(call => call[0])).toEqual([expectedFiles, expectedFiles, expectedFiles])
  })

  it.each([undefined, null, 0, false, ''])('clearing an existing value %j deletes it and restores exact presence on undo', initial => {
    const s = setup({ rows: [{ data: { value: initial } }] })
    const row = s.currentInitialData.value!.rows![0]!
    s.setInitialDataCell('public', 'users', row, 'value', undefined)
    expect(Object.hasOwn(row.data, 'value')).toBe(false)
    s.manager.undo()
    expect(Object.hasOwn(row.data, 'value')).toBe(true)
    expect(row.data.value).toBe(initial)
    s.manager.redo()
    expect(Object.hasOwn(row.data, 'value')).toBe(false)
  })

  it('coalesces only the same row/field, retains final snapshots, and separates other tables/schemas', () => {
    const s = setup({ rows: [{ data: {} }, { data: {} }] })
    const [a, b] = s.currentInitialData.value!.rows!
    s.setInitialDataCell('public', 'users', a!, 'name', 'a')
    s.setInitialDataCell('public', 'users', a!, 'name', 'ab')
    s.setInitialDataCell('public', 'users', b!, 'name', 'b')
    s.manager.undo()
    expect(b!.data).toStrictEqual({})
    expect(a!.data.name).toBe('ab')
    s.manager.undo()
    expect(a!.data).toStrictEqual({})
    expect(s.manager.canUndo).toBe(false)
    s.manager.redo()
    expect(a!.data.name).toBe('ab')
    s.manager.redo()
    s.setInitialDataCell('public', 'users', b!, 'id', 0)
    s.initialDataMap.set('public/other', { rows: [{ data: {} }] })
    s.initialDataMap.set('other/users', { rows: [{ data: {} }] })
    s.setInitialDataCell('public', 'other', s.initialDataMap.get('public/other')!.rows![0]!, 'id', 0)
    s.setInitialDataCell('other', 'users', s.initialDataMap.get('other/users')!.rows![0]!, 'id', 0)
    const keys = s.executeCommand.mock.calls.map(([cmd]) => cmd.coalesceKey)
    expect(keys[0]).toBe(keys[1])
    expect(new Set(keys.slice(1)).size).toBe(keys.length - 1)
  })

  it('cell object input is isolated on apply and redo, including nested null/false/0', () => {
    const s = setup({ rows: [{ data: {} }] })
    const row = s.currentInitialData.value!.rows![0]!
    const input = { values: [0, false, null] }
    s.setInitialDataCell('public', 'users', row, 'object', input)
    input.values.push(9)
    expect(row.data.object.values).toEqual([0, false, null])
    row.data.object.values.push(8)
    s.manager.undo()
    s.manager.redo()
    expect(row.data.object.values).toEqual([0, false, null])
  })

  it.each(['field_comments', 'expr_fields', 'row_comment', 'is_skip'] as const)('undo restores absent/empty/false %s exactly', property => {
    for (const explicit of [false, true]) {
      const row: InitialDataRow = { data: { id: 0, enabled: false, value: null } }
      if (explicit) Object.assign(row, { [property]: property === 'is_skip' ? false : property === 'row_comment' ? '' : {} })
      const before = structuredClone(row)
      const s = setup({ rows: [row] })
      const current = s.currentInitialData.value!.rows![0]!
      if (property === 'field_comments') s.setInitialDataFieldComment('public', 'users', current, 'id', '  comment  ')
      if (property === 'expr_fields') s.setInitialDataCellExpr('public', 'users', current, 'id', true)
      if (property === 'row_comment') s.setInitialDataRowComment('public', 'users', current, '  row  ')
      if (property === 'is_skip') s.setInitialDataRowSkip('public', 'users', current, true)
      const after = structuredClone(toRaw(current))
      s.manager.undo()
      expect(current).toStrictEqual(before)
      s.manager.redo()
      expect(current).toStrictEqual(after)
      expect(s.persist).toHaveBeenLastCalledWith(expectedFiles)
    }
  })

  it('trims and clears comments/expressions/skip without losing siblings or data', () => {
    const s = setup({ rows: [richRow()] })
    const row = s.currentInitialData.value!.rows![0]!
    s.setInitialDataFieldComment('public', 'users', row, 'id', '  ')
    expect(row.field_comments).toStrictEqual({ time: 'expression' })
    s.setInitialDataFieldComment('public', 'users', row, 'time', '')
    expect(Object.hasOwn(row, 'field_comments')).toBe(false)
    s.setInitialDataCellExpr('public', 'users', row, 'time', false)
    s.setInitialDataCellExpr('public', 'users', row, 'id', false)
    expect(Object.hasOwn(row, 'expr_fields')).toBe(false)
    s.setInitialDataRowComment('public', 'users', row, '')
    s.setInitialDataRowSkip('public', 'users', row, false)
    expect(row).toStrictEqual({ data: richRow().data })
    while (s.manager.canUndo) s.manager.undo()
    expect(row).toStrictEqual(richRow())
    while (s.manager.canRedo) s.manager.redo()
    expect(row).toStrictEqual({ data: richRow().data })
  })

  it('coalesces comments by stable row plus field, not row index', () => {
    const s = setup({ rows: [{ data: {} }, { data: {} }] })
    const [a, b] = s.currentInitialData.value!.rows!
    s.setInitialDataRowComment('public', 'users', a!, 'a')
    s.setInitialDataRowComment('public', 'users', a!, 'ab')
    s.setInitialDataRowComment('public', 'users', b!, 'b')
    s.setInitialDataFieldComment('public', 'users', b!, 'x', 'x')
    s.setInitialDataFieldComment('public', 'users', b!, 'x', 'xx')
    s.setInitialDataFieldComment('public', 'users', b!, 'y', 'y')
    const keys = s.executeCommand.mock.calls.map(([cmd]) => cmd.coalesceKey)
    expect(keys[0]).toBe(keys[1])
    expect(keys[3]).toBe(keys[4])
    expect(new Set([keys[0], keys[2], keys[3], keys[5]]).size).toBe(4)
    s.moveInitialDataRow('public', 'users', 1, 0)
    s.setInitialDataFieldComment('public', 'users', b!, 'x', 'xxx')
    expect(s.executeCommand.mock.lastCall![0].coalesceKey).toBe(keys[3])
    expect(s.currentInitialData.value!.rows![0]).toBe(b)
  })

  it('reactive row changes notify consumers and reject detached/foreign rows', async () => {
    const s = setup({ rows: [{ data: {} }] })
    const row = s.currentInitialData.value!.rows![0]!
    const listener = vi.fn()
    const stop = watch(() => row.data, listener)
    s.setInitialDataCell('public', 'users', row, 'x', null)
    await nextTick()
    expect(listener).toHaveBeenCalledTimes(1)
    s.setInitialDataCell('public', 'other', row, 'x', 1)
    expect(s.executeCommand).toHaveBeenCalledTimes(1)
    stop()
  })
})

describe('initial data structural and SQL commands', () => {
  it('add/delete/move/clear rows are separate commands and preserve data, identity, SQL and undo order', () => {
    const s = setup({ rows: [richRow()], pre_sql: { mysql: 'before' }, post_sql: { sqlite: 'after' } })
    const original = s.currentInitialData.value!.rows![0]!
    s.setInitialDataCell('public', 'users', original, 'id', 5)
    const input = { data: { id: 2, value: { a: false } }, row_comment: 'new' }
    s.addInitialDataRow('public', 'users', input)
    input.data.value.a = true
    s.addInitialDataRow('public', 'users')
    s.moveInitialDataRow('public', 'users', 0, 2)
    expect(s.currentInitialData.value!.rows!.map(row => row.data.id)).toEqual([2, undefined, 5])
    expect(s.currentInitialData.value!.rows![2]).toBe(original)
    s.deleteInitialDataRow('public', 'users', 1)
    s.clearInitialDataRows('public', 'users')
    expect(s.currentInitialData.value).toStrictEqual({ pre_sql: { mysql: 'before' }, post_sql: { sqlite: 'after' } })
    expect(s.executeCommand.mock.calls.slice(1).every(([cmd]) => cmd.coalesceKey === undefined)).toBe(true)
    s.manager.undo()
    expect(s.currentInitialData.value!.rows![0]!.data.value).toEqual({ a: false })
    s.manager.undo()
    s.manager.undo()
    expect(s.currentInitialData.value!.rows![0]).toBe(original)
    s.manager.undo()
    s.manager.undo()
    s.manager.undo()
    expect(s.currentInitialData.value!.rows).toStrictEqual([richRow()])
    while (s.manager.canRedo) s.manager.redo()
    expect(Object.hasOwn(s.currentInitialData.value!, 'rows')).toBe(false)
    expect(s.persist.mock.calls.every(([files]) => JSON.stringify(files) === JSON.stringify(expectedFiles))).toBe(true)
  })

  it('adding first row is atomic; deleting last row/clear leave {}, not a tombstone; [] is restored', () => {
    const s = setup()
    s.addInitialDataRow('public', 'users')
    expect(s.currentInitialData.value).toStrictEqual({ rows: [{ data: {} }] })
    s.manager.undo()
    expect(s.currentInitialData.value).toBeUndefined()
    s.manager.redo()
    s.deleteInitialDataRow('public', 'users', 0)
    expect(s.currentInitialData.value).toStrictEqual({})
    expect(s.initialDataDeletedKeys.size).toBe(0)
    const empty = setup({ rows: [] })
    empty.clearInitialDataRows('public', 'users')
    expect(buildInitialDataExport(empty.currentInitialData.value!)).toStrictEqual({})
    empty.manager.undo()
    expect(buildInitialDataExport(empty.currentInitialData.value!)).toStrictEqual({ rows: [] })
  })

  it('invalid row positions and clearing an unconfigured entry are no-ops', () => {
    const s = setup({ rows: [{ data: {} }] })
    for (const index of [-1, 1, 0.5, NaN]) {
      s.deleteInitialDataRow('public', 'users', index)
      s.moveInitialDataRow('public', 'users', 0, index)
      s.moveInitialDataRow('public', 'users', index, 0)
    }
    s.moveInitialDataRow('public', 'users', 0, 0)
    s.clearInitialDataRows('public', 'other')
    expect(s.executeCommand).not.toHaveBeenCalled()
  })

  it.each(['setInitialDataPreSql', 'setInitialDataPostSql'] as const)('%s creates an entry atomically, coalesces and replays final SQL', action => {
    const s = setup()
    s.initialDataDeletedKeys.add('public/users')
    s[action]('public', 'users', 'mysql', '  ')
    expect(s.executeCommand).not.toHaveBeenCalled()
    s[action]('public', 'users', 'mysql', '  SELECT 1  ')
    s[action]('public', 'users', 'mysql', ' SELECT 12 ')
    const property = action === 'setInitialDataPreSql' ? 'pre_sql' : 'post_sql'
    expect(s.currentInitialData.value).toStrictEqual({ [property]: { mysql: 'SELECT 12' } })
    s.manager.undo()
    expect(s.currentInitialData.value).toBeUndefined()
    expect(s.initialDataDeletedKeys.has('public/users')).toBe(true)
    expect(s.manager.canUndo).toBe(false)
    s.manager.redo()
    expect(s.currentInitialData.value).toStrictEqual({ [property]: { mysql: 'SELECT 12' } })
    expect(s.persist).toHaveBeenLastCalledWith(expectedFiles)
  })

  it('SQL coalescing separates schema/table, pre/post and dialect; clearing all is one command', () => {
    const s = setup({ rows: [richRow()] })
    s.setInitialDataPreSql('public', 'users', 'mysql', 'one')
    s.setInitialDataPreSql('public', 'users', 'postgresql', 'two')
    s.setInitialDataPostSql('public', 'users', 'sqlite', 'three')
    s.setInitialDataPostSql('public', 'other', 'sqlite', 'four')
    s.setInitialDataPostSql('other', 'users', 'sqlite', 'five')
    expect(new Set(s.executeCommand.mock.calls.map(([cmd]) => cmd.coalesceKey)).size).toBe(5)
    s.setInitialDataPreSql('public', 'users', 'mysql', '')
    expect(s.currentInitialData.value!.pre_sql).toEqual({ postgresql: 'two' })
    s.clearInitialDataPrePostSql('public', 'users')
    expect(s.currentInitialData.value).toStrictEqual({ rows: [richRow()] })
    expect(s.executeCommand.mock.lastCall![0].coalesceKey).toBeUndefined()
    s.manager.undo()
    expect(s.currentInitialData.value!.pre_sql).toEqual({ postgresql: 'two' })
    expect(s.currentInitialData.value!.post_sql).toEqual({ sqlite: 'three' })
    s.manager.redo()
    expect(s.currentInitialData.value).toStrictEqual({ rows: [richRow()] })
  })

  it('clearing last SQL keeps initialized {}, undo restores an explicit empty map', () => {
    const s = setup({ pre_sql: {} })
    s.setInitialDataPreSql('public', 'users', 'mysql', 'one')
    s.manager.undo()
    expect(s.currentInitialData.value).toStrictEqual({ pre_sql: {} })
    s.manager.redo()
    s.setInitialDataPreSql('public', 'users', 'mysql', '')
    expect(s.currentInitialData.value).toStrictEqual({})
    s.manager.undo()
    expect(s.currentInitialData.value).toStrictEqual({ pre_sql: { mysql: 'one' } })
  })
})
