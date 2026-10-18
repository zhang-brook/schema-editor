import { describe, it, expect } from 'vitest'
import type { Table, CommonConfig, UnifiedTypeDefinition } from '../../types/schema'
import { parseCreateTableStatements } from './create-table-parser'
import type { ParsedColumn } from './create-table-parser'
import { detectDialect } from './dialect-detector'
import { mapSqlTypeToField } from './type-mapper'
import { generateTableMySQL } from '../sql-generator/mysql'
import { generateTablePostgreSQL } from '../sql-generator/postgresql'
import { generateSchemaSQLite } from '../sql-generator/sqlite'

/**
 * SQL parsing regression tests:
 * Covers CREATE TABLE parsing (assertions on fixed samples), dialect detection,
 * three-level type mapping fallback, and "generate → parse" round-trip consistency.
 */

// ===== Fixed samples: CREATE TABLE parsing =====

describe('parseCreateTableStatements — MySQL fixed sample', () => {
  const sql = `
    DROP TABLE IF EXISTS \`users\`;
    CREATE TABLE \`users\` (
      \`id\` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
      \`name\` varchar(100) NOT NULL COMMENT '用户名',
      \`price\` decimal(10,2) DEFAULT NULL,
      PRIMARY KEY (\`id\`) USING BTREE,
      UNIQUE KEY \`uk_name\` (\`name\`) COMMENT '用户名唯一',
      INDEX \`idx_price\` (\`price\`)
    ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '用户表' ROW_FORMAT = Dynamic;
  `
  const result = parseCreateTableStatements(sql)
  const table = result.tables[0]!

  it('DROP is skipped and exactly one table is parsed', () => {
    expect(result.tables).toHaveLength(1)
    expect(table.name).toBe('users')
  })

  it('parses column type/length/scale (keyword types are uppercased)', () => {
    const id = table.columns.find(c => c.name === 'id')!
    expect(id.rawType).toBe('BIGINT')
    expect(id.notNull).toBe(true)
    expect(id.autoIncrement).toBe(true)
    expect(id.comment).toBe('主键')

    const name = table.columns.find(c => c.name === 'name')!
    expect(name.rawType).toBe('VARCHAR')
    expect(name.length).toBe(100)

    const price = table.columns.find(c => c.name === 'price')!
    expect(price.rawType).toBe('DECIMAL')
    expect(price.length).toBe(10)
    expect(price.scale).toBe(2)
  })

  it('parses primary key / unique key / regular index constraints', () => {
    const pk = table.constraints.find(c => c.type === 'PRIMARY_KEY')!
    expect(pk.columns.map(c => c.name)).toEqual(['id'])

    const uk = table.constraints.find(c => c.type === 'UNIQUE')!
    expect(uk.name).toBe('uk_name')
    expect(uk.columns.map(c => c.name)).toEqual(['name'])
    expect(uk.comment).toBe('用户名唯一')

    const idx = table.constraints.find(c => c.type === 'INDEX')!
    expect(idx.name).toBe('idx_price')
  })

  it('parses table options: engine / comment / rowFormat', () => {
    expect(table.options.engine).toBe('InnoDB')
    expect(table.options.comment).toBe('用户表')
    expect(table.options.rowFormat).toBe('DYNAMIC')
  })
})

describe('parseCreateTableStatements — ON UPDATE CURRENT_TIMESTAMP', () => {
  const sql = `
    CREATE TABLE \`orders\` (
      \`id\` bigint NOT NULL,
      \`last_modified_at\` datetime(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '最后修改时间',
      \`updated_at\` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );
  `
  const result = parseCreateTableStatements(sql)
  const table = result.tables[0]!
  const col = table.columns.find(c => c.name === 'last_modified_at')!
  const plain = table.columns.find(c => c.name === 'updated_at')!

  it('parses ON UPDATE and its precision', () => {
    expect(col.onUpdateCurrentTimestamp).toBe(true)
    expect(col.onUpdateCurrentTimestampPrecision).toBe(3)
    expect(col.defaultValue).toBe('CURRENT_TIMESTAMP(3)')
  })

  it('precision is null when there are no parentheses', () => {
    expect(plain.onUpdateCurrentTimestamp).toBe(true)
    expect(plain.onUpdateCurrentTimestampPrecision).toBeNull()
  })

  it('columns without ON UPDATE are not falsely reported', () => {
    expect(table.columns.find(c => c.name === 'id')!.onUpdateCurrentTimestamp).toBe(false)
  })
})

describe('parseCreateTableStatements — PostgreSQL + COMMENT ON fixed sample', () => {
  const sql = `
    CREATE TABLE "public"."account" (
      "id" SERIAL NOT NULL,
      "email" varchar(255) NOT NULL,
      "balance" numeric(12,2),
      CONSTRAINT "pk_account" PRIMARY KEY ("id"),
      CONSTRAINT "uk_email" UNIQUE ("email")
    );
    COMMENT ON TABLE "public"."account" IS '账户表';
    COMMENT ON COLUMN "public"."account"."email" IS '邮箱';
  `
  const result = parseCreateTableStatements(sql)
  const table = result.tables[0]!

  it('parses schema and table from a qualified name', () => {
    expect(table.schema).toBe('public')
    expect(table.name).toBe('account')
  })

  it('double-quoted identifiers preserve their original case', () => {
    expect(table.columns.map(c => c.name)).toEqual(['id', 'email', 'balance'])
  })

  it('COMMENT ON statements are applied to the table and columns', () => {
    expect(table.comment).toBe('账户表')
    expect(table.columns.find(c => c.name === 'email')!.comment).toBe('邮箱')
  })

  it('named constraints preserve their names', () => {
    expect(table.constraints.find(c => c.type === 'PRIMARY_KEY')!.name).toBe('pk_account')
    expect(table.constraints.find(c => c.type === 'UNIQUE')!.name).toBe('uk_email')
  })
})

// ===== Dialect detection =====

describe('detectDialect — MySQL / PostgreSQL dialect differences asserted separately', () => {
  it('backticks + ENGINE + AUTO_INCREMENT is detected as mysql', () => {
    const mysql = 'CREATE TABLE `t` (`id` bigint NOT NULL AUTO_INCREMENT, PRIMARY KEY (`id`)) ENGINE = InnoDB;'
    expect(detectDialect(mysql)).toBe('mysql')
  })

  it('SERIAL + double quotes + COMMENT ON is detected as postgresql', () => {
    const pg = 'CREATE TABLE "t" ("id" SERIAL NOT NULL, PRIMARY KEY ("id"));\nCOMMENT ON TABLE "t" IS \'x\';'
    expect(detectDialect(pg)).toBe('postgresql')
  })

  it('returns unknown when there are no clear traits', () => {
    expect(detectDialect('CREATE TABLE t (id int, PRIMARY KEY (id));')).toBe('unknown')
  })

  it('AUTOINCREMENT + double quotes is detected as sqlite (not postgresql)', () => {
    const sqlite = 'CREATE TABLE "t" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT);'
    expect(detectDialect(sqlite)).toBe('sqlite')
  })

  it('WITHOUT ROWID is detected as sqlite', () => {
    const sqlite = 'CREATE TABLE "t" ("id" INTEGER PRIMARY KEY, "v" TEXT) WITHOUT ROWID;'
    expect(detectDialect(sqlite)).toBe('sqlite')
  })
})

// ===== Type mapping (three-level fallback + dialect differences) =====

describe('mapSqlTypeToField — unified types and fallback', () => {
  const unifiedTypes: UnifiedTypeDefinition[] = [
    { name: 'ts', mysql: { type: 'datetime' }, postgresql: { type: 'timestamp' }, sqlite: { type: 'TEXT' } },
  ]

  function col(rawType: string, length: number | null = null, scale: number | null = null): ParsedColumn {
    return {
      name: 'c',
      rawType,
      length,
      scale,
      notNull: false,
      autoIncrement: false,
      unique: false,
      primaryKey: false,
      isCommentedOut: false,
      unsigned: false,
      onUpdateCurrentTimestamp: false,
    }
  }

  it('dialect difference: datetime (MySQL) and timestamp (PostgreSQL) hit the same unified type', () => {
    expect(mapSqlTypeToField(col('datetime'), 'mysql', unifiedTypes).unified_type).toBe('ts')
    expect(mapSqlTypeToField(col('timestamp'), 'postgresql', unifiedTypes).unified_type).toBe('ts')
  })

  it('falls back to the raw type when nothing matches (Level 3), preserving length', () => {
    const r = mapSqlTypeToField(col('varchar', 200), 'mysql', unifiedTypes)
    expect(r.unified_type).toBeUndefined()
    expect(r.field_type).toBe('VARCHAR')
    expect(r.field_length).toBe(200)
  })

  it('Level 3 fallback preserves the raw type name (uppercased)', () => {
    const r = mapSqlTypeToField(col('int4'), 'postgresql', unifiedTypes)
    expect(r.field_type).toBe('INT4')
  })

  it('SQLite: normalized by type affinity (VARCHAR → TEXT) then matches the unified type', () => {
    const ut: UnifiedTypeDefinition[] = [
      { name: 'str', mysql: { type: 'varchar' }, postgresql: { type: 'varchar' }, sqlite: { type: 'TEXT' } },
    ]
    const r = mapSqlTypeToField(col('varchar', 255), 'sqlite', ut)
    expect(r.unified_type).toBe('str')
    expect(r.field_length).toBe(255)
  })

  it('SQLite: falls back to the raw type when nothing matches; INTEGER is treated as parameterless', () => {
    const r = mapSqlTypeToField(col('integer'), 'sqlite', [])
    expect(r.unified_type).toBeUndefined()
    expect(r.field_type).toBe('INTEGER')
    expect(r.field_length_disabled).toBe(true)
  })
})

// ===== Round trip: generate → parse =====

describe('round-trip consistency: generate → parse', () => {
  const commonConfig: CommonConfig = {
    default_config: {
      table_ddl_mode: 'create',
      mysql: {
        database: {},
        table: { mysql_engine: 'InnoDB', mysql_charset: 'utf8mb4', mysql_collation: 'utf8mb4_general_ci' },
      },
      postgresql: { quote_identifiers: true },
    },
    common_used_fields: {},
  }

  const table: Table = {
    name: 'users',
    comment: '用户表',
    fields: [
      { field_name: 'id', field_type: 'int', primary_key: true, not_null: true },
      { field_name: 'name', field_type: 'varchar', field_length: 100, not_null: true },
    ],
    indexes: [
      { name: 'uk_name', type: 'unique', columns: [{ name: 'name' }] },
    ],
  }

  it('MySQL-generated SQL is detected as mysql and parses back to the original table', () => {
    const sql = generateTableMySQL(table, commonConfig)
    expect(detectDialect(sql)).toBe('mysql')
    const parsed = parseCreateTableStatements(sql).tables[0]!
    expect(parsed.name).toBe('users')
    expect(parsed.columns.map(c => c.name)).toEqual(['id', 'name'])
  })

  it('PostgreSQL-generated SQL is detected as postgresql and parses back schema.table', () => {
    const sql = generateTablePostgreSQL(table, 'public', commonConfig)
    expect(detectDialect(sql)).toBe('postgresql')
    const parsed = parseCreateTableStatements(sql).tables[0]!
    expect(parsed.name).toBe('users')
    expect(parsed.schema).toBe('public')
    expect(parsed.columns.map(c => c.name)).toEqual(['id', 'name'])
  })

  it('SQLite-generated SQL is detected as sqlite and parses back the original table (no schema prefix)', () => {
    const sql = generateSchemaSQLite({ schema: 'public', tables: [table] }, commonConfig)
    expect(detectDialect(sql)).toBe('sqlite')
    const parsed = parseCreateTableStatements(sql).tables[0]!
    expect(parsed.name).toBe('users')
    expect(parsed.columns.map(c => c.name)).toEqual(['id', 'name'])
  })
})
