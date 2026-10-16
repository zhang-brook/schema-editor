import { describe, it, expect } from 'vitest'
import { runStructureMigrations } from './index'

/**
 * 结构迁移链式升级回归测试。
 *
 * 迁移基于 File System Access API 操作磁盘，此处用内存态 mock 实现
 * FileSystemDirectoryHandle / FileSystemFileHandle 所需的最小 API 面，
 * 断言 v0.0 → v1.0 逐步推进后的字段变更与目录布局结果。
 */

// ===== File System Access API 内存 mock =====

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

// ===== 测试辅助 =====

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

async function readJson<T = any>(root: MemDir, segments: string[]): Promise<T> {
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

/** 构造一个全新的 v0.0 旧布局项目（每个用例独立，避免相互污染） */
function buildProjectV0_0(): MemDir {
  const root = new MemDir('')
  // 根 common.json（0.0：default_config 使用旧 pgsql 字段）
  void seedFile(root, ['common.json'], {
    struct_version: '0.0',
    default_config: { pgsql: { quote_identifiers: true } },
    common_used_fields: {},
    unified_types: [],
  })
  // 旧布局 schemas/public.json：index.columns 为 string[]，字段带旧 pgsql
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
  // 旧布局 initial-data/public/users.json：纯数组格式（0.2 旧格式）
  void seedFile(root, ['initial-data', 'public', 'users.json'], [
    { id: 1, created_at: '2020-01-01' },
  ])
  return root
}

const deps = { transformTable: (_schema: any, table: any) => table }
// 内存 mock 满足迁移所需的最小 handle API，运行时安全，类型上做一次断言收敛
const asRoot = (d: MemDir) => d as unknown as FileSystemDirectoryHandle

describe('结构迁移链式升级', () => {
  it('逐步推进：每个迁移步骤都会推进 struct_version', async () => {
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
      const common = await readJson(root, ['common.json'])
      expect(common.struct_version).toBe(to)
    }
  })

  it('0.0 → 1.0 完整链：字段升级 + 新布局 + 初始数据行内化', async () => {
    const root = buildProjectV0_0()
    await runStructureMigrations(asRoot(root), '0.0', deps, '1.0')

    // 版本推进到 1.0
    const common = await readJson(root, ['common.json'])
    expect(common.struct_version).toBe('1.0')
    // default_config：pgsql → postgresql
    expect(common.default_config.postgresql).toEqual({ quote_identifiers: true })
    expect(common.default_config.pgsql).toBeUndefined()

    // 新布局落盘：current/schemas/public/users/table.json
    const tablePath = ['current', 'schemas', 'public', 'users', 'table.json']
    expect(await pathExists(root, tablePath)).toBe(true)
    const table = await readJson(root, tablePath)

    // v0.0→v0.1：index.columns string[] → IndexColumn[]
    expect(table.indexes[0].columns).toEqual([{ name: 'created_at', sort_order: 'DESC' }])

    // v0.3→v0.4：字段 pgsql → postgresql
    const createdAt = table.fields.find((f: any) => f.field_name === 'created_at')
    expect(createdAt.postgresql).toEqual({ type: 'timestamp' })
    expect(createdAt.pgsql).toBeUndefined()

    // v0.4→v1.0：initial-data 数组 → 行内 rows 结构
    const initial = await readJson(root, ['current', 'schemas', 'public', 'users', 'initial-data.json'])
    expect(initial.rows).toEqual([{ data: { id: 1, created_at: '2020-01-01' } }])

    // 旧布局文件被清理
    expect(await pathExists(root, ['schemas', 'public.json'])).toBe(false)
  })

  it('部分链 0.0 → 0.4：pgsql 已改名，但仍是旧布局（未创建 current/）', async () => {
    const root = buildProjectV0_0()
    await runStructureMigrations(asRoot(root), '0.0', deps, '0.4')

    const common = await readJson(root, ['common.json'])
    expect(common.struct_version).toBe('0.4')

    // 仍为旧布局：schemas/public.json 存在，current/ 未创建
    expect(await pathExists(root, ['schemas', 'public.json'])).toBe(true)
    expect(await pathExists(root, ['current'])).toBe(false)

    // 旧布局下字段已升级：columns 已对象化、pgsql 已改名
    const schema = await readJson(root, ['schemas', 'public.json'])
    const table = schema.tables[0]
    expect(table.indexes[0].columns).toEqual([{ name: 'created_at', sort_order: 'DESC' }])
    const createdAt = table.fields.find((f: any) => f.field_name === 'created_at')
    expect(createdAt.postgresql).toEqual({ type: 'timestamp' })
    expect(createdAt.pgsql).toBeUndefined()
  })
})
