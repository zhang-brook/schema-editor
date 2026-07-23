import { describe, it, expect } from 'vitest'
import type { Table, CommonConfig } from '@/types/schema'
import { generateTableMySQL } from './mysql'
import { generateTablePostgreSQL } from './postgresql'

/**
 * 建表语句生成回归测试：
 * 覆盖字段类型映射（含 unified_types）、主键、唯一键、COMMENT、索引，
 * 并针对 MySQL 与 PostgreSQL 的方言差异分别断言。
 */

// 统一类型：同一顶层类型在两方言映射到不同 SQL 类型（用于方言差异断言）
const commonConfig: CommonConfig = {
  default_config: {
    table_ddl_mode: 'create',
    mysql: {
      database: {},
      table: {
        mysql_engine: 'InnoDB',
        mysql_charset: 'utf8mb4',
        mysql_collation: 'utf8mb4_general_ci',
      },
    },
    postgresql: { quote_identifiers: true },
  },
  common_used_fields: {},
  unified_types: [
    { name: 'ts', mysql: { type: 'datetime' }, postgresql: { type: 'timestamp' } },
  ],
}

function makeUsersTable(): Table {
  return {
    name: 'users',
    comment: '用户表',
    fields: [
      { field_name: 'id', field_type: 'int', primary_key: true, not_null: true, comment: '主键' },
      { field_name: 'name', field_type: 'varchar', field_length: 100, not_null: true, comment: '用户名' },
      { field_name: 'price', field_type: 'decimal', field_length: 10, field_scale: 2 },
      // 统一类型：MySQL→datetime，PostgreSQL→timestamp
      { field_name: 'created_at', unified_type: 'ts' },
    ],
    indexes: [
      // 单列唯一索引
      { name: 'uk_name', type: 'unique', columns: [{ name: 'name' }], comment: '用户名唯一' },
      // 普通复合索引
      { name: 'idx_price_created', type: 'index', columns: [{ name: 'price' }, { name: 'created_at' }] },
    ],
  }
}

describe('generateTableMySQL', () => {
  const sql = generateTableMySQL(makeUsersTable(), commonConfig)

  it('字段类型映射：bare 类型与长度/scale', () => {
    expect(sql).toContain('`id` int')
    expect(sql).toContain('`name` varchar(100)')
    expect(sql).toContain('`price` decimal(10,2)')
  })

  it('统一类型解析为 MySQL 方言类型 datetime', () => {
    expect(sql).toContain('`created_at` datetime')
    expect(sql).not.toContain('timestamp')
  })

  it('主键：PRIMARY KEY ... USING BTREE', () => {
    expect(sql).toContain('PRIMARY KEY (`id`) USING BTREE')
  })

  it('单列唯一键使用 UNIQUE KEY 并携带 COMMENT', () => {
    expect(sql).toContain("UNIQUE KEY (`name`) COMMENT '用户名唯一'")
  })

  it('普通复合索引使用 INDEX 定义', () => {
    expect(sql).toContain('INDEX `idx_price_created` (`price`, `created_at`)')
  })

  it('字段级 COMMENT 内联输出、表级 COMMENT = ...', () => {
    expect(sql).toContain("COMMENT '主键'")
    expect(sql).toContain("COMMENT = '用户表'")
  })

  it('ddl mode=create 时不生成 DROP TABLE', () => {
    expect(sql).toContain('CREATE TABLE `users`')
    expect(sql).not.toContain('DROP TABLE')
  })
})

describe('generateTablePostgreSQL', () => {
  const sql = generateTablePostgreSQL(makeUsersTable(), 'public', commonConfig)

  it('字段使用双引号标识符', () => {
    expect(sql).toContain('"id" int')
    expect(sql).toContain('"name" varchar(100)')
    expect(sql).toContain('"price" decimal(10,2)')
  })

  it('统一类型解析为 PostgreSQL 方言类型 timestamp', () => {
    expect(sql).toContain('"created_at" timestamp')
    expect(sql).not.toContain('datetime')
  })

  it('主键：PRIMARY KEY (无 USING BTREE)', () => {
    expect(sql).toContain('PRIMARY KEY ("id")')
    expect(sql).not.toContain('USING BTREE')
  })

  it('唯一索引使用 CONSTRAINT ... UNIQUE', () => {
    expect(sql).toContain('CONSTRAINT "uk_name" UNIQUE ("name")')
  })

  it('普通索引使用独立 CREATE INDEX 语句', () => {
    expect(sql).toContain('CREATE INDEX "idx_price_created" ON "public"."users" ("price", "created_at");')
  })

  it('表/字段注释使用 COMMENT ON 语句', () => {
    expect(sql).toContain(`COMMENT ON TABLE "public"."users" IS '用户表';`)
    expect(sql).toContain(`COMMENT ON COLUMN "public"."users"."name" IS '用户名';`)
  })
})

describe('MySQL / PostgreSQL 方言差异', () => {
  const table = makeUsersTable()
  const mysql = generateTableMySQL(table, commonConfig)
  const pg = generateTablePostgreSQL(table, 'public', commonConfig)

  it('标识符引用符不同：反引号 vs 双引号', () => {
    expect(mysql).toContain('`users`')
    expect(pg).toContain('"users"')
    expect(mysql).not.toContain('"users"')
    expect(pg).not.toContain('`users`')
  })

  it('注释策略不同：MySQL 内联 COMMENT vs PostgreSQL COMMENT ON', () => {
    expect(mysql).toContain("COMMENT = '用户表'")
    expect(mysql).not.toContain('COMMENT ON TABLE')
    expect(pg).toContain('COMMENT ON TABLE')
    expect(pg).not.toContain("COMMENT = '用户表'")
  })

  it('quote_identifiers=false 时 PostgreSQL 不加双引号', () => {
    const cfg: CommonConfig = {
      ...commonConfig,
      default_config: {
        ...commonConfig.default_config,
        postgresql: { quote_identifiers: false },
      },
    }
    const raw = generateTablePostgreSQL(table, 'public', cfg)
    expect(raw).toContain('CREATE TABLE public.users (')
    expect(raw).not.toContain('"users"')
  })
})
