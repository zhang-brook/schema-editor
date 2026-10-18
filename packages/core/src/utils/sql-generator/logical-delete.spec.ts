import { describe, it, expect } from 'vitest'
import type { CommonConfig, Index, LogicalDeleteConfig, Table } from '../../types/schema'
import { generateTableMySQL } from './mysql'
import { generateTablePostgreSQL } from './postgresql'
import { generateTableSQLite } from './sqlite'

/**
 * Regression tests for logical delete × unique index:
 * A unique index only sees physical rows, so re-inserting the same business key after a soft delete hits Duplicate entry.
 * Each dialect works around this differently; the resulting shape is asserted per dialect here.
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

describe('unchanged when logical delete is not enabled', () => {
  const common = makeCommon({ enabled: false, field: 'deleted_at' })

  it('MySQL still uses a plain unique index', () => {
    const sql = generateTableMySQL(makeTable({ active_only: true }), common)
    expect(sql).toContain('UNIQUE KEY `uk_name` (`name`)')
    expect(sql).not.toContain('IF(')
  })

  it('PostgreSQL still uses an in-table UNIQUE constraint', () => {
    const sql = generateTablePostgreSQL(makeTable({ active_only: true }), 'public', common)
    expect(sql).toContain('CONSTRAINT "uk_name" UNIQUE ("name")')
    expect(sql).not.toContain('WHERE')
  })
})

describe('degrades when the logical delete field is absent from the table', () => {
  const common = makeCommon({ enabled: true, field: 'deleted_at' })
  const table: Table = {
    name: 'users',
    comment: '用户表',
    fields: [{ field_name: 'name', field_type: 'varchar', field_length: 100 }],
    indexes: [{ name: 'uk_name', type: 'unique', columns: [{ name: 'name' }], active_only: true }],
  }

  it('PostgreSQL falls back to an in-table UNIQUE constraint', () => {
    expect(generateTablePostgreSQL(table, 'public', common)).toContain('CONSTRAINT "uk_name" UNIQUE ("name")')
  })
})

describe('MySQL', () => {
  it('functional index: deleted rows map to NULL', () => {
    const common = makeCommon({ enabled: true, field: 'deleted_at', mysql_strategy: 'functional' })
    const sql = generateTableMySQL(makeTable({ active_only: true }), common)
    expect(sql).toContain('UNIQUE KEY `uk_name` ((IF(`deleted_at` IS NULL, `name`, NULL)))')
  })

  it('delete column merged into the index columns (5.7 compatible)', () => {
    const common = makeCommon({ enabled: true, field: 'deleted_at', mysql_strategy: 'timestamp_union' })
    const sql = generateTableMySQL(makeTable({ active_only: true }), common)
    expect(sql).toContain('UNIQUE KEY `uk_name` (`name`, `deleted_at`)')
  })

  it('not handled when active_only is not enabled', () => {
    const common = makeCommon({ enabled: true, field: 'deleted_at' })
    expect(generateTableMySQL(makeTable(), common)).toContain('UNIQUE KEY `uk_name` (`name`)')
  })
})

describe('PostgreSQL', () => {
  it('partial unique index: degrades to CREATE UNIQUE INDEX ... WHERE after table creation', () => {
    const common = makeCommon({ enabled: true, field: 'deleted_at' })
    const sql = generateTablePostgreSQL(makeTable({ active_only: true }), 'public', common)
    expect(sql).toContain('CREATE UNIQUE INDEX "uk_name" ON "public"."users" ("name") WHERE deleted_at IS NULL;')
    // A table-level UNIQUE constraint does not support WHERE, so it should no longer appear in the CREATE TABLE statement
    expect(sql).not.toContain('CONSTRAINT "uk_name" UNIQUE')
  })

  it('field and predicate can be overridden at index level', () => {
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
  it('partial unique index: CREATE UNIQUE INDEX ... WHERE', () => {
    const common = makeCommon({ enabled: true, field: 'deleted_at' })
    const sql = generateTableSQLite(makeTable({ active_only: true }), common)
    expect(sql).toContain('CREATE UNIQUE INDEX "uk_name" ON "users" ("name") WHERE deleted_at IS NULL;')
    expect(sql).not.toContain('CONSTRAINT "uk_name" UNIQUE')
  })
})
