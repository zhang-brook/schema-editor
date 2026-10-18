import { describe, expect, it } from 'vitest'
import type { CommonConfig, Schema, Table } from '../../types/schema'
import { generateInitialDataMySQL, generateInitialDataAllMySQL } from './mysql'
import { generateInitialDataPostgreSQL } from './postgresql'
import { generateInitialDataSQLite } from './sqlite'

function usersTable(extra: Partial<Table> = {}): Table {
  return {
    name: 'users',
    comment: '',
    fields: [
      { field_name: 'id', field_type: 'int', primary_key: true },
      { field_name: 'name', field_type: 'varchar' },
      { field_name: 'email', field_type: 'varchar' },
    ],
    indexes: [],
    ...extra,
  }
}

const rows = [{ id: 1, name: 'Alice', email: 'alice@example.com' }]

const commonConfig: CommonConfig = {
  default_config: {
    mysql: {
      database: {},
      table: { mysql_engine: '', mysql_charset: '', mysql_collation: '' },
    },
    postgresql: { quote_identifiers: true },
  },
  common_used_fields: {
    id: { field_name: 'id', field_type: 'int', primary_key: true },
  },
}

describe('MySQL initial data insert modes', () => {
  it('generates a plain INSERT by default', () => {
    expect(generateInitialDataMySQL(usersTable(), rows)).toBe(
      "INSERT INTO `users` (`id`, `name`, `email`) VALUES\n  (1, 'Alice', 'alice@example.com');\n",
    )
  })

  it('generates INSERT IGNORE for ignore mode', () => {
    expect(generateInitialDataMySQL(usersTable(), rows, undefined, undefined, null, 'ignore')).toBe(
      "INSERT IGNORE INTO `users` (`id`, `name`, `email`) VALUES\n  (1, 'Alice', 'alice@example.com');\n",
    )
  })

  it('updates non-primary-key columns on duplicate keys for overwrite mode', () => {
    expect(generateInitialDataMySQL(usersTable(), rows, undefined, undefined, null, 'overwrite')).toBe(
      "INSERT INTO `users` (`id`, `name`, `email`) VALUES\n  (1, 'Alice', 'alice@example.com')\n"
      + 'ON DUPLICATE KEY UPDATE\n  `name` = VALUES(`name`),\n  `email` = VALUES(`email`);\n',
    )
  })

  it('falls back to a no-op assignment when the table only has primary-key columns', () => {
    const table = usersTable({
      fields: [{ field_name: 'id', field_type: 'int', primary_key: true }],
    })
    expect(generateInitialDataMySQL(table, [{ id: 1 }], undefined, undefined, null, 'overwrite')).toBe(
      'INSERT INTO `users` (`id`) VALUES\n  (1)\nON DUPLICATE KEY UPDATE\n  `id` = VALUES(`id`);\n',
    )
  })

  it('resolves primary-key columns from common fields', () => {
    const table = usersTable({
      fields: [
        { field_name: 'id', use_common_used_fields: true },
        { field_name: 'name', field_type: 'varchar' },
      ],
    })
    expect(generateInitialDataMySQL(table, [{ id: 1, name: 'Alice' }], undefined, undefined, commonConfig, 'overwrite')).toBe(
      "INSERT INTO `users` (`id`, `name`) VALUES\n  (1, 'Alice')\n"
      + 'ON DUPLICATE KEY UPDATE\n  `name` = VALUES(`name`);\n',
    )
  })

  it('passes the table insert mode through the whole-schema generator', () => {
    const schemas: Schema[] = [{ schema: 'app', tables: [usersTable()] }]
    const initialDataMap = new Map([['app/users', { rows: [{ data: rows[0]! }], insert_mode: 'ignore' as const }]])
    expect(generateInitialDataAllMySQL(schemas, initialDataMap, null)).toContain('INSERT IGNORE INTO `users`')
  })
})

describe('PostgreSQL initial data insert modes', () => {
  it('generates a plain INSERT by default', () => {
    expect(generateInitialDataPostgreSQL(usersTable(), 'app', rows, undefined, null)).toBe(
      'INSERT INTO "app"."users" ("id", "name", "email") VALUES\n  (1, \'Alice\', \'alice@example.com\');\n',
    )
  })

  it('appends ON CONFLICT DO NOTHING for ignore mode', () => {
    expect(generateInitialDataPostgreSQL(usersTable(), 'app', rows, undefined, null, undefined, 'ignore')).toBe(
      'INSERT INTO "app"."users" ("id", "name", "email") VALUES\n  (1, \'Alice\', \'alice@example.com\')\n'
      + 'ON CONFLICT DO NOTHING;\n',
    )
  })

  it('uses the primary key as the conflict target and updates other columns for overwrite mode', () => {
    expect(generateInitialDataPostgreSQL(usersTable(), 'app', rows, undefined, null, undefined, 'overwrite')).toBe(
      'INSERT INTO "app"."users" ("id", "name", "email") VALUES\n  (1, \'Alice\', \'alice@example.com\')\n'
      + 'ON CONFLICT ("id") DO UPDATE SET\n'
      + '  "name" = EXCLUDED."name",\n'
      + '  "email" = EXCLUDED."email";\n',
    )
  })

  it('falls back to the first plain unique index when there is no primary key', () => {
    const table = usersTable({
      fields: [
        { field_name: 'name', field_type: 'varchar' },
        { field_name: 'email', field_type: 'varchar' },
      ],
      indexes: [{ type: 'unique', columns: [{ name: 'email' }] }],
    })
    expect(generateInitialDataPostgreSQL(table, 'app', [{ name: 'Alice', email: 'alice@example.com' }], undefined, null, undefined, 'overwrite')).toBe(
      'INSERT INTO "app"."users" ("name", "email") VALUES\n  (\'Alice\', \'alice@example.com\')\n'
      + 'ON CONFLICT ("email") DO UPDATE SET\n  "name" = EXCLUDED."name";\n',
    )
  })

  it('degrades to ON CONFLICT DO NOTHING when no primary key or unique index exists', () => {
    const table = usersTable({
      fields: [{ field_name: 'name', field_type: 'varchar' }],
    })
    expect(generateInitialDataPostgreSQL(table, 'app', [{ name: 'Alice' }], undefined, null, undefined, 'overwrite')).toBe(
      '-- ON CONFLICT DO UPDATE requires a primary key or unique index; generated as ON CONFLICT DO NOTHING\n'
      + 'INSERT INTO "app"."users" ("name") VALUES\n  (\'Alice\')\nON CONFLICT DO NOTHING;\n',
    )
  })

  it('resolves primary-key columns from common fields', () => {
    const table = usersTable({
      fields: [
        { field_name: 'id', use_common_used_fields: true },
        { field_name: 'name', field_type: 'varchar' },
      ],
    })
    expect(generateInitialDataPostgreSQL(table, 'app', [{ id: 1, name: 'Alice' }], undefined, commonConfig, undefined, 'overwrite')).toBe(
      'INSERT INTO "app"."users" ("id", "name") VALUES\n  (1, \'Alice\')\n'
      + 'ON CONFLICT ("id") DO UPDATE SET\n  "name" = EXCLUDED."name";\n',
    )
  })
})

describe('SQLite initial data insert modes', () => {
  it('generates a plain INSERT by default', () => {
    expect(generateInitialDataSQLite(usersTable(), rows, undefined, null)).toBe(
      'INSERT INTO "users" ("id", "name", "email") VALUES\n  (1, \'Alice\', \'alice@example.com\');\n',
    )
  })

  it('generates INSERT OR IGNORE for ignore mode', () => {
    expect(generateInitialDataSQLite(usersTable(), rows, undefined, null, undefined, 'ignore')).toBe(
      'INSERT OR IGNORE INTO "users" ("id", "name", "email") VALUES\n  (1, \'Alice\', \'alice@example.com\');\n',
    )
  })

  it('generates INSERT OR REPLACE for overwrite mode', () => {
    expect(generateInitialDataSQLite(usersTable(), rows, undefined, null, undefined, 'overwrite')).toBe(
      'INSERT OR REPLACE INTO "users" ("id", "name", "email") VALUES\n  (1, \'Alice\', \'alice@example.com\');\n',
    )
  })
})
