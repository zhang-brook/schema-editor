import { describe, it, expect } from 'vitest'
import type { Table, CommonConfig, Index } from '../../types/schema'
import { generateTableMySQL } from './mysql'
import { generateTablePostgreSQL } from './postgresql'
import { generateTableSQLite } from './sqlite'

/**
 * Regression tests for CREATE TABLE statement generation:
 * Covers field type mapping (including unified_types), primary keys, unique keys, COMMENT, and indexes,
 * with separate assertions for the dialect differences between MySQL, PostgreSQL, and SQLite.
 */

// Unified type: the same top-level type maps to different SQL types in the three dialects (used for dialect difference assertions)
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
      // Unified type: MySQL→datetime, PostgreSQL→timestamp
      { field_name: 'created_at', unified_type: 'ts' },
    ],
    indexes: [
      // Single-column unique index
      { name: 'uk_name', type: 'unique', columns: [{ name: 'name' }], comment: '用户名唯一' },
      // Plain composite index
      { name: 'idx_price_created', type: 'index', columns: [{ name: 'price' }, { name: 'created_at' }] },
    ],
  }
}

describe('generateTableMySQL', () => {
  const sql = generateTableMySQL(makeUsersTable(), commonConfig)

  it('field type mapping: bare types with length/scale', () => {
    expect(sql).toContain('`id` int')
    expect(sql).toContain('`name` varchar(100)')
    expect(sql).toContain('`price` decimal(10,2)')
  })

  it('unified type resolves to the MySQL dialect type datetime', () => {
    expect(sql).toContain('`created_at` datetime')
    expect(sql).not.toContain('timestamp')
  })

  it('primary key: PRIMARY KEY ... USING BTREE', () => {
    expect(sql).toContain('PRIMARY KEY (`id`) USING BTREE')
  })

  it('single-column unique key uses UNIQUE KEY with a name and COMMENT', () => {
    expect(sql).toContain("UNIQUE KEY `uk_name` (`name`) COMMENT '用户名唯一'")
  })

  it('plain composite index uses an INDEX definition', () => {
    expect(sql).toContain('INDEX `idx_price_created` (`price`, `created_at`)')
  })

  it('field-level COMMENT is inlined, table-level COMMENT = ...', () => {
    expect(sql).toContain("COMMENT '主键'")
    expect(sql).toContain("COMMENT = '用户表'")
  })

  it('no DROP TABLE when ddl mode=create', () => {
    expect(sql).toContain('CREATE TABLE `users`')
    expect(sql).not.toContain('DROP TABLE')
  })
})

describe('MySQL ON UPDATE CURRENT_TIMESTAMP', () => {
  function makeTimestampTable(field: Partial<Table['fields'][number]>): Table {
    return {
      name: 'orders',
      comment: '订单表',
      fields: [
        { field_name: 'id', field_type: 'int', primary_key: true },
        { field_name: 'last_modified_at', field_type: 'datetime', field_length: 3, default: 'CURRENT_TIMESTAMP', ...field },
      ],
      indexes: [],
    }
  }

  it('outputs ON UPDATE CURRENT_TIMESTAMP(3) when enabled with precision', () => {
    const sql = generateTableMySQL(
      makeTimestampTable({ on_update_current_timestamp: true, on_update_current_timestamp_precision: 3 }),
      commonConfig,
    )
    expect(sql).toContain(
      '`last_modified_at` datetime(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)',
    )
  })

  it('no parentheses when precision is not set', () => {
    const sql = generateTableMySQL(makeTimestampTable({ on_update_current_timestamp: true }), commonConfig)
    expect(sql).toMatch(/ON UPDATE CURRENT_TIMESTAMP\b(?!\()/)
  })

  it('no ON UPDATE when not enabled', () => {
    const sql = generateTableMySQL(makeTimestampTable({}), commonConfig)
    expect(sql).not.toContain('ON UPDATE')
  })

  it('PostgreSQL / SQLite do not output ON UPDATE', () => {
    const table = makeTimestampTable({ on_update_current_timestamp: true, on_update_current_timestamp_precision: 3 })
    expect(generateTablePostgreSQL(table, 'public', commonConfig)).not.toContain('ON UPDATE')
    expect(generateTableSQLite(table, commonConfig)).not.toContain('ON UPDATE')
  })
})

describe('generateTablePostgreSQL', () => {
  const sql = generateTablePostgreSQL(makeUsersTable(), 'public', commonConfig)

  it('fields use double-quoted identifiers', () => {
    expect(sql).toContain('"id" int')
    expect(sql).toContain('"name" varchar(100)')
    expect(sql).toContain('"price" decimal(10,2)')
  })

  it('unified type resolves to the PostgreSQL dialect type timestamp', () => {
    expect(sql).toContain('"created_at" timestamp')
    expect(sql).not.toContain('datetime')
  })

  it('primary key: PRIMARY KEY (no USING BTREE)', () => {
    expect(sql).toContain('PRIMARY KEY ("id")')
    expect(sql).not.toContain('USING BTREE')
  })

  it('unique index uses CONSTRAINT ... UNIQUE', () => {
    expect(sql).toContain('CONSTRAINT "uk_name" UNIQUE ("name")')
  })

  it('plain index uses a standalone CREATE INDEX statement', () => {
    expect(sql).toContain('CREATE INDEX "idx_price_created" ON "public"."users" ("price", "created_at");')
  })

  it('table/field comments use COMMENT ON statements', () => {
    expect(sql).toContain(`COMMENT ON TABLE "public"."users" IS '用户表';`)
    expect(sql).toContain(`COMMENT ON COLUMN "public"."users"."name" IS '用户名';`)
  })
})

describe('generateTableSQLite', () => {
  const sql = generateTableSQLite(makeUsersTable(), commonConfig)

  it('fields use double-quoted identifiers and the table name has no schema prefix', () => {
    expect(sql).toContain('"id" int')
    expect(sql).toContain('"name" varchar(100)')
    expect(sql).toContain('"price" decimal(10,2)')
    expect(sql).toContain('CREATE TABLE "users"')
    expect(sql).not.toContain('public')
  })

  it('unified type resolves to the SQLite dialect type TEXT', () => {
    expect(sql).toContain('"created_at" TEXT')
    expect(sql).not.toContain('datetime')
    expect(sql).not.toContain('timestamp')
  })

  it('primary key: PRIMARY KEY (no USING BTREE)', () => {
    expect(sql).toContain('PRIMARY KEY ("id")')
    expect(sql).not.toContain('USING BTREE')
  })

  it('unique index uses CONSTRAINT ... UNIQUE', () => {
    expect(sql).toContain('CONSTRAINT "uk_name" UNIQUE ("name")')
  })

  it('plain index uses a standalone CREATE INDEX statement (no schema prefix, no USING)', () => {
    expect(sql).toContain('CREATE INDEX "idx_price_created" ON "users" ("price", "created_at");')
  })

  it('no COMMENT syntax: table comment goes into the table header comment block, field comments are emitted as -- lines', () => {
    expect(sql).toContain('-- 用户表')
    expect(sql).toContain('-- 主键')
    expect(sql).toContain('-- 用户名')
    expect(sql).not.toContain('COMMENT ON')
    expect(sql).not.toContain("COMMENT '")
  })

  it('no DROP TABLE when ddl mode=create', () => {
    expect(sql).not.toContain('DROP TABLE')
  })
})

describe('MySQL / PostgreSQL / SQLite dialect differences', () => {
  const table = makeUsersTable()
  const mysql = generateTableMySQL(table, commonConfig)
  const pg = generateTablePostgreSQL(table, 'public', commonConfig)

  it('different identifier quoting: backticks vs double quotes', () => {
    expect(mysql).toContain('`users`')
    expect(pg).toContain('"users"')
    expect(mysql).not.toContain('"users"')
    expect(pg).not.toContain('`users`')
  })

  it('different comment strategies: MySQL inline COMMENT vs PostgreSQL COMMENT ON', () => {
    expect(mysql).toContain("COMMENT = '用户表'")
    expect(mysql).not.toContain('COMMENT ON TABLE')
    expect(pg).toContain('COMMENT ON TABLE')
    expect(pg).not.toContain("COMMENT = '用户表'")
  })

  it('PostgreSQL does not add double quotes when quote_identifiers=false', () => {
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

  it('SQLite does not add double quotes when quote_identifiers=false', () => {
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

describe('automatic fallback generation when an index name is missing', () => {
  // Mirrors the real state where a new index in the UI has no name / an imported SQL constraint has no name
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
      // name missing: composite unique index (MySQL multi-column goes through UNIQUE INDEX, and the name participates in the output)
      { type: 'unique', columns: [{ name: 'tenant_code' }, { name: 'user_code' }] },
      // name missing: plain index
      { type: 'index', columns: [{ name: 'balance' }] },
    ],
  }

  it('MySQL: omits the index name when name is missing, does not output undefined', () => {
    const sql = generateTableMySQL(table, commonConfig)
    expect(sql).toContain('UNIQUE INDEX (`tenant_code`, `user_code`)')
    expect(sql).toContain('INDEX (`balance`)')
    expect(sql).not.toContain('undefined')
  })

  it('PostgreSQL: falls back to "prefix + table name + column names"', () => {
    const sql = generateTablePostgreSQL(table, 'public', commonConfig)
    expect(sql).toContain('CONSTRAINT "uk__user_wallet__tenant_code_user_code" UNIQUE ("tenant_code", "user_code")')
    expect(sql).toContain('CREATE INDEX "idx__user_wallet__balance" ON "public"."user_wallet" ("balance");')
    expect(sql).not.toContain('undefined')
  })

  it('SQLite: falls back to "prefix + column names", does not output undefined', () => {
    const sql = generateTableSQLite(table, commonConfig)
    expect(sql).toContain('CONSTRAINT "uk_tenant_code_user_code" UNIQUE ("tenant_code", "user_code")')
    expect(sql).toContain('CREATE INDEX "idx_balance" ON "user_wallet" ("balance");')
    expect(sql).not.toContain('undefined')
  })
})

describe('MySQL single-column unique index name and USING output', () => {
  function makeTable(overrides: Partial<Index>): Table {
    return {
      name: 'system_user',
      comment: '系统用户',
      fields: [
        { field_name: 'id', field_type: 'bigint', primary_key: true, not_null: true },
        { field_name: 'username', field_type: 'varchar', field_length: 255, not_null: true },
      ],
      indexes: [{ type: 'unique', columns: [{ name: 'username' }], ...overrides }],
    }
  }

  it('outputs UNIQUE KEY `name` (`col`) when a name (with {pre} placeholder) is specified', () => {
    const sql = generateTableMySQL(makeTable({ name: '{pre}username' }), commonConfig)
    expect(sql).toContain('UNIQUE KEY `uk_username` (`username`)')
  })

  it('outputs USING BTREE when using is also specified', () => {
    const sql = generateTableMySQL(makeTable({ name: 'uk_username', using: 'BTREE' }), commonConfig)
    expect(sql).toContain('UNIQUE KEY `uk_username` (`username`) USING BTREE')
  })

  it('still omits the name when it is empty, leaving naming to MySQL', () => {
    const sql = generateTableMySQL(makeTable({}), commonConfig)
    expect(sql).toContain('UNIQUE KEY (`username`)')
    expect(sql).not.toContain('uk_')
  })
})

describe('no name is specified when the index uses the "default" option', () => {
  // Mirrors checking the "default" checkbox in the UI: even if a name / placeholder is filled in, it must not appear in the SQL
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
      { name: 'uk_custom', use_default_name: true, type: 'unique', columns: [{ name: 'tenant_code' }, { name: 'user_code' }] },
      { name: '{pre}my_balance{post}', use_default_name: true, type: 'index', columns: [{ name: 'balance' }] },
      // The dialect-overridden name is ignored as well
      { name: 'idx_x', use_default_name: true, type: 'index', columns: [{ name: 'balance' }], postgresql: { name: 'pg_custom' } },
    ],
  }

  it('MySQL: omits the index name, does not output the configured name', () => {
    const sql = generateTableMySQL(table, commonConfig)
    expect(sql).toContain('UNIQUE INDEX (`tenant_code`, `user_code`)')
    expect(sql).toContain('INDEX (`balance`)')
    expect(sql).not.toContain('uk_custom')
    expect(sql).not.toContain('my_balance')
    expect(sql).not.toContain('undefined')
  })

  it('PostgreSQL: falls back to "prefix + table name + column names", the dialect-overridden name is ignored', () => {
    const sql = generateTablePostgreSQL(table, 'public', commonConfig)
    expect(sql).toContain('CONSTRAINT "uk__user_wallet__tenant_code_user_code" UNIQUE ("tenant_code", "user_code")')
    expect(sql).toContain('CREATE INDEX "idx__user_wallet__balance" ON "public"."user_wallet" ("balance");')
    expect(sql).not.toContain('pg_custom')
  })

  it('SQLite: falls back to "prefix + column names"', () => {
    const sql = generateTableSQLite(table, commonConfig)
    expect(sql).toContain('CONSTRAINT "uk_tenant_code_user_code" UNIQUE ("tenant_code", "user_code")')
    expect(sql).toContain('CREATE INDEX "idx_balance" ON "user_wallet" ("balance");')
  })
})

describe('treated as unspecified when the index core name is cleared (only placeholders remain)', () => {
  // After clearing the core name in the UI, name becomes {pre}{post} and must not expand to a bare uk_ / idx_ prefix
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
      { name: '{pre}{post}', type: 'unique', columns: [{ name: 'tenant_code' }, { name: 'user_code' }] },
      { name: '{pre}{post}', type: 'index', columns: [{ name: 'balance' }] },
    ],
  }

  it('MySQL: does not output a bare prefix, omits the index name entirely', () => {
    const sql = generateTableMySQL(table, commonConfig)
    expect(sql).toContain('UNIQUE INDEX (`tenant_code`, `user_code`)')
    expect(sql).toContain('INDEX (`balance`)')
    expect(sql).not.toContain('`uk_`')
    expect(sql).not.toContain('`idx_`')
  })

  it('PostgreSQL / SQLite: falls back to "prefix + column names"', () => {
    expect(generateTablePostgreSQL(table, 'public', commonConfig))
      .toContain('CONSTRAINT "uk__user_wallet__tenant_code_user_code" UNIQUE')
    expect(generateTableSQLite(table, commonConfig))
      .toContain('CREATE INDEX "idx_balance" ON "user_wallet" ("balance");')
  })
})

describe('index name {pre}/{post} placeholder resolution', () => {
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
        // Multi-column unique index (MySQL multi-column goes through UNIQUE INDEX, and the name participates in the output)
        { name: '{pre}code_user{post}', type: 'unique', columns: [{ name: 'code' }, { name: 'user_id' }] },
        // Plain index
        { name: '{pre}user{post}', type: 'index', columns: [{ name: 'user_id' }] },
      ],
    }
  }

  it('MySQL: {pre} → uk_/idx_, {post} → empty', () => {
    const sql = generateTableMySQL(makeTokenTable(), commonConfig)
    expect(sql).toContain('UNIQUE INDEX `uk_code_user` (`code`, `user_id`)')
    expect(sql).toContain('INDEX `idx_user` (`user_id`)')
  })

  it('PostgreSQL: {pre} → uk__<table>__/idx__<table>__, {post} → empty', () => {
    const sql = generateTablePostgreSQL(makeTokenTable(), 'public', commonConfig)
    expect(sql).toContain('CONSTRAINT "uk__orders__code_user" UNIQUE ("code", "user_id")')
    expect(sql).toContain('CREATE INDEX "idx__orders__user" ON "public"."orders" ("user_id");')
  })

  it('SQLite: {pre} → uk_/idx_, {post} → empty', () => {
    const sql = generateTableSQLite(makeTokenTable(), commonConfig)
    expect(sql).toContain('CONSTRAINT "uk_code_user" UNIQUE ("code", "user_id")')
    expect(sql).toContain('CREATE INDEX "idx_user" ON "orders" ("user_id");')
  })
})

describe('field comments containing newlines / special characters', () => {
  function makeMultilineCommentTable(): Table {
    return {
      name: 'notes',
      comment: '备注表',
      fields: [
        {
          field_name: 'content',
          field_type: 'text',
          not_null: true,
          comment: '第一行内容\n第二行：含 \' 引号\n含 \\ 反斜杠',
        },
      ],
      indexes: [],
    }
  }

  it('MySQL: newlines escaped as \\n, quotes doubled, backslashes doubled', () => {
    const sql = generateTableMySQL(makeMultilineCommentTable(), commonConfig)
    // The model holds real characters (real newlines, real backslashes); they are escaped per MySQL rules when rendered to SQL
    expect(sql).toContain("COMMENT '第一行内容\\n第二行：含 '' 引号\\n含 \\\\ 反斜杠'")
  })

  it('MySQL: a real backslash (C:\\new) is escaped to C:\\\\new and not treated as a newline', () => {
    const table: Table = {
      name: 'nodes',
      comment: '节点表',
      fields: [
        {
          field_name: 'attachment_list',
          field_type: 'json',
          not_null: true,
          is_commented_out: true,
          comment: '附件：\n①上传到我们平台的附C:\\new件数组\n②外部附件',
        },
      ],
      indexes: [],
    }
    const sql = generateTableMySQL(table, commonConfig)
    expect(sql).toContain("COMMENT '附件：\\n①上传到我们平台的附C:\\\\new件数组\\n②外部附件'")
  })

  it('SQLite: multiline comments get a -- prefix on every line', () => {
    const sql = generateTableSQLite(makeMultilineCommentTable(), commonConfig)
    expect(sql).toContain('  -- 第一行内容\n  -- 第二行：含 \' 引号\n  -- 含 \\ 反斜杠\n  "content" text NOT NULL')
  })

  it('PostgreSQL: real newlines are output as-is (PG string literals may span lines), single quotes doubled', () => {
    const sql = generateTablePostgreSQL(makeMultilineCommentTable(), 'public', commonConfig)
    expect(sql).toContain("COMMENT ON COLUMN \"public\".\"notes\".\"content\" IS '第一行内容\n第二行：含 '' 引号\n含 \\ 反斜杠';")
    expect(sql).not.toContain("E'")
  })

  it('PostgreSQL: real newlines and real backslashes are both output as-is (no E\'\' escaping)', () => {
    const table: Table = {
      name: 'nodes',
      comment: '节点表',
      fields: [
        {
          field_name: 'attachment_list',
          field_type: 'json',
          not_null: true,
          comment: '附件：\n①上传到我们平台的附C:\\new件数组\n②外部附件',
        },
      ],
      indexes: [],
    }
    const sql = generateTablePostgreSQL(table, 'public', commonConfig)
    expect(sql).toContain(
      "COMMENT ON COLUMN \"public\".\"nodes\".\"attachment_list\" IS '附件：\n①上传到我们平台的附C:\\new件数组\n②外部附件';",
    )
    // A backslash must not be swallowed into a newline
    expect(sql).not.toContain('附C:' + '\n' + 'ew件')
    expect(sql).not.toContain("E'")
  })

  it('PostgreSQL: single quotes in comments are doubled, plain comments introduce no escapes', () => {
    const table: Table = {
      name: 'users',
      comment: "用户's 表",
      fields: [{ field_name: 'name', field_type: 'varchar', field_length: 32 }],
      indexes: [],
    }
    const sql = generateTablePostgreSQL(table, 'public', commonConfig)
    expect(sql).toContain(`COMMENT ON TABLE "public"."users" IS '用户''s 表';`)
  })

  it('PostgreSQL: the whole COMMENT ON COLUMN of a commented-out field gets a -- prefix, removing the prefix makes it executable', () => {
    const table: Table = {
      name: 'nodes',
      comment: '节点表',
      fields: [
        { field_name: 'id', field_type: 'bigint', primary_key: true, not_null: true },
        {
          field_name: 'attachment_list',
          field_type: 'json',
          not_null: true,
          is_commented_out: true,
          comment: '【待定】节点包含的附件：\n①平台附件\n②外部附件',
        },
      ],
      indexes: [],
    }
    const sql = generateTablePostgreSQL(table, 'public', commonConfig)

    // The field line only gets the -- prefix; the comment is not inlined (to avoid duplicating the statement below)
    expect(sql).toContain('  -- "attachment_list" json NOT NULL')
    expect(sql).not.toContain('-- "attachment_list" json NOT NULL COMMENT')
    // The comment is preserved as a commented-out COMMENT ON COLUMN statement; when it spans multiple lines,
    // every line gets the -- prefix, otherwise the second line onward would become executable SQL
    expect(sql).toContain(
      '-- COMMENT ON COLUMN "public"."nodes"."attachment_list" IS \'【待定】节点包含的附件：\n' +
        '-- ①平台附件\n' +
        '-- ②外部附件\';',
    )
    expect(sql).not.toContain('undefined')
  })

  it('PostgreSQL: COMMENT ON COLUMN for fields that are not commented out has no -- prefix', () => {
    const sql = generateTablePostgreSQL(makeUsersTable(), 'public', commonConfig)
    expect(sql).toContain(`COMMENT ON COLUMN "public"."users"."name" IS '用户名';`)
    expect(sql).not.toContain(`-- COMMENT ON COLUMN "public"."users"."name"`)
  })
})
