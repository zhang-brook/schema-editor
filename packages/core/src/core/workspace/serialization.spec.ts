import { describe, expect, it } from 'vitest'
import type {
  CommonConfig,
  Field,
  FieldOverride,
  Index,
  IndexColumn,
  InitialData,
  InitialDataRow,
  Schema,
  Table,
} from '../../types/schema'
import { buildInitialDataExport, normalizeInitialData } from '../../utils/initial-data-io'
import {
  buildCommonWriteData,
  buildSchemaExportData,
  buildSchemaWriteData,
  buildTableExportData,
} from './serialization'

function table(fields: Field[] = [], indexes: Index[] = []): Table {
  return { name: 'events', comment: '', fields, indexes }
}

function exportField(input: Partial<Field>): Field {
  return buildTableExportData(table([{ field_name: 'value', ...input }])).fields[0]!
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value)) freeze(child)
  }
  return value
}

function json<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// List every declared field explicitly: when the type gains a property, tests must declare its serialization expectation too.
type PropertyCases<T> = { [K in keyof Required<T>]: { input: Partial<T>; expected: Partial<T> } }

const fieldCases: PropertyCases<Field> = {
  field_name: { input: { field_name: 'renamed' }, expected: { field_name: 'renamed' } },
  use_common_used_fields: { input: { use_common_used_fields: true }, expected: { use_common_used_fields: true } },
  unified_type: { input: { unified_type: 'timestamp' }, expected: { unified_type: 'timestamp' } },
  field_type: { input: { field_type: 'decimal' }, expected: { field_type: 'decimal' } },
  field_length: { input: { field_length: 10 }, expected: { field_length: 10 } },
  field_scale: { input: { field_scale: 2 }, expected: { field_scale: 2 } },
  field_length_disabled: { input: { field_length_disabled: true }, expected: { field_length_disabled: true } },
  field_scale_disabled: { input: { field_scale_disabled: true }, expected: { field_scale_disabled: true } },
  not_null: { input: { not_null: true }, expected: { not_null: true } },
  primary_key: { input: { primary_key: true }, expected: { primary_key: true } },
  quote_default: { input: { quote_default: true }, expected: { quote_default: true } },
  default: { input: { default: 'CURRENT_TIMESTAMP' }, expected: { default: 'CURRENT_TIMESTAMP' } },
  on_update_current_timestamp: { input: { on_update_current_timestamp: true }, expected: { on_update_current_timestamp: true } },
  on_update_current_timestamp_precision: { input: { on_update_current_timestamp_precision: 3 }, expected: { on_update_current_timestamp_precision: 3 } },
  comment: { input: { comment: '状态' }, expected: { comment: '状态' } },
  comment_options_enabled: { input: { comment_options_enabled: true }, expected: { comment_options_enabled: true } },
  comment_options: {
    input: { comment_options: [{ label: '启用', value: '1', mysql: '1', postgresql: 'TRUE', sqlite: '1' }] },
    expected: { comment_options: [{ label: '启用', value: '1', mysql: '1', postgresql: 'TRUE', sqlite: '1' }] },
  },
  is_commented_out: { input: { is_commented_out: true }, expected: { is_commented_out: true } },
  mysql: { input: { mysql: { field_type: 'datetime' } }, expected: { mysql: { field_type: 'datetime' } } },
  postgresql: { input: { postgresql: { field_type: 'timestamp' } }, expected: { postgresql: { field_type: 'timestamp' } } },
  sqlite: { input: { sqlite: { field_type: 'text' } }, expected: { sqlite: { field_type: 'text' } } },
}

const indexCases: PropertyCases<Index> = {
  name: { input: { name: 'idx_events' }, expected: { name: 'idx_events' } },
  use_default_name: { input: { use_default_name: true, name: 'ignored' }, expected: { use_default_name: true } },
  type: { input: { type: 'unique' }, expected: { type: 'unique' } },
  using: { input: { using: 'BTREE' }, expected: { using: 'BTREE' } },
  columns: { input: { columns: [{ name: 'id' }] }, expected: { columns: [{ name: 'id' }] } },
  active_only: { input: { active_only: true }, expected: { active_only: true } },
  logical_delete: {
    input: { logical_delete: { enabled: false, field: 'deleted_at', predicate: 'deleted_at IS NULL', mysql_strategy: 'functional' } },
    expected: { logical_delete: { enabled: false, field: 'deleted_at', predicate: 'deleted_at IS NULL', mysql_strategy: 'functional' } },
  },
  comment: { input: { comment: 'index comment' }, expected: { comment: 'index comment' } },
  pre_comment: { input: { pre_comment: 'before index' }, expected: { pre_comment: 'before index' } },
  mysql: { input: { mysql: { type: 'unique', name: 'mysql_idx', using: 'HASH' } }, expected: { mysql: { type: 'unique', name: 'mysql_idx', using: 'HASH' } } },
  postgresql: { input: { postgresql: { type: 'unique', name: 'pg_idx' } }, expected: { postgresql: { type: 'unique', name: 'pg_idx' } } },
  sqlite: { input: { sqlite: { type: 'unique', name: 'sqlite_idx' } }, expected: { sqlite: { type: 'unique', name: 'sqlite_idx' } } },
}

describe('buildTableExportData', () => {
  const fullTable = freeze({
    name: 'events',
    comment: '事件',
    comment_before_table: ['before', null, 'table'],
    comment_before_fields: { id: 'identifier', value: ['before value', null, 'end'] },
    mysql: { mysql_engine: 'InnoDB', mysql_charset: 'utf8mb4', mysql_collation: 'utf8mb4_bin' },
    partition: {
      mysql: { strategy: 'RANGE', columns: ['id'], expression: 'RANGE (id)' },
      postgresql: { strategy: 'HASH', columns: ['id'], expression: 'HASH (id)' },
      sqlite: { strategy: 'LIST', columns: ['id'], expression: 'LIST (id)' },
    },
    fields: [{ field_name: 'id', field_type: 'bigint', primary_key: true }],
    indexes: [{ name: 'idx_id', type: 'index', columns: [{ name: 'id' }] }],
    pre_sql: { mysql: 'SET @before = 1;', postgresql: 'SELECT 1;', sqlite: 'PRAGMA foreign_keys = OFF;' },
    post_sql: { mysql: 'SET @after = 1;', postgresql: 'SELECT 2;', sqlite: 'PRAGMA foreign_keys = ON;' },
  } satisfies Required<Table>)

  it.each(Object.keys(fullTable) as (keyof Table)[])('preserves Table.%s', key => {
    expect(buildTableExportData(fullTable)[key]).toStrictEqual(fullTable[key])
  })

  it.each(Object.entries(fieldCases))('handles Field.%s', (_key, { input, expected }) => {
    expect(exportField(freeze(input))).toStrictEqual({ field_name: 'value', ...expected })
  })

  it.each(Object.entries(indexCases))('handles Index.%s', (_key, { input, expected }) => {
    const source: Index = freeze({ type: 'index', columns: [], ...input })
    expect(buildTableExportData(table([], [source])).indexes[0]).toStrictEqual({ type: 'index', columns: [], ...expected })
  })

  it('preserves all index column fields and sort overrides for all three dialects', () => {
    const column = freeze({
      name: 'value',
      sort_order: 'ASC',
      mysql: { sort_order: 'DESC' },
      postgresql: { sort_order: 'ASC' },
      sqlite: { sort_order: 'DESC' },
    } satisfies Required<IndexColumn>)
    const out = buildTableExportData(table([], [{ type: 'index', columns: [column] }]))
    expect(out.indexes[0]!.columns).toStrictEqual([column])
    expect(out.indexes[0]!.columns[0]).not.toBe(column)
  })

  it.each(['mysql', 'postgresql', 'sqlite'] as const)('preserves every declared property and empty value in %s field overrides', dialect => {
    const override = freeze({ field_type: '', field_length: null, field_scale: 0, default: false } satisfies Required<FieldOverride>)
    const out = exportField({ [dialect]: override })
    expect(out[dialect]).toStrictEqual(override)
    expect(out[dialect]).not.toBe(override)
  })

  it('common field references keep only the name and reference flag, ignoring all redundant overrides', () => {
    const field: Field = Object.assign({ field_name: 'updated_at' }, ...Object.values(fieldCases).map(c => c.input))
    field.field_name = 'updated_at'
    field.use_common_used_fields = true
    expect(exportField(freeze(field))).toStrictEqual({ field_name: 'updated_at', use_common_used_fields: true })
  })

  it('unified types omit empty field_type and quote_default but keep explicit type/metrics/ON UPDATE overrides', () => {
    expect(exportField({ unified_type: 'timestamp', field_type: '', quote_default: true })).toStrictEqual({
      field_name: 'value', unified_type: 'timestamp',
    })
    expect(exportField({
      unified_type: 'timestamp', field_type: 'datetime', field_length: 3, field_scale: 0,
      quote_default: false, on_update_current_timestamp: true, on_update_current_timestamp_precision: 0,
    })).toStrictEqual({
      field_name: 'value', unified_type: 'timestamp', field_type: 'datetime', field_length: 3, field_scale: 0,
      on_update_current_timestamp: true, on_update_current_timestamp_precision: 0,
    })
    expect(exportField({ field_type: '', quote_default: false })).toStrictEqual({ field_name: 'value', field_type: '', quote_default: false })
  })

  it.each([
    { input: { field_length: null, field_scale: null }, expected: {} },
    { input: { field_length: undefined, field_scale: undefined }, expected: {} },
    { input: { field_length: 0, field_scale: 0 }, expected: { field_length: 0, field_scale: 0 } },
    { input: { field_length: 12, field_scale: 2, field_length_disabled: true }, expected: { field_scale: 2, field_length_disabled: true } },
    { input: { field_length: 12, field_scale: 2, field_scale_disabled: true }, expected: { field_length: 12, field_scale_disabled: true } },
    { input: { field_length: 12, field_scale: 2, field_length_disabled: true, field_scale_disabled: true }, expected: { field_length_disabled: true, field_scale_disabled: true } },
  ])('clears empty/disabled length and scale: $input', ({ input, expected }) => {
    expect(exportField(freeze(input))).toStrictEqual({ field_name: 'value', ...expected })
  })

  it.each([undefined, false, 0, null, '', 'CURRENT_TIMESTAMP'])('default value %s is not evaluated by truthiness', value => {
    const out = exportField({ default: value })
    if (value === undefined) expect(out).not.toHaveProperty('default')
    else expect(out).toHaveProperty('default', value)
  })

  it.each([undefined, false, true])('ON UPDATE flag %s preserves the explicit value', value => {
    const out = exportField({ on_update_current_timestamp: value })
    if (value === undefined) expect(out).not.toHaveProperty('on_update_current_timestamp')
    else expect(out).toHaveProperty('on_update_current_timestamp', value)
  })

  it.each([undefined, null, 0, 3, 6])('ON UPDATE precision %s is not lost', value => {
    const out = exportField({ on_update_current_timestamp: true, on_update_current_timestamp_precision: value })
    if (value === undefined) expect(out).not.toHaveProperty('on_update_current_timestamp_precision')
    else expect(out).toHaveProperty('on_update_current_timestamp_precision', value)
  })

  it('keeps the default omission rule for field false values but preserves false for not_null/quote_default/default', () => {
    expect(exportField({
      use_common_used_fields: false, not_null: false, primary_key: false, quote_default: false,
      default: false, comment: '', comment_options_enabled: false, comment_options: [],
      is_commented_out: false, field_length_disabled: false, field_scale_disabled: false,
      mysql: {}, postgresql: {}, sqlite: {},
    })).toStrictEqual({ field_name: 'value', not_null: false, quote_default: false, default: false, comment: '' })
  })

  it('comment options omit empty dialect overrides while keeping generic empty values and non-empty overrides', () => {
    expect(exportField({ comment_options: [
      { label: '', value: '', mysql: '', postgresql: undefined, sqlite: '' },
      { label: '关闭', value: '0', mysql: '0', postgresql: 'FALSE', sqlite: '0' },
    ] })).toStrictEqual({ field_name: 'value', comment_options: [
      { label: '', value: '' },
      { label: '关闭', value: '0', mysql: '0', postgresql: 'FALSE', sqlite: '0' },
    ] })
  })

  it('empty table config, index config and column dialect overrides remain omitted', () => {
    const out = buildTableExportData({
      ...table(), comment_before_table: '', comment_before_fields: {}, pre_sql: {}, post_sql: {},
      mysql: { mysql_engine: '', mysql_charset: '', mysql_collation: '' },
      partition: { mysql: {}, postgresql: { strategy: '', columns: [], expression: '' }, sqlite: {} },
      indexes: [{
        name: '', use_default_name: false, type: '', using: '', active_only: false,
        logical_delete: {}, comment: '', pre_comment: '', mysql: {}, postgresql: {}, sqlite: {},
        columns: [{ name: 'id', mysql: {}, postgresql: {}, sqlite: {} }],
      }],
    })
    expect(out).toStrictEqual({ ...table(), indexes: [{ columns: [{ name: 'id' }] }] })
  })

  it('default index names omit only the top-level name without rewriting existing dialect overrides', () => {
    const out = buildTableExportData(table([], [{
      type: 'unique', use_default_name: true, name: 'ignored', columns: [],
      mysql: { name: 'mysql_name' }, postgresql: { name: 'pg_name' }, sqlite: { name: 'sqlite_name' },
    }]))
    expect(out.indexes[0]).toStrictEqual({
      type: 'unique', use_default_name: true, columns: [],
      mysql: { name: 'mysql_name' }, postgresql: { name: 'pg_name' }, sqlite: { name: 'sqlite_name' },
    })
  })

  it('table pre-comments accept strings and empty strings/null in field pre-comments are preserved', () => {
    const source = { ...table(), comment_before_table: 'before', comment_before_fields: { id: '', value: [null, ''] } }
    expect(buildTableExportData(freeze(source))).toStrictEqual(source)
  })

  it('serialization does not mutate source data and is repeatable after a JSON round trip', () => {
    const before = json(fullTable)
    const out = buildTableExportData(fullTable)
    expect(fullTable).toStrictEqual(before)
    expect(buildTableExportData(json(out))).toStrictEqual(out)
    expect(out).not.toBe(fullTable)
    expect(out.partition!.mysql!.columns).not.toBe(fullTable.partition.mysql.columns)
  })
})

describe('schema and common serialization', () => {
  it('schema metadata keeps table order and non-empty SQL while full export keeps tables instead of table_order', () => {
    const source: Schema = freeze({
      schema: '业务',
      tables: [{ ...table([{ field_name: 'updated_at', on_update_current_timestamp: true }]), name: 'z' }, { ...table(), name: 'a' }],
      pre_sql: { mysql: 'SELECT 1;', postgresql: 'SELECT 2;', sqlite: 'SELECT 3;' },
      post_sql: { mysql: 'SELECT 4;', postgresql: 'SELECT 5;', sqlite: 'SELECT 6;' },
    })
    const metadata = buildSchemaWriteData(source)
    expect(metadata).toStrictEqual({ schema: '业务', table_order: ['z', 'a'], pre_sql: source.pre_sql, post_sql: source.post_sql })
    expect(buildSchemaExportData(source)).toStrictEqual({ ...source, tables: source.tables.map(buildTableExportData) })
    expect(buildSchemaExportData(source)).not.toHaveProperty('table_order')
    expect(metadata).not.toHaveProperty('tables')
    expect(metadata.pre_sql).not.toBe(source.pre_sql)
  })

  it('empty schema SQL objects are omitted while non-empty objects keep their existing per-key content (no extra SQL trimming)', () => {
    const source: Schema = { schema: 'public', tables: [], pre_sql: {}, post_sql: {} }
    expect(buildSchemaWriteData(source)).toStrictEqual({ schema: 'public', table_order: [] })
    expect(buildSchemaExportData(source)).toStrictEqual({ schema: 'public', tables: [] })
    expect(buildSchemaWriteData({ ...source, pre_sql: { mysql: '', postgresql: '  ' } })).toStrictEqual({
      schema: 'public', table_order: [], pre_sql: { mysql: '', postgresql: '  ' },
    })
  })

  it('common keeps all declared fields, only separating schema_order and clearing length/scale of common fields', () => {
    const source = freeze({
      struct_version: '1.0', project_name: '', project_description: 'project', enabled_dialects: ['mysql', 'sqlite'],
      default_config: {
        mysql: { database: {}, table: { mysql_engine: 'InnoDB', mysql_charset: 'utf8mb4', mysql_collation: 'utf8mb4_bin' }, pre_sql: 'SELECT 1;', post_sql: '' },
        postgresql: { quote_identifiers: false }, sqlite: { quote_identifiers: false },
      },
      schema_order: ['b', 'a'],
      common_used_fields: {
        updated_at: { field_name: 'updated_at', field_length: 3, field_scale: 2, field_length_disabled: true, field_scale_disabled: true, on_update_current_timestamp: true, on_update_current_timestamp_precision: 0 },
        cleared: { field_name: 'cleared', unified_type: 'decimal', field_length: null, field_scale: null, primary_key: false, default: null },
        zero: { field_name: 'zero', field_length: 0, field_scale: 0, not_null: false, quote_default: false, default: 0 },
      },
      common_used_field_order: ['zero', 'updated_at', 'cleared'],
      unified_types: [{ name: 'decimal', quote_default: false, default_input: 'text', mysql: { type: 'decimal', length: null, scale: 0 }, postgresql: { type: 'numeric' }, sqlite: { type: 'numeric' } }],
      type_case: 'keep', generate_ai_guide: false, initial_data_insert_mode: 'insert', logical_delete: { enabled: false },
    } satisfies Required<CommonConfig>)
    const out = buildCommonWriteData(source)
    const { schema_order, ...expected } = source
    expect(out).toStrictEqual({ ...expected, common_used_fields: {
      updated_at: { field_name: 'updated_at', field_length_disabled: true, field_scale_disabled: true, on_update_current_timestamp: true, on_update_current_timestamp_precision: 0 },
      cleared: { field_name: 'cleared', unified_type: 'decimal', primary_key: false, default: null },
      zero: source.common_used_fields.zero,
    } })
    expect(out).not.toHaveProperty('schema_order')
    expect(source.schema_order).toStrictEqual(schema_order)
    expect(source.common_used_fields.updated_at.field_length).toBe(3)
    expect(buildCommonWriteData(null)).toStrictEqual({})
  })
})

describe('existing initial data serialization regression (implementation unchanged)', () => {
  it('preserves all inline fields, SQL, values and expression markers while omitting undefined data values', () => {
    const row = {
      data: { zero: 0, disabled: false, empty: '', nil: null, absent: undefined, expr: 'CURRENT_TIMESTAMP' },
      field_comments: { zero: 'zero' }, expr_fields: { expr: true, disabled: false },
      is_skip: true, row_comment: 'row',
    } satisfies Required<InitialDataRow>
    const source = freeze({
      rows: [row], insert_mode: 'overwrite',
      pre_sql: { mysql: 'SELECT 1;', postgresql: 'SELECT 2;', sqlite: 'SELECT 3;' },
      post_sql: { mysql: 'SELECT 4;', postgresql: 'SELECT 5;', sqlite: 'SELECT 6;' },
    } satisfies Required<InitialData>)
    expect(buildInitialDataExport(source)).toStrictEqual(source)
    const serialized = json(buildInitialDataExport(source))
    expect(serialized.rows?.[0]?.data).toStrictEqual({ zero: 0, disabled: false, empty: '', nil: null, expr: 'CURRENT_TIMESTAMP' })
    expect(normalizeInitialData(serialized)).toStrictEqual(serialized)
  })

  it('empty objects, empty row sets, disabled row markers and empty comments follow the existing omission rules', () => {
    expect(buildInitialDataExport({ pre_sql: {}, post_sql: {} })).toStrictEqual({})
    expect(buildInitialDataExport({ rows: [] })).toStrictEqual({ rows: [] })
    expect(buildInitialDataExport({ rows: [{ data: {}, is_skip: false, row_comment: '', field_comments: {}, expr_fields: {} }] })).toStrictEqual({ rows: [{ data: {} }] })
  })

  it('legacy parallel arrays normalize to inline format only, preserving SQL and false/0/null', () => {
    const normalized = normalizeInitialData({
      rows: [{ id: 0, enabled: false, value: null }], row_comments: ['row'],
      field_comments: [{ id: 'id' }], skip_rows: [true],
      pre_sql: { mysql: 'SELECT 1;' }, post_sql: { sqlite: 'SELECT 2;' },
    })!
    expect(buildInitialDataExport(normalized)).toStrictEqual({
      rows: [{ data: { id: 0, enabled: false, value: null }, row_comment: 'row', field_comments: { id: 'id' }, is_skip: true }],
      pre_sql: { mysql: 'SELECT 1;' }, post_sql: { sqlite: 'SELECT 2;' },
    })
  })
})
