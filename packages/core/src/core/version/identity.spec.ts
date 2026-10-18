import { describe, expect, it } from 'vitest'
import type { Field, Schema } from '../../types/schema'
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
  it('parses paths at every level', () => {
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

  it('rebuilds paths as the inverse of parsing', () => {
    for (const p of ['db', 'db/users', 'db/users.name', 'db/users#idx_name']) {
      expect(rebuildPath(parsePath(p))).toBe(p)
    }
  })
})

describe('path builders', () => {
  it('joins separators by convention', () => {
    expect(tablePath('db', 'users')).toBe('db/users')
    expect(fieldPath('db', 'users', 'name')).toBe('db/users.name')
    expect(indexPath('db', 'users', 'idx_name')).toBe('db/users#idx_name')
  })
})

describe('buildRenameMap', () => {
  it('computes the transitive closure: a→b and b→c merge into a→c', () => {
    const { map } = buildRenameMap([
      entry('db/users', 'db/accounts'),
      entry('db/accounts', 'db/members'),
    ])
    expect(map.get('db/users')).toBe('db/members')
    expect(map.get('db/accounts')).toBe('db/members')
  })

  it('filters out records that did not change', () => {
    const { map } = buildRenameMap([entry('db/users', 'db/users')])
    expect(map.size).toBe(0)
  })

  it('records a conflict when one source points to multiple targets, preferring editor/manual', () => {
    const { map, conflicts } = buildRenameMap([
      { kind: 'table', from: 'db/a', to: 'db/b', source: 'auto', confidence: 0.9 },
      entry('db/a', 'db/c', 'manual'),
    ])
    expect(map.get('db/a')).toBe('db/c')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.targets.sort()).toEqual(['db/b', 'db/c'])
  })

  it('leaves cycles unchanged and records them', () => {
    const { map, cyclic } = buildRenameMap([entry('db/a', 'db/b'), entry('db/b', 'db/a')])
    expect(map.get('db/a')).toBeUndefined()
    expect(cyclic.sort()).toEqual(['db/a', 'db/b'])
  })
})

describe('resolveOldPath', () => {
  it('returns the path unchanged when there are no rename records', () => {
    const lookup = buildRenameLookup(new Map())
    expect(resolveOldPath('db/users.name', lookup)).toBe('db/users.name')
  })

  it('resolves field paths under a renamed table back to the old table', () => {
    const lookup = buildRenameLookup(buildRenameMap([entry('db/users', 'db/accounts')]).map)
    expect(resolveOldPath('db/accounts.name', lookup)).toBe('db/users.name')
    expect(resolveOldPath('db/accounts#idx_name', lookup)).toBe('db/users#idx_name')
  })

  it('resolves paths of all objects under a renamed schema', () => {
    const lookup = buildRenameLookup(buildRenameMap([entry('db', 'main')]).map)
    expect(resolveOldPath('main/users', lookup)).toBe('db/users')
    expect(resolveOldPath('main/users.name', lookup)).toBe('db/users.name')
  })

  it('still resolves to the old path when both schema and table are renamed', () => {
    const lookup = buildRenameLookup(
      buildRenameMap([entry('db', 'main'), entry('db/users', 'db/accounts')]).map,
    )
    // new path main/accounts: reverse the schema to db first, then look up db/accounts to get db/users
    expect(resolveOldPath('main/accounts', lookup)).toBe('db/users')
  })
})

describe('suggestRenames', () => {
  it('suggests renames for tables with identical field sets but changed names', () => {
    const olds = [schema('db', [{ name: 'user', fields: [field('id'), field('name')] }])]
    const news = [schema('db', [{ name: 'users', fields: [field('id'), field('name')] }])]
    const result = suggestRenames(olds, news)
    expect(result).toHaveLength(1)
    expect(result[0]?.entry).toMatchObject({ kind: 'table', from: 'db/user', to: 'db/users' })
    expect(result[0]?.entry.source).toBe('auto')
  })

  it('suggests nothing when structures are entirely unrelated', () => {
    const olds = [schema('db', [{ name: 'user', fields: [field('id'), field('name')] }])]
    const news = [schema('db', [{ name: 'order', fields: [field('amount'), field('price')] }])]
    expect(suggestRenames(olds, news)).toEqual([])
  })

  it('infers field renames after aligning tables', () => {
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

  it('infers nested objects when a schema is renamed', () => {
    const olds = [schema('old_db', [{ name: 't', fields: [field('id')] }])]
    const news = [schema('new_db', [{ name: 't', fields: [field('id')] }])]
    const result = suggestRenames(olds, news)
    const first = result[0]
    expect(first?.entry).toMatchObject({ kind: 'schema', from: 'old_db', to: 'new_db' })
  })
})
