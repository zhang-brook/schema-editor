import { describe, expect, it } from 'vitest'
import type { Field, Index, Table, TableMysqlConfig } from '../types/schema'
import { getDialectOverrideValue, getDialectSubConfig, resolveDialectOverride } from './dialect-resolver'

function field(extra: Partial<Field> = {}): Field {
  return { field_name: 'id', ...extra }
}

describe('resolveDialectOverride', () => {
  it('dialect overrides take precedence over top-level properties of the same name', () => {
    const f = field({ field_type: 'varchar', mysql: { field_type: 'varchar' }, postgresql: { field_type: 'character varying' } })
    expect(resolveDialectOverride(f, 'postgresql', 'field_type', f.field_type)).toBe('character varying')
    expect(resolveDialectOverride(f, 'mysql', 'field_type', f.field_type)).toBe('varchar')
  })

  it('falls back to the top level when the dialect sub-object lacks the key', () => {
    const f = field({ default: '0', mysql: { field_type: 'int' } })
    expect(resolveDialectOverride(f, 'mysql', 'default', undefined)).toBe('0')
  })

  it('uses the fallback when the top level is also missing', () => {
    const f = field()
    expect(resolveDialectOverride(f, 'sqlite', 'field_type', 'text')).toBe('text')
  })

  it('falsy dialect override values still count as a hit and do not fall back to the top level', () => {
    const f = field({ default: 'top', mysql: { default: false } })
    expect(resolveDialectOverride(f, 'mysql', 'default', 'fb')).toBe(false)

    const nullDefault = field({ default: 'top', mysql: { default: null } })
    expect(resolveDialectOverride(nullDefault, 'mysql', 'default', 'fb')).toBeNull()
  })

  it('does not throw when the dialect sub-object is missing entirely', () => {
    const f = field({ field_length: 10 })
    expect(resolveDialectOverride(f, 'sqlite', 'field_length', 1)).toBe(10)
  })

  it('goes straight to the fallback when the object is null or undefined', () => {
    expect(resolveDialectOverride<Field, 'default'>(null, 'mysql', 'default', 'x')).toBe('x')
    expect(resolveDialectOverride<Field, 'default'>(undefined, 'mysql', 'default')).toBeUndefined()
    expect(resolveDialectOverride(field(), 'mysql', 'comment')).toBeUndefined()
  })

  it('supports name / type overrides for indexes', () => {
    const index: Index = { type: 'index', name: 'idx_a', columns: [{ name: 'id' }], mysql: { name: 'idx_b' } }
    expect(resolveDialectOverride(index, 'mysql', 'name', index.name)).toBe('idx_b')
    expect(resolveDialectOverride(index, 'postgresql', 'name', index.name)).toBe('idx_a')
    expect(resolveDialectOverride(index, 'postgresql', 'type', index.type)).toBe('index')
  })
})

describe('getDialectOverrideValue', () => {
  it('reads only the dialect sub-object and does not fall back to top-level properties of the same name', () => {
    const f = field({ default: 'top', postgresql: { default: 'pg' } })
    expect(getDialectOverrideValue(f, 'postgresql', 'default', 'fb')).toBe('pg')
    expect(getDialectOverrideValue(f, 'mysql', 'default', 'fb')).toBe('fb')
  })

  it('falls back when the dialect sub-object exists but the value is undefined', () => {
    const f = field({ mysql: { field_length: undefined } })
    expect(getDialectOverrideValue(f, 'mysql', 'field_length', 20)).toBe(20)
  })

  it('returns undefined when there is no fallback', () => {
    expect(getDialectOverrideValue(field(), 'sqlite', 'default')).toBeUndefined()
  })
})

describe('getDialectSubConfig', () => {
  it('hits the dialect sub-config', () => {
    const mysql: TableMysqlConfig = { mysql_engine: 'InnoDB' }
    expect(getDialectSubConfig(mysql, 'mysql_engine', 'MyISAM')).toBe('InnoDB')
  })

  it('falls back when the sub-config lacks the key or is null', () => {
    expect(getDialectSubConfig<TableMysqlConfig, 'mysql_engine'>({}, 'mysql_engine', 'MyISAM')).toBe('MyISAM')
    expect(getDialectSubConfig<TableMysqlConfig, 'mysql_engine'>(null, 'mysql_engine', 'MyISAM')).toBe('MyISAM')
    expect(getDialectSubConfig<TableMysqlConfig, 'mysql_charset'>(undefined, 'mysql_charset')).toBeUndefined()
  })

  it('dialect sub-config on the table falls back to defaults for missing keys', () => {
    const table = { name: 't', mysql: { mysql_charset: 'utf8mb4' } } as Table
    expect(getDialectSubConfig(table.mysql, 'mysql_charset', 'utf8')).toBe('utf8mb4')
    expect(getDialectSubConfig(table.mysql, 'mysql_engine', 'InnoDB')).toBe('InnoDB')
  })
})
