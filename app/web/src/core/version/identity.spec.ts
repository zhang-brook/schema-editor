import { describe, expect, it } from 'vitest'
import type { Field, Schema } from '@/types/schema'
import type { RenameEntry } from './types'
import {
  buildRenameLookup,
  buildRenameMap,
  fieldPath,
  indexPath,
  parsePath,
  rebuildPath,
  resolveOldPath,
  suggestRenames,
  tablePath,
} from './identity'

function field(name: string, extra: Partial<Field> = {}): Field {
  return { field_name: name, field_type: 'varchar', ...extra }
}

function schema(name: string, tables: { name: string; fields: Field[] }[]): Schema {
  return {
    schema: name,
    tables: tables.map(t => ({ name: t.name, comment: '', fields: t.fields, indexes: [] })),
  }
}

function entry(from: string, to: string, source: RenameEntry['source'] = 'manual'): RenameEntry {
  return { kind: parsePath(from).kind, from, to, source, confidence: 1 }
}

describe('parsePath / rebuildPath', () => {
  it('解析各层级路径', () => {
    expect(parsePath('db')).toEqual({ kind: 'schema', schema: 'db' })
    expect(parsePath('db/users')).toEqual({ kind: 'table', schema: 'db', table: 'users' })
    expect(parsePath('db/users.name')).toEqual({
      kind: 'field',
      schema: 'db',
      table: 'users',
      name: 'name',
    })
    expect(parsePath('db/users#idx_name')).toEqual({
      kind: 'index',
      schema: 'db',
      table: 'users',
      name: 'idx_name',
    })
  })

  it('重建路径与解析互为逆操作', () => {
    for (const p of ['db', 'db/users', 'db/users.name', 'db/users#idx_name']) {
      expect(rebuildPath(parsePath(p))).toBe(p)
    }
  })
})

describe('路径构造函数', () => {
  it('按约定拼接分隔符', () => {
    expect(tablePath('db', 'users')).toBe('db/users')
    expect(fieldPath('db', 'users', 'name')).toBe('db/users.name')
    expect(indexPath('db', 'users', 'idx_name')).toBe('db/users#idx_name')
  })
})

describe('buildRenameMap', () => {
  it('求传递闭包：a→b 与 b→c 合并出 a→c', () => {
    const { map } = buildRenameMap([
      entry('db/users', 'db/accounts'),
      entry('db/accounts', 'db/members'),
    ])
    expect(map.get('db/users')).toBe('db/members')
    expect(map.get('db/accounts')).toBe('db/members')
  })

  it('过滤未发生变化的记录', () => {
    const { map } = buildRenameMap([entry('db/users', 'db/users')])
    expect(map.size).toBe(0)
  })

  it('同一源指向多个目标时记为冲突，并采用 editor/manual 优先', () => {
    const { map, conflicts } = buildRenameMap([
      { kind: 'table', from: 'db/a', to: 'db/b', source: 'auto', confidence: 0.9 },
      entry('db/a', 'db/c', 'manual'),
    ])
    expect(map.get('db/a')).toBe('db/c')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.targets.sort()).toEqual(['db/b', 'db/c'])
  })

  it('检测到环时保持原样并登记', () => {
    const { map, cyclic } = buildRenameMap([entry('db/a', 'db/b'), entry('db/b', 'db/a')])
    expect(map.get('db/a')).toBeUndefined()
    expect(cyclic.sort()).toEqual(['db/a', 'db/b'])
  })
})

describe('resolveOldPath', () => {
  it('无改名记录时原样返回', () => {
    const lookup = buildRenameLookup(new Map())
    expect(resolveOldPath('db/users.name', lookup)).toBe('db/users.name')
  })

  it('表改名时，其下字段路径随之解析到旧表', () => {
    const lookup = buildRenameLookup(buildRenameMap([entry('db/users', 'db/accounts')]).map)
    expect(resolveOldPath('db/accounts.name', lookup)).toBe('db/users.name')
    expect(resolveOldPath('db/accounts#idx_name', lookup)).toBe('db/users#idx_name')
  })

  it('schema 改名时，其下所有对象路径随之解析', () => {
    const lookup = buildRenameLookup(buildRenameMap([entry('db', 'main')]).map)
    expect(resolveOldPath('main/users', lookup)).toBe('db/users')
    expect(resolveOldPath('main/users.name', lookup)).toBe('db/users.name')
  })

  it('schema 与 table 分别改名时仍能解析到旧路径', () => {
    const lookup = buildRenameLookup(
      buildRenameMap([entry('db', 'main'), entry('db/users', 'db/accounts')]).map,
    )
    // 新路径 main/accounts：先经 schema 反查为 db，再查 db/accounts 得到 db/users
    expect(resolveOldPath('main/accounts', lookup)).toBe('db/users')
  })
})

describe('suggestRenames', () => {
  it('为字段集合相同但表名变化的表产出建议', () => {
    const olds = [schema('db', [{ name: 'user', fields: [field('id'), field('name')] }])]
    const news = [schema('db', [{ name: 'users', fields: [field('id'), field('name')] }])]
    const result = suggestRenames(olds, news)
    expect(result).toHaveLength(1)
    expect(result[0]?.entry).toMatchObject({ kind: 'table', from: 'db/user', to: 'db/users' })
    expect(result[0]?.entry.source).toBe('auto')
  })

  it('结构完全无关时不产出建议', () => {
    const olds = [schema('db', [{ name: 'user', fields: [field('id'), field('name')] }])]
    const news = [schema('db', [{ name: 'order', fields: [field('amount'), field('price')] }])]
    expect(suggestRenames(olds, news)).toEqual([])
  })

  it('表对齐后继续推断字段改名', () => {
    const olds = [schema('db', [{ name: 't', fields: [field('user_name'), field('id')] }])]
    const news = [schema('db', [{ name: 't', fields: [field('username'), field('id')] }])]
    const result = suggestRenames(olds, news)
    expect(result).toHaveLength(1)
    expect(result[0]?.entry).toMatchObject({
      kind: 'field',
      from: 'db/t.user_name',
      to: 'db/t.username',
    })
  })

  it('schema 改名时同时推断其下对象', () => {
    const olds = [schema('old_db', [{ name: 't', fields: [field('id')] }])]
    const news = [schema('new_db', [{ name: 't', fields: [field('id')] }])]
    const result = suggestRenames(olds, news)
    const first = result[0]
    expect(first?.entry).toMatchObject({ kind: 'schema', from: 'old_db', to: 'new_db' })
  })
})
