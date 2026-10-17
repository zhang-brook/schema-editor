import { describe, expect, it } from 'vitest'
import type { Field, Index, Schema } from '@/types/schema'
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

describe('generateMigrationDdl：auto_diff 建表', () => {
  it('新增表输出三方言 CREATE TABLE，字段默认值走方言覆盖', () => {
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

  it('索引按方言覆盖取名称与类型', () => {
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
    // 覆盖只改名时索引类型仍取顶层 type
    expect(out.postgresql).toContain('CREATE INDEX "uk_p" ON "db"."t" ("id");')
    // sqlite 无覆盖时回退顶层名称
    expect(out.sqlite).toContain('CREATE INDEX "idx_a" ON "t" ("id");')
  })

  it('删除表与改名表分别生成 DROP / RENAME', () => {
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
    // SQLite 无 schema 前缀
    expect(out.sqlite).toContain('DROP TABLE "old";')
    expect(out.sqlite).toContain('ALTER TABLE "old" RENAME TO "new";')
  })

  it('字段增删改与索引变更按目标结构展开', () => {
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

describe('generateMigrationDdl：数据变换步骤', () => {
  it('clear_column 按方言限定表名', () => {
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

  it('sql_transform 补分号，custom_sql 原样拼接并保持步骤顺序', () => {
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

  it('无步骤时仅输出换行', () => {
    const out = generateMigrationDdl(migration([]), diff([]), [], null)
    expect(out).toEqual({ mysql: '\n', postgresql: '\n', sqlite: '\n' })
  })
})
