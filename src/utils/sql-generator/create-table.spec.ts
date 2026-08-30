import { describe, it, expect } from 'vitest'
import type { Table, CommonConfig } from '@/types/schema'
import { generateTableMySQL } from './mysql'
import { generateTablePostgreSQL } from './postgresql'
import { generateTableSQLite } from './sqlite'

/**
 * 建表语句生成回归测试：
 * 覆盖字段类型映射（含 unified_types）、主键、唯一键、COMMENT、索引，
 * 并针对 MySQL、PostgreSQL 与 SQLite 的方言差异分别断言。
 */

// 统一类型：同一顶层类型在三方言映射到不同 SQL 类型（用于方言差异断言）
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
    sqlite: { quote_identifiers: true },
  },
  common_used_fields: {},
  unified_types: [
    { name: 'ts', mysql: { type: 'datetime' }, postgresql: { type: 'timestamp' }, sqlite: { type: 'TEXT' } },
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

describe('generateTableSQLite', () => {
  const sql = generateTableSQLite(makeUsersTable(), commonConfig)

  it('字段使用双引号标识符，且表名不带 schema 前缀', () => {
    expect(sql).toContain('"id" int')
    expect(sql).toContain('"name" varchar(100)')
    expect(sql).toContain('"price" decimal(10,2)')
    expect(sql).toContain('CREATE TABLE "users"')
    expect(sql).not.toContain('public')
  })

  it('统一类型解析为 SQLite 方言类型 TEXT', () => {
    expect(sql).toContain('"created_at" TEXT')
    expect(sql).not.toContain('datetime')
    expect(sql).not.toContain('timestamp')
  })

  it('主键：PRIMARY KEY（无 USING BTREE）', () => {
    expect(sql).toContain('PRIMARY KEY ("id")')
    expect(sql).not.toContain('USING BTREE')
  })

  it('唯一索引使用 CONSTRAINT ... UNIQUE', () => {
    expect(sql).toContain('CONSTRAINT "uk_name" UNIQUE ("name")')
  })

  it('普通索引使用独立 CREATE INDEX 语句（不带 schema 前缀、无 USING）', () => {
    expect(sql).toContain('CREATE INDEX "idx_price_created" ON "users" ("price", "created_at");')
  })

  it('无 COMMENT 语法：表注释落在表头注释块，字段注释以 -- 行输出', () => {
    expect(sql).toContain('-- 用户表')
    expect(sql).toContain('-- 主键')
    expect(sql).toContain('-- 用户名')
    expect(sql).not.toContain('COMMENT ON')
    expect(sql).not.toContain("COMMENT '")
  })

  it('ddl mode=create 时不生成 DROP TABLE', () => {
    expect(sql).not.toContain('DROP TABLE')
  })
})

describe('MySQL / PostgreSQL / SQLite 方言差异', () => {
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

  it('quote_identifiers=false 时 SQLite 不加双引号', () => {
    const cfg: CommonConfig = {
      ...commonConfig,
      default_config: {
        ...commonConfig.default_config,
        sqlite: { quote_identifiers: false },
      },
    }
    const raw = generateTableSQLite(table, cfg)
    expect(raw).toContain('CREATE TABLE users (')
    expect(raw).not.toContain('"users"')
  })
})

describe('索引未填写名称时自动回退生成', () => {
  // 对应 UI 新建索引不填名字 / SQL 导入无名字约束的真实状态
  const table: Table = {
    name: 'user_wallet',
    comment: '用户钱包表',
    fields: [
      { field_name: 'id', field_type: 'bigint', primary_key: true, not_null: true },
      { field_name: 'tenant_code', field_type: 'varchar', field_length: 100 },
      { field_name: 'user_code', field_type: 'varchar', field_length: 100 },
      { field_name: 'balance', field_type: 'bigint' },
    ],
    indexes: [
      // name 缺失：复合唯一索引（MySQL 多列走 UNIQUE INDEX，名称参与输出）
      { type: 'unique', columns: [{ name: 'tenant_code' }, { name: 'user_code' }] },
      // name 缺失：普通索引
      { type: 'index', columns: [{ name: 'balance' }] },
    ],
  }

  it('MySQL：name 缺失时省略索引名，不输出 undefined', () => {
    const sql = generateTableMySQL(table, commonConfig)
    expect(sql).toContain('UNIQUE INDEX (`tenant_code`, `user_code`)')
    expect(sql).toContain('INDEX (`balance`)')
    expect(sql).not.toContain('undefined')
  })

  it('PostgreSQL：回退为「前缀 + 表名 + 列名拼接」', () => {
    const sql = generateTablePostgreSQL(table, 'public', commonConfig)
    expect(sql).toContain('CONSTRAINT "uk__user_wallet__tenant_code_user_code" UNIQUE ("tenant_code", "user_code")')
    expect(sql).toContain('CREATE INDEX "idx__user_wallet__balance" ON "public"."user_wallet" ("balance");')
    expect(sql).not.toContain('undefined')
  })

  it('SQLite：回退为「前缀 + 列名拼接」，不输出 undefined', () => {
    const sql = generateTableSQLite(table, commonConfig)
    expect(sql).toContain('CONSTRAINT "uk_tenant_code_user_code" UNIQUE ("tenant_code", "user_code")')
    expect(sql).toContain('CREATE INDEX "idx_balance" ON "user_wallet" ("balance");')
    expect(sql).not.toContain('undefined')
  })
})

describe('索引名 {pre}/{post} 占位符解析', () => {
  function makeTokenTable(): Table {
    return {
      name: 'orders',
      comment: '订单表',
      fields: [
        { field_name: 'id', field_type: 'int', primary_key: true, not_null: true },
        { field_name: 'code', field_type: 'varchar', field_length: 32 },
        { field_name: 'user_id', field_type: 'int' },
      ],
      indexes: [
        // 多列唯一索引（MySQL 多列走 UNIQUE INDEX，名称参与输出）
        { name: '{pre}code_user{post}', type: 'unique', columns: [{ name: 'code' }, { name: 'user_id' }] },
        // 普通索引
        { name: '{pre}user{post}', type: 'index', columns: [{ name: 'user_id' }] },
      ],
    }
  }

  it('MySQL：{pre} → uk_/idx_，{post} → 空', () => {
    const sql = generateTableMySQL(makeTokenTable(), commonConfig)
    expect(sql).toContain('UNIQUE INDEX `uk_code_user` (`code`, `user_id`)')
    expect(sql).toContain('INDEX `idx_user` (`user_id`)')
  })

  it('PostgreSQL：{pre} → uk__<table>__/idx__<table>__，{post} → 空', () => {
    const sql = generateTablePostgreSQL(makeTokenTable(), 'public', commonConfig)
    expect(sql).toContain('CONSTRAINT "uk__orders__code_user" UNIQUE ("code", "user_id")')
    expect(sql).toContain('CREATE INDEX "idx__orders__user" ON "public"."orders" ("user_id");')
  })

  it('SQLite：{pre} → uk_/idx_，{post} → 空', () => {
    const sql = generateTableSQLite(makeTokenTable(), commonConfig)
    expect(sql).toContain('CONSTRAINT "uk_code_user" UNIQUE ("code", "user_id")')
    expect(sql).toContain('CREATE INDEX "idx_user" ON "orders" ("user_id");')
  })
})
