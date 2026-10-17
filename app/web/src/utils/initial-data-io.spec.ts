import { describe, expect, it } from 'vitest'
import type { InitialData } from '@/types/schema'
import { buildInitialDataExport, normalizeInitialData } from './initial-data-io'

describe('normalizeInitialData', () => {
  it('纯数组包成行内 rows，null 行兜成空对象', () => {
    const result = normalizeInitialData([{ id: 1 }, null])
    expect(result).toEqual({ rows: [{ data: { id: 1 } }, { data: {} }] })
  })

  it('空数组归一化为空 rows', () => {
    expect(normalizeInitialData([])).toEqual({ rows: [] })
  })

  it('旧「平行数组」合并为行内结构', () => {
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

  it('已是行内格式时原样保留并按需补齐平行数组', () => {
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

  it('行内化是幂等的', () => {
    const once = normalizeInitialData({ rows: [{ id: 1 }], skip_rows: [true] })
    expect(normalizeInitialData(once)).toEqual(once)
  })

  it('保留 pre_sql / post_sql 的副本', () => {
    const raw = { rows: [], pre_sql: { mysql: 'SET a=1' }, post_sql: { postgresql: 'SELECT 1' } }
    const result = normalizeInitialData(raw)
    expect(result?.pre_sql).toEqual({ mysql: 'SET a=1' })
    expect(result?.post_sql).toEqual({ postgresql: 'SELECT 1' })
    expect(result?.pre_sql).not.toBe(raw.pre_sql)
  })

  it('丢弃形态非法的 rows 与 pre_sql', () => {
    expect(normalizeInitialData({ rows: 'not-an-array', pre_sql: 'sql' })).toEqual({})
    expect(normalizeInitialData({ post_sql: 42 })).toEqual({})
  })

  it('非对象输入返回 null', () => {
    expect(normalizeInitialData(null)).toBeNull()
    expect(normalizeInitialData(undefined)).toBeNull()
    expect(normalizeInitialData('json')).toBeNull()
    expect(normalizeInitialData(42)).toBeNull()
  })
})

describe('buildInitialDataExport', () => {
  it('只写非空字段', () => {
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

  it('空 pre_sql / post_sql 对象不落盘', () => {
    expect(buildInitialDataExport({ rows: [], pre_sql: {}, post_sql: {} })).toEqual({ rows: [] })
    expect(buildInitialDataExport({ pre_sql: { mysql: 'SELECT 1' } })).toEqual({ pre_sql: { mysql: 'SELECT 1' } })
  })

  it('未初始化 rows 时输出空对象', () => {
    expect(buildInitialDataExport({})).toEqual({})
  })

  it('导出新建 rows 数组，行数据按 toRaw 取原始值', () => {
    const data: InitialData = { rows: [{ data: { id: 1 } }] }
    const exportData = buildInitialDataExport(data)
    expect(exportData.rows).not.toBe(data.rows)
    expect(exportData.rows).toEqual([{ data: { id: 1 } }])
  })
})
