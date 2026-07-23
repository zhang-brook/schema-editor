import { describe, it, expect } from 'vitest'
import type { Table, CommonConfig, UnifiedTypeDefinition } from '@/types/schema'
import { parseCreateTableStatements } from './create-table-parser'
import type { ParsedColumn } from './create-table-parser'
import { detectDialect } from './dialect-detector'
import { mapSqlTypeToField } from './type-mapper'
import { generateTableMySQL } from '@/utils/sql-generator/mysql'
import { generateTablePostgreSQL } from '@/utils/sql-generator/postgresql'

/**
 * SQL 解析回归测试：
 * 覆盖 CREATE TABLE 解析（固定样例断言）、方言检测、类型映射三级回退，
 * 以及「生成 → 解析」往返一致性。
 */

// ===== 固定样例：CREATE TABLE 解析 =====

describe('parseCreateTableStatements — MySQL 固定样例', () => {
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

  it('DROP 被跳过，仅解析出一张表', () => {
    expect(result.tables).toHaveLength(1)
    expect(table.name).toBe('users')
  })

  it('列类型/长度/scale 解析（关键字类型大写化）', () => {
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

  it('主键 / 唯一键 / 普通索引约束解析', () => {
    const pk = table.constraints.find(c => c.type === 'PRIMARY_KEY')!
    expect(pk.columns.map(c => c.name)).toEqual(['id'])

    const uk = table.constraints.find(c => c.type === 'UNIQUE')!
    expect(uk.name).toBe('uk_name')
    expect(uk.columns.map(c => c.name)).toEqual(['name'])
    expect(uk.comment).toBe('用户名唯一')

    const idx = table.constraints.find(c => c.type === 'INDEX')!
    expect(idx.name).toBe('idx_price')
  })

  it('表选项解析：engine / comment / rowFormat', () => {
    expect(table.options.engine).toBe('InnoDB')
    expect(table.options.comment).toBe('用户表')
    expect(table.options.rowFormat).toBe('DYNAMIC')
  })
})

describe('parseCreateTableStatements — PostgreSQL + COMMENT ON 固定样例', () => {
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

  it('限定名解析出 schema 与 table', () => {
    expect(table.schema).toBe('public')
    expect(table.name).toBe('account')
  })

  it('双引号标识符保留原始大小写', () => {
    expect(table.columns.map(c => c.name)).toEqual(['id', 'email', 'balance'])
  })

  it('COMMENT ON 语句应用到表与列', () => {
    expect(table.comment).toBe('账户表')
    expect(table.columns.find(c => c.name === 'email')!.comment).toBe('邮箱')
  })

  it('命名约束保留名称', () => {
    expect(table.constraints.find(c => c.type === 'PRIMARY_KEY')!.name).toBe('pk_account')
    expect(table.constraints.find(c => c.type === 'UNIQUE')!.name).toBe('uk_email')
  })
})

// ===== 方言检测 =====

describe('detectDialect — MySQL / PostgreSQL 方言差异分别断言', () => {
  it('反引号 + ENGINE + AUTO_INCREMENT 判定为 mysql', () => {
    const mysql = 'CREATE TABLE `t` (`id` bigint NOT NULL AUTO_INCREMENT, PRIMARY KEY (`id`)) ENGINE = InnoDB;'
    expect(detectDialect(mysql)).toBe('mysql')
  })

  it('SERIAL + 双引号 + COMMENT ON 判定为 postgresql', () => {
    const pg = 'CREATE TABLE "t" ("id" SERIAL NOT NULL, PRIMARY KEY ("id"));\nCOMMENT ON TABLE "t" IS \'x\';'
    expect(detectDialect(pg)).toBe('postgresql')
  })

  it('无明显特征时返回 unknown', () => {
    expect(detectDialect('CREATE TABLE t (id int, PRIMARY KEY (id));')).toBe('unknown')
  })
})

// ===== 类型映射（三级回退 + 方言差异）=====

describe('mapSqlTypeToField — 统一类型与回退', () => {
  const unifiedTypes: UnifiedTypeDefinition[] = [
    { name: 'ts', mysql: { type: 'datetime' }, postgresql: { type: 'timestamp' } },
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
    }
  }

  it('方言差异：datetime(MySQL) 与 timestamp(PostgreSQL) 命中同一统一类型', () => {
    expect(mapSqlTypeToField(col('datetime'), 'mysql', unifiedTypes).unified_type).toBe('ts')
    expect(mapSqlTypeToField(col('timestamp'), 'postgresql', unifiedTypes).unified_type).toBe('ts')
  })

  it('无匹配时回退到原始类型（Level 3），并保留长度', () => {
    const r = mapSqlTypeToField(col('varchar', 200), 'mysql', unifiedTypes)
    expect(r.unified_type).toBeUndefined()
    expect(r.field_type).toBe('VARCHAR')
    expect(r.field_length).toBe(200)
  })

  it('Level 3 回退保留原始类型名（大写化）', () => {
    const r = mapSqlTypeToField(col('int4'), 'postgresql', unifiedTypes)
    expect(r.field_type).toBe('INT4')
  })
})

// ===== 往返：生成 → 解析 =====

describe('往返一致性：generate → parse', () => {
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

  it('MySQL 生成结果可被检测为 mysql 并解析出原表', () => {
    const sql = generateTableMySQL(table, commonConfig)
    expect(detectDialect(sql)).toBe('mysql')
    const parsed = parseCreateTableStatements(sql).tables[0]!
    expect(parsed.name).toBe('users')
    expect(parsed.columns.map(c => c.name)).toEqual(['id', 'name'])
  })

  it('PostgreSQL 生成结果可被检测为 postgresql 并解析出 schema.table', () => {
    const sql = generateTablePostgreSQL(table, 'public', commonConfig)
    expect(detectDialect(sql)).toBe('postgresql')
    const parsed = parseCreateTableStatements(sql).tables[0]!
    expect(parsed.name).toBe('users')
    expect(parsed.schema).toBe('public')
    expect(parsed.columns.map(c => c.name)).toEqual(['id', 'name'])
  })
})
