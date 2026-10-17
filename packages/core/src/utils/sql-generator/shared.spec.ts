import { describe, expect, it } from 'vitest'
import type { Field, Index, JsonValue } from '../../types/schema'
import {
  applyTypeCase,
  buildFieldComment,
  filterInitialDataRows,
  formatSqlDefault,
  isStringTypeField,
  resolveFieldTypeForDialect,
  resolveIndexName,
  resolveQuoteDefault,
} from './shared'

function field(name: string, extra: Partial<Field> = {}): Field {
  return { field_name: name, field_type: 'varchar', ...extra }
}

function index(extra: Partial<Index> = {}): Index {
  return { type: 'index', name: 'idx_a', columns: [{ name: 'id' }], ...extra }
}

describe('formatSqlDefault', () => {
  it('数字与布尔按原样输出', () => {
    expect(formatSqlDefault(0, false)).toBe('0')
    expect(formatSqlDefault(3.14, false)).toBe('3.14')
    expect(formatSqlDefault(true, false)).toBe('true')
    expect(formatSqlDefault(false, true)).toBe("'false'")
  })

  it('null 与 undefined 字面量输出', () => {
    expect(formatSqlDefault(null, false)).toBe('null')
    expect(formatSqlDefault(undefined, false)).toBe('undefined')
  })

  it('字符串默认值按 NULL 之外原样输出', () => {
    expect(formatSqlDefault('abc' as JsonValue, false)).toBe('abc')
    expect(formatSqlDefault('abc', true)).toBe("'abc'")
  })

  it('引号包裹时转义单引号', () => {
    expect(formatSqlDefault("O'Neil", true)).toBe("'O''Neil'")
  })

  it('CURRENT_TIMESTAMP 表达式始终原样输出', () => {
    expect(formatSqlDefault('CURRENT_TIMESTAMP', true)).toBe('CURRENT_TIMESTAMP')
    expect(formatSqlDefault('CURRENT_TIMESTAMP(3) ON UPDATE', true)).toBe('CURRENT_TIMESTAMP(3) ON UPDATE')
  })
})

describe('resolveQuoteDefault', () => {
  it('字段级设置优先于统一类型', () => {
    const f = field('a', { field_type: 'varchar', quote_default: false, unified_type: 'str' })
    expect(resolveQuoteDefault(f, null)).toBe(false)
  })

  it('无字段级设置且无统一类型映射时为 false', () => {
    expect(resolveQuoteDefault(field('a'), null)).toBe(false)
  })
})

describe('resolveFieldTypeForDialect', () => {
  it('无统一类型时用 field_type，方言覆盖最优先', () => {
    const f = field('a', { field_type: 'varchar', field_length: 32, postgresql: { field_type: 'character varying' } })
    expect(resolveFieldTypeForDialect(f, 'mysql', null)).toEqual({ type: 'varchar', length: 32, scale: null })
    expect(resolveFieldTypeForDialect(f, 'postgresql', null)).toEqual({
      type: 'character varying',
      length: 32,
      scale: null,
    })
  })

  it('方言覆盖可清空长度并保留其余属性', () => {
    const f = field('a', { field_type: 'decimal', field_length: 10, field_scale: 2, sqlite: { field_length: null } })
    expect(resolveFieldTypeForDialect(f, 'sqlite', null)).toEqual({ type: 'decimal', length: null, scale: 2 })
  })

  it('「不设置」勾选强制跳过长度与小数位', () => {
    const f = field('a', { field_type: 'decimal', field_length: 10, field_scale: 2, field_length_disabled: true, field_scale_disabled: true })
    expect(resolveFieldTypeForDialect(f, 'mysql', null)).toEqual({ type: 'decimal', length: null, scale: null })
  })
})

describe('applyTypeCase', () => {
  it('四种模式的大小写转换', () => {
    expect(applyTypeCase('VarChar', undefined)).toBe('VarChar')
    expect(applyTypeCase('VarChar', 'keep')).toBe('VarChar')
    expect(applyTypeCase('VarChar', 'lowercase')).toBe('varchar')
    expect(applyTypeCase('varchar', 'uppercase')).toBe('VARCHAR')
    expect(applyTypeCase('VARCHAR', 'pascal')).toBe('Varchar')
    expect(applyTypeCase('', 'uppercase')).toBe('')
  })
})

describe('resolveIndexName', () => {
  it('mysql 展开占位符，缺名时返回 undefined', () => {
    expect(resolveIndexName(index({ name: '{pre}email' }), 'mysql', 't')).toBe('idx_email')
    expect(resolveIndexName(index({ name: undefined }), 'mysql', 't')).toBeUndefined()
  })

  it('只剩前后缀占位符视为未命名', () => {
    expect(resolveIndexName(index({ name: '{pre}{post}' }), 'mysql', 't')).toBeUndefined()
    expect(resolveIndexName(index({ name: '{pre}{post}' }), 'sqlite', 't')).toBe('idx_id')
  })

  it('postgresql 前缀带表名并按唯一类型切换', () => {
    expect(resolveIndexName(index({ type: 'unique', name: '{pre}email' }), 'postgresql', 'users')).toBe('uk__users__email')
    expect(resolveIndexName(index({ name: undefined, columns: [{ name: 'a' }, { name: 'b' }] }), 'postgresql', 'users')).toBe('idx__users__a_b')
  })

  it('勾选默认名时忽略配置名', () => {
    expect(resolveIndexName(index({ name: 'idx_custom', use_default_name: true }), 'mysql', 't')).toBeUndefined()
    expect(resolveIndexName(index({ name: 'idx_custom', use_default_name: true }), 'sqlite', 't')).toBe('idx_id')
  })

  it('方言级 name / type 覆盖优先', () => {
    const i = index({ name: '{pre}a', type: 'index', mysql: { name: '{pre}b', type: 'unique' } })
    expect(resolveIndexName(i, 'mysql', 't')).toBe('uk_b')
    // 未配置方言覆盖时回退顶层名称，前缀按方言展开
    expect(resolveIndexName(i, 'postgresql', 't')).toBe('idx__t__a')
  })
})

describe('buildFieldComment', () => {
  it('未启用选项含义时返回原注释', () => {
    expect(buildFieldComment(field('a', { comment: '备注' }), 'mysql')).toBe('备注')
    expect(buildFieldComment(field('a', { comment_options_enabled: true, comment_options: [] }), 'mysql')).toBe('')
  })

  it('拼接选项含义与默认值', () => {
    const f = field('a', {
      comment: '状态',
      comment_options_enabled: true,
      comment_options: [{ value: '1', label: '启用', postgresql: 'true' }, { value: '0', label: '停用' }],
      default: '1',
    })
    expect(buildFieldComment(f, 'mysql')).toBe('状态：1-启用，0-停用，默认1')
    expect(buildFieldComment(f, 'postgresql')).toBe('状态：true-启用，0-停用，默认1')
  })

  it('布尔默认值按方言渲染，方言覆盖优先', () => {
    const f = field('a', {
      comment_options_enabled: true,
      comment_options: [{ value: '1', label: 'A' }],
      default: true,
      postgresql: { default: false },
    })
    expect(buildFieldComment(f, 'mysql')).toBe('1-A，默认1')
    expect(buildFieldComment(f, 'postgresql')).toBe('1-A，默认FALSE')
  })

  it('默认值为 null 或空串时不输出默认段', () => {
    const base = { comment_options_enabled: true, comment_options: [{ value: '1', label: 'A' }] }
    expect(buildFieldComment(field('a', { ...base, default: null }), 'mysql')).toBe('1-A，默认null')
    expect(buildFieldComment(field('a', { ...base, default: '' }), 'mysql')).toBe('1-A')
    expect(buildFieldComment(field('a', base), 'mysql')).toBe('1-A')
  })

  it('选项值与含义同时为空的项被跳过', () => {
    const f = field('a', { comment_options_enabled: true, comment_options: [{ value: '', label: '' }, { value: '2', label: 'B' }] })
    expect(buildFieldComment(f, 'sqlite')).toBe('2-B')
  })
})

describe('filterInitialDataRows', () => {
  it('剔除 skip 行并保持注释与表达式标记对齐', () => {
    const result = filterInitialDataRows([
      { data: { id: 1 }, row_comment: '一', expr_fields: { c: true } },
      { data: { id: 2 }, is_skip: true },
      { data: { id: 3 } },
    ])
    expect(result).toEqual({
      rows: [{ id: 1 }, { id: 3 }],
      rowComments: ['一', null],
      exprFields: [{ c: true }, {}],
      hasRows: true,
    })
  })

  it('全部跳过或无行时 hasRows 为 false', () => {
    expect(filterInitialDataRows([{ data: {}, is_skip: true }]).hasRows).toBe(false)
    expect(filterInitialDataRows(undefined)).toEqual({ rows: [], rowComments: [], exprFields: [], hasRows: false })
  })
})

describe('isStringTypeField', () => {
  it('自定义类型（无统一类型）返回 true 交由用户判断', () => {
    expect(isStringTypeField(field('a'), null)).toBe(true)
  })
})
