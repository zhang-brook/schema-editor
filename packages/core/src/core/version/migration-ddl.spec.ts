import { describe, expect, it } from 'vitest'
import type { Field, Index, Schema } from '../../types/schema'
import { generateMigrationDdl } from './migration-ddl'
import type { Migration, StructureDiff, TableDiff } from './types'

function migration(steps: Migration['steps']): Migration {
  return {
    id: 'm1',
    name: '迁移',
    from_version: 'v1',
    to_version: 'v2',
    renames: [],
    steps,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  }
}

function diff(schemas: StructureDiff['schemas']): StructureDiff {
  return { from: null, to: { kind: 'current' }, schemas, hasChanges: true }
}

function tableDiff(tableName: string, type: TableDiff['type'], extra: Partial<TableDiff> = {}): TableDiff {
  return { type, new_name: tableName, fields: [], indexes: [], ...extra }
}

function schemas(table: Schema['tables'][number]): Schema[] {
  return [{ schema: 'db', tables: [table] }]
}

describe('generateMigrationDdl: auto_diff table creation', () => {
  it('emits CREATE TABLE for all three dialects on table addition, using dialect overrides for field defaults', () => {
    const f: Field = {
      field_name: 'flag',
      field_type: 'tinyint',
      default: 0,
      postgresql: { field_type: 'boolean', default: false },
    }
    const out = generateMigrationDdl(
      migration([{ type: 'auto_diff' }]),
      diff([{ schema: 'db', tables: [tableDiff('t', 'table_added')] }]),
      schemas({ name: 't', comment: '', fields: [f], indexes: [] }),
      null,
    )
    expect(out.mysql).toContain('`flag` tinyint DEFAULT 0')
    expect(out.postgresql).toContain('"flag" boolean DEFAULT false')
  })

  it('takes index name and type from dialect overrides', () => {
    const idx: Index = {
      type: 'index',
      name: 'idx_a',
      columns: [{ name: 'id' }],
      mysql: { name: 'uk_a', type: 'unique', using: 'hash' },
      postgresql: { name: 'uk_p' },
    }
    const out = generateMigrationDdl(
      migration([{ type: 'auto_diff' }]),
      diff([{ schema: 'db', tables: [tableDiff('t', 'table_added')] }]),
      schemas({ name: 't', comment: '', fields: [], indexes: [idx] }),
      null,
    )
    expect(out.mysql).toContain('CREATE UNIQUE INDEX `uk_a` ON `db`.`t` (`id`) USING HASH;')
    // when the override only renames, the index type still comes from the top-level type
    expect(out.postgresql).toContain('CREATE INDEX "uk_p" ON "db"."t" ("id");')
    // sqlite falls back to the top-level name when there is no override
    expect(out.sqlite).toContain('CREATE INDEX "idx_a" ON "t" ("id");')
  })

  it('generates DROP / RENAME for removed and renamed tables respectively', () => {
    const out = generateMigrationDdl(
      migration([{ type: 'auto_diff' }]),
      diff([
        { schema: 'db', tables: [tableDiff('old', 'table_removed', { new_name: undefined, old_name: 'old' })] },
        { schema: 'db', tables: [tableDiff('new', 'table_renamed', { old_name: 'old' })] },
      ]),
      schemas({ name: 'new', comment: '', fields: [], indexes: [] }),
      null,
    )
    expect(out.mysql).toContain('DROP TABLE `db`.`old`;')
    expect(out.postgresql).toContain('ALTER TABLE "db"."old" RENAME TO "new";')
    // SQLite has no schema prefix
    expect(out.sqlite).toContain('DROP TABLE "old";')
    expect(out.sqlite).toContain('ALTER TABLE "old" RENAME TO "new";')
  })

  it('expands field and index changes against the target structure', () => {
    const added: Field = { field_name: 'b', field_type: 'int', not_null: true }
    const out = generateMigrationDdl(
      migration([{ type: 'auto_diff' }]),
      diff([
        {
          schema: 'db',
          tables: [
            tableDiff('t', 'table_renamed', {
              old_name: 't',
              fields: [
                { type: 'field_added', new_name: 'b' },
                { type: 'field_removed', old_name: 'a' },
                { type: 'field_renamed', old_name: 'c', new_name: 'd' },
              ],
              indexes: [{ type: 'index_removed', old_name: 'idx_x' }],
            }),
          ],
        },
      ]),
      schemas({ name: 't', comment: '', fields: [added], indexes: [] }),
      null,
    )
    expect(out.mysql).toContain('ALTER TABLE `db`.`t` ADD COLUMN `b` int NOT NULL;')
    expect(out.mysql).toContain('ALTER TABLE `db`.`t` DROP COLUMN `a`;')
    expect(out.mysql).toContain('ALTER TABLE `db`.`t` RENAME COLUMN `c` TO `d`;')
    expect(out.mysql).toContain('DROP INDEX `idx_x` ON `db`.`t`;')
    expect(out.sqlite).toContain('DROP INDEX "idx_x";')
    expect(out.postgresql).toContain('DROP INDEX "db"."idx_x";')
  })
})

describe('generateMigrationDdl: data transformation steps', () => {
  it('clear_column qualifies table names per dialect', () => {
    const out = generateMigrationDdl(
      migration([{ type: 'clear_column', schema: 'db', table: 't', column: 'c' }]),
      diff([]),
      [],
      null,
    )
    expect(out.mysql).toContain('UPDATE `db`.`t` SET `c` = NULL;')
    expect(out.postgresql).toContain('UPDATE "db"."t" SET "c" = NULL;')
    expect(out.sqlite).toContain('UPDATE "t" SET "c" = NULL;')
  })

  it('sql_transform appends a semicolon, custom_sql is concatenated verbatim, and step order is preserved', () => {
    const out = generateMigrationDdl(
      migration([
        { type: 'sql_transform', mysql: 'UPDATE t SET a = 1', postgresql: 'UPDATE t SET a = 1;', sqlite: '' },
        { type: 'custom_sql', mysql: '-- tail', postgresql: '-- tail', sqlite: '-- tail' },
      ]),
      diff([]),
      [],
      null,
    )
    expect(out.mysql).toBe('UPDATE t SET a = 1;\n-- tail\n')
    expect(out.postgresql).toBe('UPDATE t SET a = 1;\n-- tail\n')
    expect(out.sqlite).toBe('-- tail\n')
  })

  it('outputs only a newline when there are no steps', () => {
    const out = generateMigrationDdl(migration([]), diff([]), [], null)
    expect(out).toEqual({ mysql: '\n', postgresql: '\n', sqlite: '\n' })
  })
})
