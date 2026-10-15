import { describe, expect, it, vi } from 'vitest'
import type { CommonConfig, InitialData, Schema, Table } from '@/types/schema'
import { CURRENT_STRUCT_VERSION, sanitizeName } from '@/core/workspace/layout'
import { readJsonFile, writeJsonFile } from '@/core/workspace/handles'
import {
  buildCommonWriteData,
  buildSchemaWriteData,
  buildTableExportData,
} from '@/core/workspace/serialization'
import {
  isNewStructure,
  migrateOldToNewStructure,
  openProjectFolderNew,
  writeCommonToHandle,
  writeDatabaseToHandle,
  writeSchemaJsonToHandle,
  writeSchemaToHandle,
  writeTableToHandle,
} from './file-helpers'
import { buildInitialDataExport, writeInitialDataToNewStructure } from './initial-data-io'
import { runStructureMigrations } from './structure-migrations'

// 仅内存 File System Access API mock；不打开真实目录、不访问项目数据。
class MemoryFile {
  readonly kind = 'file' as const
  content = ''
  constructor(readonly name: string) {}

  async getFile() {
    const content = this.content
    return { text: async () => content }
  }

  async createWritable() {
    let pending = this.content
    return {
      write: async (content: string) => { pending = content },
      close: async () => { this.content = pending },
    }
  }
}

class MemoryDirectory {
  readonly kind = 'directory' as const
  readonly children = new Map<string, MemoryDirectory | MemoryFile>()
  constructor(readonly name: string) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDirectory> {
    let entry = this.children.get(name)
    if (!entry) {
      if (!options?.create) throw new Error(`NotFoundError: ${name}`)
      entry = new MemoryDirectory(name)
      this.children.set(name, entry)
    }
    if (entry.kind !== 'directory') throw new Error(`TypeMismatchError: ${name}`)
    return entry
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFile> {
    let entry = this.children.get(name)
    if (!entry) {
      if (!options?.create) throw new Error(`NotFoundError: ${name}`)
      entry = new MemoryFile(name)
      this.children.set(name, entry)
    }
    if (entry.kind !== 'file') throw new Error(`TypeMismatchError: ${name}`)
    return entry
  }

  async removeEntry(name: string) {
    this.children.delete(name)
  }

  async *values(): AsyncGenerator<MemoryDirectory | MemoryFile> {
    yield* this.children.values()
  }
}

const asHandle = (root: MemoryDirectory) => root as unknown as FileSystemDirectoryHandle

async function fileAt(root: FileSystemDirectoryHandle, path: string[], create = false): Promise<FileSystemFileHandle> {
  let dir = root
  for (const segment of path.slice(0, -1)) dir = await dir.getDirectoryHandle(segment, { create })
  return dir.getFileHandle(path[path.length - 1]!, { create })
}

async function readAt<T = unknown>(root: FileSystemDirectoryHandle, path: string[]): Promise<T> {
  return readJsonFile<T>(await fileAt(root, path))
}

function makeTable(name: string): Table {
  return {
    name, comment: 'table', comment_before_table: ['before', null], comment_before_fields: { updated_at: 'timestamp' },
    fields: [
      { field_name: 'updated_at', field_type: 'datetime', field_length: 3, default: 'CURRENT_TIMESTAMP', on_update_current_timestamp: true, on_update_current_timestamp_precision: 0 },
      { field_name: 'enabled', field_type: 'boolean', not_null: false, default: false },
      { field_name: 'count', field_type: 'int', default: 0 },
      { field_name: 'nil', field_type: 'text', default: null, field_length: null, field_scale: 3, field_scale_disabled: true },
      { field_name: 'common_id', use_common_used_fields: true, field_type: 'ignored' },
    ],
    indexes: [{
      name: 'idx_updated', type: 'index', active_only: true, logical_delete: { enabled: false },
      columns: [{ name: 'updated_at', sort_order: 'ASC', mysql: { sort_order: 'DESC' }, postgresql: { sort_order: 'ASC' }, sqlite: { sort_order: 'DESC' } }],
      mysql: { using: 'BTREE' }, postgresql: { name: 'pg_updated' }, sqlite: { name: 'sqlite_updated' },
    }],
    mysql: { mysql_engine: 'InnoDB', mysql_charset: 'utf8mb4', mysql_collation: 'utf8mb4_bin' },
    partition: { mysql: { strategy: 'HASH', columns: ['count'] }, postgresql: { expression: 'HASH (count)' } },
    pre_sql: { mysql: 'SELECT 10;', postgresql: 'SELECT 11;', sqlite: 'SELECT 12;' },
    post_sql: { mysql: 'SELECT 13;', postgresql: 'SELECT 14;', sqlite: 'SELECT 15;' },
  }
}

function fixture() {
  const schemas: Schema[] = [
    {
      schema: '业务:main', tables: [makeTable('z:events'), makeTable('a_users')],
      pre_sql: { mysql: 'SELECT 1;', postgresql: 'SELECT 2;', sqlite: 'SELECT 3;' },
      post_sql: { mysql: 'SELECT 4;', postgresql: 'SELECT 5;', sqlite: 'SELECT 6;' },
    },
    { schema: 'empty', tables: [], pre_sql: {}, post_sql: {} },
    { schema: 'audit', tables: [makeTable('z_log'), makeTable('a_log')], pre_sql: { postgresql: 'SELECT 7;' }, post_sql: { sqlite: 'SELECT 8;' } },
  ]
  const common: CommonConfig = {
    struct_version: CURRENT_STRUCT_VERSION, project_name: 'roundtrip', generate_ai_guide: false,
    default_config: {
      mysql: { database: {}, table: { mysql_engine: 'InnoDB', mysql_charset: 'utf8mb4', mysql_collation: 'utf8mb4_bin' } },
      postgresql: { quote_identifiers: false },
    },
    schema_order: ['audit', '业务:main', 'empty'],
    common_used_fields: { common_id: { field_name: 'common_id', field_type: 'bigint', field_length: 20, field_length_disabled: true, default: 0 } },
  }
  const initialData = schemas.flatMap(schema => schema.tables.map((table): { key: string; data: InitialData } => ({
    key: `${schema.schema}/${table.name}`,
    data: {
      rows: [
        { data: { id: 0, enabled: false, nil: null, blank: '', omitted: undefined, updated_at: 'CURRENT_TIMESTAMP' }, field_comments: { id: 'zero' }, expr_fields: { updated_at: true }, row_comment: 'row', is_skip: true },
        { data: { id: 1 }, field_comments: {}, expr_fields: {}, row_comment: '', is_skip: false },
      ],
      pre_sql: { mysql: 'SELECT 20;', postgresql: 'SELECT 21;', sqlite: 'SELECT 22;' },
      post_sql: { mysql: 'SELECT 23;', postgresql: 'SELECT 24;', sqlite: 'SELECT 25;' },
    },
  })))
  return { schemas, common, initialData }
}

async function expectRoundTrip(root: FileSystemDirectoryHandle, source: ReturnType<typeof fixture>) {
  const loaded = await openProjectFolderNew(root)
  expect(loaded.rootHandle).toBe(root)
  expect(loaded.databaseData).toStrictEqual({ schema_order: source.common.schema_order })
  expect(loaded.schemas.map(schema => schema.schema)).toStrictEqual(source.common.schema_order)
  for (const schema of loaded.schemas) {
    const original = source.schemas.find(item => item.schema === schema.schema)!
    expect(schema.table_order).toStrictEqual(original.tables.map(table => table.name))
    expect(schema.tables).toStrictEqual(original.tables.map(buildTableExportData))
    const metadata = buildSchemaWriteData(original)
    expect(schema.pre_sql).toStrictEqual(metadata.pre_sql)
    expect(schema.post_sql).toStrictEqual(metadata.post_sql)
    expect(await readAt(root, ['current', 'schemas', sanitizeName(schema.schema), 'schema.json'])).toStrictEqual(metadata)
    for (const table of schema.tables) {
      expect(await readAt(root, ['current', 'schemas', sanitizeName(schema.schema), sanitizeName(table.name), 'table.json'])).toStrictEqual(table)
    }
  }
  const common = await readAt<CommonConfig>(root, ['common.json'])
  expect(common).toStrictEqual(buildCommonWriteData(source.common))
  expect(common).not.toHaveProperty('schema_order')
  expect(common.struct_version).toBe(CURRENT_STRUCT_VERSION)
  expect(await isNewStructure(root)).toBe(true)
  expect(loaded.initialData).toHaveLength(source.initialData.length)
  for (const item of source.initialData) {
    const expected = JSON.parse(JSON.stringify(buildInitialDataExport(item.data)))
    expect(loaded.initialData.find(loaded => loaded.key === item.key)?.data).toStrictEqual(expected)
  }
  return loaded
}

describe('新布局序列化 File System Access API 内存 roundtrip', () => {
  it('多 schema、多表、排序、三级 SQL、字段及 initial data 写入后完整加载', async () => {
    const root = asHandle(new MemoryDirectory(''))
    const source = fixture()
    await writeCommonToHandle(root, buildCommonWriteData(source.common))
    await writeDatabaseToHandle(root, { schema_order: source.common.schema_order })
    // 目录创建顺序故意不同于 metadata 排序，验证 loader 使用持久化顺序。
    for (const schema of source.schemas) {
      await writeSchemaJsonToHandle(root, schema.schema, buildSchemaWriteData(schema))
      for (const table of [...schema.tables].reverse()) await writeTableToHandle(root, schema.schema, buildTableExportData(table))
    }
    for (const item of source.initialData) {
      const [schemaName, tableName] = item.key.split('/')
      await writeInitialDataToNewStructure(root, schemaName!, tableName!, item.data)
    }
    await expectRoundTrip(root, source)

    // 再写再读；清空 SQL 时旧值必须消失，而非合并残留。
    const changed = source.schemas[0]!
    changed.pre_sql = {}
    changed.post_sql = {}
    await writeSchemaJsonToHandle(root, changed.schema, buildSchemaWriteData(changed))
    await expectRoundTrip(root, source)
  })

  it('migrateOldToNewStructure 复用 schema 元信息序列化，保留 SQL 与原有布局/版本', async () => {
    const root = asHandle(new MemoryDirectory(''))
    const source = fixture()
    const transformTable = vi.fn((_schema: Schema, table: Table) => buildTableExportData(table))
    await migrateOldToNewStructure(root, {
      commonConfig: buildCommonWriteData(source.common), databaseData: { schema_order: source.common.schema_order },
      schemas: source.schemas, transformTable, initialData: source.initialData,
    })
    expect(transformTable).toHaveBeenCalledTimes(4)
    for (const schema of source.schemas) {
      for (const table of schema.tables) expect(transformTable).toHaveBeenCalledWith(schema, table)
    }
    await expectRoundTrip(root, source)
  })

  it('真实旧布局迁移入口读取 schema SQL 并带入 current/，schema_order 仍只迁入 database', async () => {
    const root = asHandle(new MemoryDirectory(''))
    const source = fixture()
    await writeCommonToHandle(root, { ...buildCommonWriteData(source.common), struct_version: '0.4', schema_order: source.common.schema_order })
    const legacySchemas = await root.getDirectoryHandle('schemas', { create: true })
    for (const schema of source.schemas) await writeSchemaToHandle(legacySchemas, `${sanitizeName(schema.schema)}.json`, schema)
    await runStructureMigrations(root, '0.4', { transformTable: (_schema, table) => buildTableExportData(table) }, CURRENT_STRUCT_VERSION)
    await expectRoundTrip(root, { ...source, initialData: [] })
    expect([...((legacySchemas as unknown as MemoryDirectory).children.keys())]).toStrictEqual([])
  })

  it('无 current 的空目录只读返回空项目，不创建任何文件', async () => {
    const memory = new MemoryDirectory('')
    const root = asHandle(memory)
    expect(await openProjectFolderNew(root)).toStrictEqual({ rootHandle: root, databaseData: null, schemas: [], initialData: [] })
    expect(memory.children.size).toBe(0)
  })

  it('兼容缺失 SQL/排序/fields/indexes，忽略无效目录，并将未列入顺序的表置末尾', async () => {
    const root = asHandle(new MemoryDirectory(''))
    await writeJsonFile(await fileAt(root, ['current', 'schemas', 'public', 'schema.json'], true), { schema: 'public', table_order: ['b'] })
    for (const name of ['a', 'b', 'c']) {
      await writeJsonFile(await fileAt(root, ['current', 'schemas', 'public', name, 'table.json'], true), { name, comment: '' })
    }
    await writeJsonFile(await fileAt(root, ['current', 'schemas', 'no_meta', 'orphan', 'table.json'], true), { name: 'orphan' })
    await writeJsonFile(await fileAt(root, ['current', 'schemas', 'no_name', 'schema.json'], true), {})
    await writeJsonFile(await fileAt(root, ['current', 'schemas', 'unordered', 'schema.json'], true), { schema: 'unordered' })
    const loaded = await openProjectFolderNew(root)
    expect(loaded.databaseData).toBeNull()
    expect(loaded.schemas.map(schema => schema.schema)).toStrictEqual(['public', 'unordered'])
    expect(loaded.schemas[0]!.tables).toStrictEqual(['b', 'a', 'c'].map(name => ({ name, comment: '', fields: [], indexes: [] })))
    expect(loaded.schemas[0]!.pre_sql).toBeUndefined()
    expect(loaded.schemas[0]!.post_sql).toBeUndefined()
    expect(loaded.schemas[1]!.table_order).toStrictEqual([])
  })
})
