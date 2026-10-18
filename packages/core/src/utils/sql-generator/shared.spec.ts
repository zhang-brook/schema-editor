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
  it('numbers and booleans are output as-is', () => {
    expect(formatSqlDefault(0, false)).toBe('0')
    expect(formatSqlDefault(3.14, false)).toBe('3.14')
    expect(formatSqlDefault(true, false)).toBe('true')
    expect(formatSqlDefault(false, true)).toBe("'false'")
  })

  it('null and undefined literals are output', () => {
    expect(formatSqlDefault(null, false)).toBe('null')
    expect(formatSqlDefault(undefined, false)).toBe('undefined')
  })

  it('string defaults other than NULL are output as-is', () => {
    expect(formatSqlDefault('abc' as JsonValue, false)).toBe('abc')
    expect(formatSqlDefault('abc', true)).toBe("'abc'")
  })

  it('single quotes are escaped when wrapping in quotes', () => {
    expect(formatSqlDefault("O'Neil", true)).toBe("'O''Neil'")
  })

  it('CURRENT_TIMESTAMP expressions are always output as-is', () => {
    expect(formatSqlDefault('CURRENT_TIMESTAMP', true)).toBe('CURRENT_TIMESTAMP')
    expect(formatSqlDefault('CURRENT_TIMESTAMP(3) ON UPDATE', true)).toBe('CURRENT_TIMESTAMP(3) ON UPDATE')
  })
})

describe('resolveQuoteDefault', () => {
  it('field-level setting takes precedence over the unified type', () => {
    const f = field('a', { field_type: 'varchar', quote_default: false, unified_type: 'str' })
    expect(resolveQuoteDefault(f, null)).toBe(false)
  })

  it('false when there is no field-level setting and no unified type mapping', () => {
    expect(resolveQuoteDefault(field('a'), null)).toBe(false)
  })
})

describe('resolveFieldTypeForDialect', () => {
  it('uses field_type when there is no unified type, dialect override has the highest priority', () => {
    const f = field('a', { field_type: 'varchar', field_length: 32, postgresql: { field_type: 'character varying' } })
    expect(resolveFieldTypeForDialect(f, 'mysql', null)).toEqual({ type: 'varchar', length: 32, scale: null })
    expect(resolveFieldTypeForDialect(f, 'postgresql', null)).toEqual({
      type: 'character varying',
      length: 32,
      scale: null,
    })
  })

  it('dialect override can clear the length while keeping the other attributes', () => {
    const f = field('a', { field_type: 'decimal', field_length: 10, field_scale: 2, sqlite: { field_length: null } })
    expect(resolveFieldTypeForDialect(f, 'sqlite', null)).toEqual({ type: 'decimal', length: null, scale: 2 })
  })

  it('the "not set" checkbox forces skipping length and scale', () => {
    const f = field('a', { field_type: 'decimal', field_length: 10, field_scale: 2, field_length_disabled: true, field_scale_disabled: true })
    expect(resolveFieldTypeForDialect(f, 'mysql', null)).toEqual({ type: 'decimal', length: null, scale: null })
  })
})

describe('applyTypeCase', () => {
  it('case conversion for the four modes', () => {
    expect(applyTypeCase('VarChar', undefined)).toBe('VarChar')
    expect(applyTypeCase('VarChar', 'keep')).toBe('VarChar')
    expect(applyTypeCase('VarChar', 'lowercase')).toBe('varchar')
    expect(applyTypeCase('varchar', 'uppercase')).toBe('VARCHAR')
    expect(applyTypeCase('VARCHAR', 'pascal')).toBe('Varchar')
    expect(applyTypeCase('', 'uppercase')).toBe('')
  })
})

describe('resolveIndexName', () => {
  it('mysql expands placeholders and returns undefined when the name is missing', () => {
    expect(resolveIndexName(index({ name: '{pre}email' }), 'mysql', 't')).toBe('idx_email')
    expect(resolveIndexName(index({ name: undefined }), 'mysql', 't')).toBeUndefined()
  })

  it('only prefix/suffix placeholders is treated as unnamed', () => {
    expect(resolveIndexName(index({ name: '{pre}{post}' }), 'mysql', 't')).toBeUndefined()
    expect(resolveIndexName(index({ name: '{pre}{post}' }), 'sqlite', 't')).toBe('idx_id')
  })

  it('postgresql prefix includes the table name and switches by unique type', () => {
    expect(resolveIndexName(index({ type: 'unique', name: '{pre}email' }), 'postgresql', 'users')).toBe('uk__users__email')
    expect(resolveIndexName(index({ name: undefined, columns: [{ name: 'a' }, { name: 'b' }] }), 'postgresql', 'users')).toBe('idx__users__a_b')
  })

  it('configured name is ignored when the default name option is enabled', () => {
    expect(resolveIndexName(index({ name: 'idx_custom', use_default_name: true }), 'mysql', 't')).toBeUndefined()
    expect(resolveIndexName(index({ name: 'idx_custom', use_default_name: true }), 'sqlite', 't')).toBe('idx_id')
  })

  it('dialect-level name / type overrides take priority', () => {
    const i = index({ name: '{pre}a', type: 'index', mysql: { name: '{pre}b', type: 'unique' } })
    expect(resolveIndexName(i, 'mysql', 't')).toBe('uk_b')
    // Falls back to the top-level name when no dialect override is configured; the prefix is expanded per dialect
    expect(resolveIndexName(i, 'postgresql', 't')).toBe('idx__t__a')
  })
})

describe('buildFieldComment', () => {
  it('returns the original comment when comment options are not enabled', () => {
    expect(buildFieldComment(field('a', { comment: '备注' }), 'mysql')).toBe('备注')
    expect(buildFieldComment(field('a', { comment_options_enabled: true, comment_options: [] }), 'mysql')).toBe('')
  })

  it('concatenates option labels and the default value', () => {
    const f = field('a', {
      comment: '状态',
      comment_options_enabled: true,
      comment_options: [{ value: '1', label: '启用', postgresql: 'true' }, { value: '0', label: '停用' }],
      default: '1',
    })
    expect(buildFieldComment(f, 'mysql')).toBe('状态：1-启用，0-停用，默认1')
    expect(buildFieldComment(f, 'postgresql')).toBe('状态：true-启用，0-停用，默认1')
  })

  it('boolean defaults are rendered per dialect, dialect override takes priority', () => {
    const f = field('a', {
      comment_options_enabled: true,
      comment_options: [{ value: '1', label: 'A' }],
      default: true,
      postgresql: { default: false },
    })
    expect(buildFieldComment(f, 'mysql')).toBe('1-A，默认1')
    expect(buildFieldComment(f, 'postgresql')).toBe('1-A，默认FALSE')
  })

  it('no default segment is output when the default is null or an empty string', () => {
    const base = { comment_options_enabled: true, comment_options: [{ value: '1', label: 'A' }] }
    expect(buildFieldComment(field('a', { ...base, default: null }), 'mysql')).toBe('1-A，默认null')
    expect(buildFieldComment(field('a', { ...base, default: '' }), 'mysql')).toBe('1-A')
    expect(buildFieldComment(field('a', base), 'mysql')).toBe('1-A')
  })

  it('entries with both an empty value and an empty label are skipped', () => {
    const f = field('a', { comment_options_enabled: true, comment_options: [{ value: '', label: '' }, { value: '2', label: 'B' }] })
    expect(buildFieldComment(f, 'sqlite')).toBe('2-B')
  })
})

describe('filterInitialDataRows', () => {
  it('removes skip rows and keeps comments and expression flags aligned', () => {
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

  it('hasRows is false when all rows are skipped or there are no rows', () => {
    expect(filterInitialDataRows([{ data: {}, is_skip: true }]).hasRows).toBe(false)
    expect(filterInitialDataRows(undefined)).toEqual({ rows: [], rowComments: [], exprFields: [], hasRows: false })
  })
})

describe('isStringTypeField', () => {
  it('custom types (no unified type) return true so the user can decide', () => {
    expect(isStringTypeField(field('a'), null)).toBe(true)
  })
})
