import { describe, it, expect } from 'vitest'
import type { Table, CommonConfig } from '@/types/schema'
import { generateTableMySQL } from './mysql'
import { generateTablePostgreSQL } from './postgresql'

function makeTable(partition?: Table['partition']): Table {
  return {
    name: 'orders',
    comment: '订单表',
    fields: [
      { field_name: 'id', field_type: 'int', primary_key: true, not_null: true },
      { field_name: 'created_at', field_type: 'datetime' },
      { field_name: 'region_id', field_type: 'int' },
    ],
    indexes: [],
    partition,
  }
}

const commonConfig = null as unknown as CommonConfig

describe('partition by clause', () => {
  it('mysql: structured strategy + columns', () => {
    const sql = generateTableMySQL(
      makeTable({ mysql: { strategy: 'RANGE', columns: ['created_at'] } }),
      commonConfig,
    )
    expect(sql).toContain('PARTITION BY RANGE (`created_at`)')
  })

  it('mysql: multi columns', () => {
    const sql = generateTableMySQL(
      makeTable({ mysql: { strategy: 'RANGE COLUMNS', columns: ['created_at', 'region_id'] } }),
      commonConfig,
    )
    expect(sql).toContain('PARTITION BY RANGE COLUMNS (`created_at`, `region_id`)')
  })

  it('mysql: raw expression fallback', () => {
    const sql = generateTableMySQL(
      makeTable({ mysql: { expression: 'KEY (id)' } }),
      commonConfig,
    )
    expect(sql).toContain('PARTITION BY KEY (id)')
  })

  it('postgresql: structured strategy + columns', () => {
    const sql = generateTablePostgreSQL(
      makeTable({ postgresql: { strategy: 'RANGE', columns: ['created_at'] } }),
      'public',
      commonConfig,
    )
    expect(sql).toContain('PARTITION BY RANGE ("created_at")')
  })

  it('postgresql: raw expression fallback', () => {
    const sql = generateTablePostgreSQL(
      makeTable({ postgresql: { expression: 'RANGE (to_days(created_at))' } }),
      'public',
      commonConfig,
    )
    expect(sql).toContain('PARTITION BY RANGE (to_days(created_at))')
  })

  it('postgresql: partition is after the closing parenthesis', () => {
    const sql = generateTablePostgreSQL(
      makeTable({ postgresql: { strategy: 'HASH', columns: ['model_id'] } }),
      'public',
      commonConfig,
    )
    // 合法语法：PARTITION BY 生成在右括号 ) 之后、分号之前
    expect(sql).toContain(') PARTITION BY HASH ("model_id");')
    // 不能出现非法拼接：PRIMARY KEY (...) PARTITION BY
    expect(sql).not.toContain('PRIMARY KEY ("id") PARTITION BY')
  })

  it('mysql: partition is after the closing parenthesis', () => {
    const sql = generateTableMySQL(
      makeTable({ mysql: { strategy: 'HASH', columns: ['model_id'] } }),
      commonConfig,
    )
    expect(sql).toContain(') PARTITION BY HASH (`model_id`)')
    expect(sql).not.toContain('PRIMARY KEY (`id`) USING BTREE PARTITION BY')
  })

  it('no partition config → no PARTITION BY', () => {
    expect(generateTableMySQL(makeTable(), commonConfig)).not.toContain('PARTITION BY')
    expect(generateTablePostgreSQL(makeTable(), 'public', commonConfig)).not.toContain('PARTITION BY')
  })

  it('empty strategy with empty columns → no PARTITION BY', () => {
    expect(
      generateTableMySQL(makeTable({ mysql: { strategy: '', columns: [] } }), commonConfig),
    ).not.toContain('PARTITION BY')
  })
})
