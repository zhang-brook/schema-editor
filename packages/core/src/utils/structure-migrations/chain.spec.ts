import { describe, it, expect } from 'vitest'
import type { Schema, Table } from '../../types/schema'
import { runStructureMigrations } from './index'

/**
 * Regression tests for chained structure migrations.
 *
 * Migrations operate on disk via the File System Access API; in-memory mocks below implement
 * the minimal API surface required by FileSystemDirectoryHandle / FileSystemFileHandle,
 * asserting field changes and directory layout after advancing stepwise from v0.0 → v1.0.
 */

// ===== In-memory File System Access API mocks =====

class MemFile {
  readonly kind = 'file' as const
  name: string
  content = ''
  constructor(name: string) {
    this.name = name
  }
  async getFile(): Promise<{ text: () => Promise<string> }> {
    const content = this.content
    return { text: async () => content }
  }
  async createWritable(): Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> {
    return {
      write: async (d: string) => {
        this.content = d
      },
      close: async () => {},
    }
  }
}

class MemDir {
  readonly kind = 'directory' as const
  name: string
  children = new Map<string, MemDir | MemFile>()
  constructor(name: string) {
    this.name = name
  }
  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MemDir> {
    let e = this.children.get(name)
    if (!e) {
      if (!opts?.create) throw new Error(`NotFoundError: directory "${name}"`)
      e = new MemDir(name)
      this.children.set(name, e)
    }
    if (e.kind !== 'directory') throw new Error(`TypeMismatch: "${name}" is a file`)
    return e
  }
  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<MemFile> {
    let e = this.children.get(name)
    if (!e) {
      if (!opts?.create) throw new Error(`NotFoundError: file "${name}"`)
      e = new MemFile(name)
      this.children.set(name, e)
    }
    if (e.kind !== 'file') throw new Error(`TypeMismatch: "${name}" is a directory`)
    return e
  }
  async removeEntry(name: string): Promise<void> {
    this.children.delete(name)
  }
  async *values(): AsyncGenerator<MemDir | MemFile> {
    for (const child of this.children.values()) yield child
  }
}

// ===== Test helpers =====

async function seedFile(root: MemDir, segments: string[], obj: unknown): Promise<void> {
  let dir = root
  for (let i = 0; i < segments.length - 1; i++) {
    dir = await dir.getDirectoryHandle(segments[i]!, { create: true })
  }
  const fh = await dir.getFileHandle(segments[segments.length - 1]!, { create: true })
  const w = await fh.createWritable()
  await w.write(JSON.stringify(obj))
  await w.close()
}

// ===== On-disk document views used by assertions (only keys the tests care about) =====

type ChainCommonDoc = {
  struct_version?: string
  default_config?: { postgresql?: unknown; pgsql?: unknown }
}
type ChainTableDoc = {
  indexes: { columns: unknown }[]
  fields: { field_name: string; postgresql?: unknown; pgsql?: unknown }[]
}
type ChainSchemaDoc = { tables: ChainTableDoc[] }
type ChainInitialDoc = { rows: unknown[] }

async function readJson<T>(root: MemDir, segments: string[]): Promise<T> {
  let dir = root
  for (let i = 0; i < segments.length - 1; i++) {
    dir = await dir.getDirectoryHandle(segments[i]!, { create: false })
  }
  const fh = await dir.getFileHandle(segments[segments.length - 1]!, { create: false })
  const f = await fh.getFile()
  return JSON.parse(await f.text()) as T
}

async function pathExists(root: MemDir, segments: string[]): Promise<boolean> {
  let dir = root
  try {
    for (let i = 0; i < segments.length - 1; i++) {
      dir = await dir.getDirectoryHandle(segments[i]!, { create: false })
    }
  } catch {
    return false
  }
  return dir.children.has(segments[segments.length - 1]!)
}

/** Build a fresh v0.0 old-layout project (per case, to avoid cross-contamination) */
function buildProjectV0_0(): MemDir {
  const root = new MemDir('')
  // Root common.json (0.0: default_config uses the legacy pgsql field)
  void seedFile(root, ['common.json'], {
    struct_version: '0.0',
    default_config: { pgsql: { quote_identifiers: true } },
    common_used_fields: {},
    unified_types: [],
  })
  // Old layout schemas/public.json: index.columns is string[], fields carry the legacy pgsql
  void seedFile(root, ['schemas', 'public.json'], {
    schema: 'public',
    tables: [
      {
        name: 'users',
        comment: '用户表',
        fields: [
          { field_name: 'id', field_type: 'bigint', primary_key: true, not_null: true },
          { field_name: 'created_at', field_type: 'datetime', pgsql: { type: 'timestamp' } },
        ],
        indexes: [
          { name: 'idx_created', type: 'index', columns: ['created_at DESC'] },
        ],
      },
    ],
  })
  // Old layout initial-data/public/users.json: plain array format (legacy 0.2 format)
  void seedFile(root, ['initial-data', 'public', 'users.json'], [
    { id: 1, created_at: '2020-01-01' },
  ])
  return root
}

const deps = { transformTable: (_schema: Schema, table: Table) => table }
// The in-memory mocks cover the minimal handle API needed by the migrations; safe at runtime, narrowed once via a type assertion
const asRoot = (d: MemDir) => d as unknown as FileSystemDirectoryHandle

describe('chained structure migrations', () => {
  it('advances stepwise: every migration step bumps struct_version', async () => {
    const root = buildProjectV0_0()
    const steps: [string, string][] = [
      ['0.0', '0.1'],
      ['0.1', '0.2'],
      ['0.2', '0.3'],
      ['0.3', '0.4'],
      ['0.4', '1.0'],
    ]
    for (const [from, to] of steps) {
      await runStructureMigrations(asRoot(root), from, deps, to)
      const common = await readJson<ChainCommonDoc>(root, ['common.json'])
      expect(common.struct_version).toBe(to)
    }
  })

  it('full chain 0.0 → 1.0: field upgrades + new layout + initial data inlined', async () => {
    const root = buildProjectV0_0()
    await runStructureMigrations(asRoot(root), '0.0', deps, '1.0')

    // version advances to 1.0
    const common = await readJson<ChainCommonDoc>(root, ['common.json'])
    expect(common.struct_version).toBe('1.0')
    // default_config: pgsql → postgresql
    expect(common.default_config!.postgresql).toEqual({ quote_identifiers: true })
    expect(common.default_config!.pgsql).toBeUndefined()

    // new layout on disk: current/schemas/public/users/table.json
    const tablePath = ['current', 'schemas', 'public', 'users', 'table.json']
    expect(await pathExists(root, tablePath)).toBe(true)
    const table = await readJson<ChainTableDoc>(root, tablePath)

    // v0.0→v0.1: index.columns string[] → IndexColumn[]
    expect(table.indexes[0]!.columns).toEqual([{ name: 'created_at', sort_order: 'DESC' }])

    // v0.3→v0.4: field pgsql → postgresql
    const createdAt = table.fields.find(f => f.field_name === 'created_at')
    expect(createdAt!.postgresql).toEqual({ type: 'timestamp' })
    expect(createdAt!.pgsql).toBeUndefined()

    // v0.4→v1.0: initial-data array → inlined rows structure
    const initial = await readJson<ChainInitialDoc>(root, ['current', 'schemas', 'public', 'users', 'initial-data.json'])
    expect(initial.rows).toEqual([{ data: { id: 1, created_at: '2020-01-01' } }])

    // old-layout files are cleaned up
    expect(await pathExists(root, ['schemas', 'public.json'])).toBe(false)
  })

  it('partial chain 0.0 → 0.4: pgsql renamed but still the old layout (current/ not created)', async () => {
    const root = buildProjectV0_0()
    await runStructureMigrations(asRoot(root), '0.0', deps, '0.4')

    const common = await readJson<ChainCommonDoc>(root, ['common.json'])
    expect(common.struct_version).toBe('0.4')

    // still the old layout: schemas/public.json exists, current/ not created
    expect(await pathExists(root, ['schemas', 'public.json'])).toBe(true)
    expect(await pathExists(root, ['current'])).toBe(false)

    // fields already upgraded under the old layout: columns objectified, pgsql renamed
    const schema = await readJson<ChainSchemaDoc>(root, ['schemas', 'public.json'])
    const table = schema.tables[0]!
    expect(table.indexes[0]!.columns).toEqual([{ name: 'created_at', sort_order: 'DESC' }])
    const createdAt = table.fields.find(f => f.field_name === 'created_at')
    expect(createdAt!.postgresql).toEqual({ type: 'timestamp' })
    expect(createdAt!.pgsql).toBeUndefined()
  })
})
