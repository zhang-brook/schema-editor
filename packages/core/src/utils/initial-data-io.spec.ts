import { describe, expect, it } from 'vitest'
import type { InitialData } from '../types/schema'
import { buildInitialDataExport, normalizeInitialData } from './initial-data-io'

describe('normalizeInitialData', () => {
  it('wraps a plain array into inline rows and turns null rows into empty objects', () => {
    const result = normalizeInitialData([{ id: 1 }, null])
    expect(result).toEqual({ rows: [{ data: { id: 1 } }, { data: {} }] })
  })

  it('normalizes an empty array to empty rows', () => {
    expect(normalizeInitialData([])).toEqual({ rows: [] })
  })

  it('merges legacy "parallel arrays" into the inline structure', () => {
    const result = normalizeInitialData({
      rows: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }],
      row_comments: ['首行', null, ''],
      field_comments: [{ name: '名称' }, null, {}],
      skip_rows: [false, true, null],
    })
    expect(result?.rows).toEqual([
      { data: { id: 1, name: 'a' }, row_comment: '首行', field_comments: { name: '名称' } },
      { data: { id: 2, name: 'b' }, is_skip: true },
      { data: { id: 3, name: 'c' } },
    ])
  })

  it('preserves the already-inline format as-is and fills in parallel arrays as needed', () => {
    const result = normalizeInitialData({
      rows: [
        { data: { id: 1 }, row_comment: '行注释', is_skip: true, field_comments: { id: '标识' }, expr_fields: { id: true } },
        { data: { id: 2 } },
      ],
      row_comments: ['忽略', '补齐'],
    })
    expect(result?.rows).toEqual([
      { data: { id: 1 }, field_comments: { id: '标识' }, expr_fields: { id: true }, is_skip: true, row_comment: '行注释' },
      { data: { id: 2 } },
    ])
  })

  it('inlining is idempotent', () => {
    const once = normalizeInitialData({ rows: [{ id: 1 }], skip_rows: [true] })
    expect(normalizeInitialData(once)).toEqual(once)
  })

  it('keeps every valid insert mode and drops unknown values', () => {
    expect(normalizeInitialData({ rows: [], insert_mode: 'insert' })?.insert_mode).toBe('insert')
    expect(normalizeInitialData({ rows: [], insert_mode: 'ignore' })?.insert_mode).toBe('ignore')
    expect(normalizeInitialData({ rows: [], insert_mode: 'overwrite' })?.insert_mode).toBe('overwrite')
    expect(normalizeInitialData({ rows: [], insert_mode: 'invalid' })).toEqual({ rows: [] })
  })

  it('keeps copies of pre_sql / post_sql', () => {
    const raw = { rows: [], pre_sql: { mysql: 'SET a=1' }, post_sql: { postgresql: 'SELECT 1' } }
    const result = normalizeInitialData(raw)
    expect(result?.pre_sql).toEqual({ mysql: 'SET a=1' })
    expect(result?.post_sql).toEqual({ postgresql: 'SELECT 1' })
    expect(result?.pre_sql).not.toBe(raw.pre_sql)
  })

  it('discards malformed rows and pre_sql', () => {
    expect(normalizeInitialData({ rows: 'not-an-array', pre_sql: 'sql' })).toEqual({})
    expect(normalizeInitialData({ post_sql: 42 })).toEqual({})
  })

  it('returns null for non-object input', () => {
    expect(normalizeInitialData(null)).toBeNull()
    expect(normalizeInitialData(undefined)).toBeNull()
    expect(normalizeInitialData('json')).toBeNull()
    expect(normalizeInitialData(42)).toBeNull()
  })
})

describe('buildInitialDataExport', () => {
  it('writes only non-empty fields', () => {
    const data: InitialData = {
      rows: [
        { data: { id: 1 } },
        { data: { id: 2 }, field_comments: {}, expr_fields: {}, is_skip: false, row_comment: '' },
        { data: { id: 3 }, field_comments: { id: '标识' }, expr_fields: { id: true }, is_skip: true, row_comment: '三' },
      ],
    }
    expect(buildInitialDataExport(data)).toEqual({
      rows: [{ data: { id: 1 } }, { data: { id: 2 } }, { data: { id: 3 }, field_comments: { id: '标识' }, expr_fields: { id: true }, is_skip: true, row_comment: '三' }],
    })
  })

  it('persists explicit insert modes and omits inheritance', () => {
    expect(buildInitialDataExport({ rows: [], insert_mode: 'insert' })).toEqual({ rows: [], insert_mode: 'insert' })
    expect(buildInitialDataExport({ rows: [], insert_mode: 'ignore' })).toEqual({ rows: [], insert_mode: 'ignore' })
    expect(buildInitialDataExport({ rows: [], insert_mode: 'overwrite' })).toEqual({ rows: [], insert_mode: 'overwrite' })
    expect(buildInitialDataExport({ rows: [] })).toEqual({ rows: [] })
  })

  it('does not persist empty pre_sql / post_sql objects', () => {
    expect(buildInitialDataExport({ rows: [], pre_sql: {}, post_sql: {} })).toEqual({ rows: [] })
    expect(buildInitialDataExport({ pre_sql: { mysql: 'SELECT 1' } })).toEqual({ pre_sql: { mysql: 'SELECT 1' } })
  })

  it('outputs an empty object when rows is not initialized', () => {
    expect(buildInitialDataExport({})).toEqual({})
  })

  it('creates a new rows array on export instead of reusing the input reference', () => {
    const data: InitialData = { rows: [{ data: { id: 1 } }] }
    const exportData = buildInitialDataExport(data)
    expect(exportData.rows).not.toBe(data.rows)
    expect(exportData.rows).toEqual([{ data: { id: 1 } }])
  })
})
