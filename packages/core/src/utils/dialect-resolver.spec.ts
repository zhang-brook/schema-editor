import { describe, expect, it } from 'vitest'
import type { Field, Index, Table, TableMysqlConfig } from '../types/schema'
import { getDialectOverrideValue, getDialectSubConfig, resolveDialectOverride } from './dialect-resolver'

function field(extra: Partial<Field> = {}): Field {
  return { field_name: 'id', ...extra }
}

describe('resolveDialectOverride', () => {
  it('方言覆盖优先于顶层同名属性', () => {
    const f = field({ field_type: 'varchar', mysql: { field_type: 'varchar' }, postgresql: { field_type: 'character varying' } })
    expect(resolveDialectOverride(f, 'postgresql', 'field_type', f.field_type)).toBe('character varying')
    expect(resolveDialectOverride(f, 'mysql', 'field_type', f.field_type)).toBe('varchar')
  })

  it('方言子对象缺该键时回退顶层', () => {
    const f = field({ default: '0', mysql: { field_type: 'int' } })
    expect(resolveDialectOverride(f, 'mysql', 'default', undefined)).toBe('0')
  })

  it('顶层也缺省时使用 fallback', () => {
    const f = field()
    expect(resolveDialectOverride(f, 'sqlite', 'field_type', 'text')).toBe('text')
  })

  it('方言覆盖的假值仍算命中，不回退顶层', () => {
    const f = field({ default: 'top', mysql: { default: false } })
    expect(resolveDialectOverride(f, 'mysql', 'default', 'fb')).toBe(false)

    const nullDefault = field({ default: 'top', mysql: { default: null } })
    expect(resolveDialectOverride(nullDefault, 'mysql', 'default', 'fb')).toBeNull()
  })

  it('方言子对象整体缺失时不抛错', () => {
    const f = field({ field_length: 10 })
    expect(resolveDialectOverride(f, 'sqlite', 'field_length', 1)).toBe(10)
  })

  it('对象为空或缺省时直接落到 fallback', () => {
    expect(resolveDialectOverride<Field, 'default'>(null, 'mysql', 'default', 'x')).toBe('x')
    expect(resolveDialectOverride<Field, 'default'>(undefined, 'mysql', 'default')).toBeUndefined()
    expect(resolveDialectOverride(field(), 'mysql', 'comment')).toBeUndefined()
  })

  it('支持索引的 name / type 覆盖', () => {
    const index: Index = { type: 'index', name: 'idx_a', columns: [{ name: 'id' }], mysql: { name: 'idx_b' } }
    expect(resolveDialectOverride(index, 'mysql', 'name', index.name)).toBe('idx_b')
    expect(resolveDialectOverride(index, 'postgresql', 'name', index.name)).toBe('idx_a')
    expect(resolveDialectOverride(index, 'postgresql', 'type', index.type)).toBe('index')
  })
})

describe('getDialectOverrideValue', () => {
  it('只读方言子对象，不回退顶层同名属性', () => {
    const f = field({ default: 'top', postgresql: { default: 'pg' } })
    expect(getDialectOverrideValue(f, 'postgresql', 'default', 'fb')).toBe('pg')
    expect(getDialectOverrideValue(f, 'mysql', 'default', 'fb')).toBe('fb')
  })

  it('方言子对象存在但值为 undefined 时回退 fallback', () => {
    const f = field({ mysql: { field_length: undefined } })
    expect(getDialectOverrideValue(f, 'mysql', 'field_length', 20)).toBe(20)
  })

  it('无 fallback 时返回 undefined', () => {
    expect(getDialectOverrideValue(field(), 'sqlite', 'default')).toBeUndefined()
  })
})

describe('getDialectSubConfig', () => {
  it('命中方言子配置', () => {
    const mysql: TableMysqlConfig = { mysql_engine: 'InnoDB' }
    expect(getDialectSubConfig(mysql, 'mysql_engine', 'MyISAM')).toBe('InnoDB')
  })

  it('子配置缺键或为 null 时回退', () => {
    expect(getDialectSubConfig<TableMysqlConfig, 'mysql_engine'>({}, 'mysql_engine', 'MyISAM')).toBe('MyISAM')
    expect(getDialectSubConfig<TableMysqlConfig, 'mysql_engine'>(null, 'mysql_engine', 'MyISAM')).toBe('MyISAM')
    expect(getDialectSubConfig<TableMysqlConfig, 'mysql_charset'>(undefined, 'mysql_charset')).toBeUndefined()
  })

  it('表上的方言子配置按缺失键回退默认值', () => {
    const table = { name: 't', mysql: { mysql_charset: 'utf8mb4' } } as Table
    expect(getDialectSubConfig(table.mysql, 'mysql_charset', 'utf8')).toBe('utf8mb4')
    expect(getDialectSubConfig(table.mysql, 'mysql_engine', 'InnoDB')).toBe('InnoDB')
  })
})
