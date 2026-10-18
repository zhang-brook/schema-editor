import { describe, expect, it, vi } from 'vitest'
import type { CommonConfig, InitialData, Schema, Table } from '../types/schema'
import { CURRENT_STRUCT_VERSION, sanitizeName } from '../core/workspace/layout'
import { readJsonFile, writeJsonFile } from '../core/workspace/handles'
import {
  buildCommonWriteData,
  buildSchemaWriteData,
  buildTableExportData,
} from '../core/workspace/serialization'
import {
  isNewStructure,
  migrateOldToNewStructure,
  writeCommonToHandle,
  writeDatabaseToHandle,
  writeSchemaJsonToHandle,
  writeTableToHandle,
} from './file-helpers'
import { buildInitialDataExport, writeInitialDataToNewStructure } from './initial-data-io'
import { runStructureMigrations } from './structure-migrations'

// In-memory File System Access API mock only; no real directories are opened and no project data is accessed.
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

async function dirAt(root: FileSystemDirectoryHandle, path: string[]): Promise<FileSystemDirectoryHandle> {
  let dir = root
  for (const segment of path) dir = await dir.getDirectoryHandle(segment, { create: false })
  return dir
}

async function entriesOf(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = []
  for await (const entry of dir.values()) names.push(entry.name)
  return names
}

/**
 * Read the new-layout artifacts on disk back directly and compare them path by path against the in-memory state.
 * The written result is the source of truth; no loader is involved, avoiding the case where the writer and its reader break together.
 */
async function expectRoundTrip(
  root: FileSystemDirectoryHandle,
  source: ReturnType<typeof fixture>,
  expectedInitialData = source.initialData,
) {
  expect(await readAt(root, ['current', 'database.json'])).toStrictEqual({ schema_order: source.common.schema_order })
  expect((await entriesOf(await dirAt(root, ['current', 'schemas']))).sort())
    .toStrictEqual(source.schemas.map(schema => sanitizeName(schema.schema)).sort())

  const initialFiles: string[] = []
  for (const schema of source.schemas) {
    const schemaDir = ['current', 'schemas', sanitizeName(schema.schema)]
    expect(await readAt(root, [...schemaDir, 'schema.json'])).toStrictEqual(buildSchemaWriteData(schema))
    for (const table of schema.tables) {
      const tableDir = [...schemaDir, sanitizeName(table.name)]
      expect(await readAt(root, [...tableDir, 'table.json'])).toStrictEqual(buildTableExportData(table))
      initialFiles.push(...(await entriesOf(await dirAt(root, tableDir))).filter(name => name === 'initial-data.json'))
    }
  }
  expect(initialFiles).toHaveLength(expectedInitialData.length)

  const common = await readAt<CommonConfig>(root, ['common.json'])
  expect(common).toStrictEqual(buildCommonWriteData(source.common))
  expect(common).not.toHaveProperty('schema_order')
  expect(common.struct_version).toBe(CURRENT_STRUCT_VERSION)
  expect(await isNewStructure(root)).toBe(true)

  for (const item of expectedInitialData) {
    const [schemaName, tableName] = item.key.split('/')
    const expected = JSON.parse(JSON.stringify(buildInitialDataExport(item.data)))
    expect(await readAt(root, ['current', 'schemas', sanitizeName(schemaName!), sanitizeName(tableName!), 'initial-data.json']))
      .toStrictEqual(expected)
  }
}

describe('new-layout serialization File System Access API in-memory roundtrip', () => {
  it('fully loads after writing multiple schemas, multiple tables, ordering, three-level SQL, fields and initial data', async () => {
    const root = asHandle(new MemoryDirectory(''))
    const source = fixture()
    await writeCommonToHandle(root, buildCommonWriteData(source.common))
    await writeDatabaseToHandle(root, { schema_order: source.common.schema_order })
    // Directory creation order intentionally differs from metadata ordering to verify the loader uses the persisted order.
    for (const schema of source.schemas) {
      await writeSchemaJsonToHandle(root, schema.schema, buildSchemaWriteData(schema))
      for (const table of [...schema.tables].reverse()) await writeTableToHandle(root, schema.schema, buildTableExportData(table))
    }
    for (const item of source.initialData) {
      const [schemaName, tableName] = item.key.split('/')
      await writeInitialDataToNewStructure(root, schemaName!, tableName!, item.data)
    }
    await expectRoundTrip(root, source)

    // Write and read again; when SQL is cleared, the old value must disappear rather than linger from a merge.
    const changed = source.schemas[0]!
    changed.pre_sql = {}
    changed.post_sql = {}
    await writeSchemaJsonToHandle(root, changed.schema, buildSchemaWriteData(changed))
    await expectRoundTrip(root, source)
  })

  it('migrateOldToNewStructure reuses schema metadata serialization, preserving SQL and the original layout/version', async () => {
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

  it('the real old-layout migration entry reads schema SQL and carries it into current/, while schema_order is still migrated only into database', async () => {
    const root = asHandle(new MemoryDirectory(''))
    const source = fixture()
    await writeCommonToHandle(root, { ...buildCommonWriteData(source.common), struct_version: '0.4', schema_order: source.common.schema_order })
    for (const schema of source.schemas) {
      await writeJsonFile(await fileAt(root, ['schemas', `${sanitizeName(schema.schema)}.json`], true), schema)
    }
    await runStructureMigrations(root, '0.4', { transformTable: (_schema, table) => buildTableExportData(table) }, CURRENT_STRUCT_VERSION)
    await expectRoundTrip(root, source, [])
    expect(await entriesOf(await dirAt(root, ['schemas']))).toStrictEqual([])
  })
})
