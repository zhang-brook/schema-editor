import { describe, it, expect } from 'vitest'
import type { CommonConfig, Index, LogicalDeleteConfig, Table } from '@/types/schema'
import { generateTableMySQL } from './mysql'
import { generateTablePostgreSQL } from './postgresql'
import { generateTableSQLite } from './sqlite'

/**
 * 逻辑删除 × 唯一索引的回归测试：
 * 唯一索引只看物理行，软删除后相同业务键再插入会撞 Duplicate entry。
 * 各方言的绕法不同，此处逐方言断言落地形态。
 */

const baseCommon: CommonConfig = {
  default_config: {
    table_ddl_mode: 'create',
    mysql: { database: {}, table: { mysql_engine: 'InnoDB', mysql_charset: 'utf8mb4', mysql_collation: 'utf8mb4_general_ci' } },
    postgresql: { quote_identifiers: true },
    sqlite: { quote_identifiers: true },
  },
  common_used_fields: {},
}

function makeCommon(ld: LogicalDeleteConfig): CommonConfig {
  return { ...baseCommon, logical_delete: ld }
}

function makeTable(index: Partial<Index> = {}): Table {
  return {
    name: 'users',
    comment: '用户表',
    fields: [
      { field_name: 'id', field_type: 'int', primary_key: true },
      { field_name: 'name', field_type: 'varchar', field_length: 100 },
      { field_name: 'deleted_at', field_type: 'datetime' },
      { field_name: 'is_deleted', field_type: 'tinyint' },
    ],
    indexes: [
      { name: 'uk_name', type: 'unique', columns: [{ name: 'name' }], ...index } as Index,
    ],
  }
}

describe('逻辑删除未启用时保持原样', () => {
  const common = makeCommon({ enabled: false, field: 'deleted_at' })

  it('MySQL 仍是普通唯一索引', () => {
    const sql = generateTableMySQL(makeTable({ active_only: true }), common)
    expect(sql).toContain('UNIQUE KEY `uk_name` (`name`)')
    expect(sql).not.toContain('IF(')
  })

  it('PostgreSQL 仍是表内 UNIQUE 约束', () => {
    const sql = generateTablePostgreSQL(makeTable({ active_only: true }), 'public', common)
    expect(sql).toContain('CONSTRAINT "uk_name" UNIQUE ("name")')
    expect(sql).not.toContain('WHERE')
  })
})

describe('表中不存在逻辑删除字段时降级', () => {
  const common = makeCommon({ enabled: true, field: 'deleted_at' })
  const table: Table = {
    name: 'users',
    comment: '用户表',
    fields: [{ field_name: 'name', field_type: 'varchar', field_length: 100 }],
    indexes: [{ name: 'uk_name', type: 'unique', columns: [{ name: 'name' }], active_only: true }],
  }

  it('PostgreSQL 回退为表内 UNIQUE 约束', () => {
    expect(generateTablePostgreSQL(table, 'public', common)).toContain('CONSTRAINT "uk_name" UNIQUE ("name")')
  })
})

describe('MySQL', () => {
  it('函数索引：已删除行映射为 NULL', () => {
    const common = makeCommon({ enabled: true, field: 'deleted_at', mysql_strategy: 'functional' })
    const sql = generateTableMySQL(makeTable({ active_only: true }), common)
    expect(sql).toContain('UNIQUE KEY `uk_name` ((IF(`deleted_at` IS NULL, `name`, NULL)))')
  })

  it('删除列并入索引列（兼容 5.7）', () => {
    const common = makeCommon({ enabled: true, field: 'deleted_at', mysql_strategy: 'timestamp_union' })
    const sql = generateTableMySQL(makeTable({ active_only: true }), common)
    expect(sql).toContain('UNIQUE KEY `uk_name` (`name`, `deleted_at`)')
  })

  it('未勾选 active_only 时不处理', () => {
    const common = makeCommon({ enabled: true, field: 'deleted_at' })
    expect(generateTableMySQL(makeTable(), common)).toContain('UNIQUE KEY `uk_name` (`name`)')
  })
})

describe('PostgreSQL', () => {
  it('部分唯一索引：降级为建表后的 CREATE UNIQUE INDEX ... WHERE', () => {
    const common = makeCommon({ enabled: true, field: 'deleted_at' })
    const sql = generateTablePostgreSQL(makeTable({ active_only: true }), 'public', common)
    expect(sql).toContain('CREATE UNIQUE INDEX "uk_name" ON "public"."users" ("name") WHERE deleted_at IS NULL;')
    // 表级 UNIQUE 约束不支持 WHERE，故不应再出现在建表语句内
    expect(sql).not.toContain('CONSTRAINT "uk_name" UNIQUE')
  })

  it('字段与谓词可由索引级覆盖', () => {
    const common = makeCommon({ enabled: true, field: 'deleted_at' })
    const sql = generateTablePostgreSQL(
      makeTable({ active_only: true, logical_delete: { field: 'is_deleted', predicate: 'is_deleted = 0' } }),
      'public',
      common,
    )
    expect(sql).toContain('WHERE is_deleted = 0;')
  })
})

describe('SQLite', () => {
  it('部分唯一索引：CREATE UNIQUE INDEX ... WHERE', () => {
    const common = makeCommon({ enabled: true, field: 'deleted_at' })
    const sql = generateTableSQLite(makeTable({ active_only: true }), common)
    expect(sql).toContain('CREATE UNIQUE INDEX "uk_name" ON "users" ("name") WHERE deleted_at IS NULL;')
    expect(sql).not.toContain('CONSTRAINT "uk_name" UNIQUE')
  })
})
