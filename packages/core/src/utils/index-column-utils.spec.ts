import { describe, it, expect } from 'vitest'
import type { Index } from '../types/schema'
import { createIndexFieldRemoval } from './index-column-utils'

function makeIndexes(): Index[] {
  return [
    { type: 'index', name: 'idx_single', columns: [{ name: 'age' }] },
    { type: 'index', name: 'idx_multi', columns: [{ name: 'name' }, { name: 'age', sort_order: 'DESC' }, { name: 'email' }] },
    { type: 'index', name: 'idx_other', columns: [{ name: 'email' }] },
  ]
}

describe('createIndexFieldRemoval', () => {
  it('removes only the matching column from a multi-column index, keeping the index', () => {
    const indexes = makeIndexes()
    createIndexFieldRemoval(indexes, 'email').apply()
    expect(indexes.map(i => i.name)).toEqual(['idx_single', 'idx_multi'])
    expect(indexes[1]!.columns).toEqual([{ name: 'name' }, { name: 'age', sort_order: 'DESC' }])
  })

  it('removes an index entirely when only that column remains', () => {
    const indexes = makeIndexes()
    createIndexFieldRemoval(indexes, 'age').apply()
    expect(indexes.map(i => i.name)).toEqual(['idx_multi', 'idx_other'])
    expect(indexes[0]!.columns).toEqual([{ name: 'name' }, { name: 'email' }])
  })

  it('undo restores removed columns and entirely removed indexes (including their original positions)', () => {
    const indexes = makeIndexes()
    const removal = createIndexFieldRemoval(indexes, 'age')
    removal.apply()
    removal.restore()
    expect(indexes).toEqual(makeIndexes())
  })

  it('restores both order and columns after undo when multiple indexes are removed entirely at once', () => {
    const indexes: Index[] = [
      { type: 'index', name: 'a', columns: [{ name: 'x' }] },
      { type: 'index', name: 'b', columns: [{ name: 'email' }] },
      { type: 'index', name: 'c', columns: [{ name: 'y' }, { name: 'email' }] },
      { type: 'index', name: 'd', columns: [{ name: 'email', sort_order: 'DESC' }] },
    ]
    const removal = createIndexFieldRemoval(indexes, 'email')
    removal.apply()
    expect(indexes.map(i => i.name)).toEqual(['a', 'c'])
    expect(indexes[1]!.columns).toEqual([{ name: 'y' }])
    removal.restore()
    expect(indexes.map(i => i.name)).toEqual(['a', 'b', 'c', 'd'])
    expect(indexes[2]!.columns).toEqual([{ name: 'y' }, { name: 'email' }])
    expect(indexes[3]!.columns).toEqual([{ name: 'email', sort_order: 'DESC' }])
  })

  it('repeated apply is idempotent, and undo still returns to the initial state', () => {
    const indexes = makeIndexes()
    const removal = createIndexFieldRemoval(indexes, 'age')
    removal.apply()
    removal.apply()
    expect(indexes.map(i => i.name)).toEqual(['idx_multi', 'idx_other'])
    removal.restore()
    expect(indexes).toEqual(makeIndexes())
  })

  it('makes no changes when the field is not referenced by any index or the field name is empty', () => {
    const indexes = makeIndexes()
    createIndexFieldRemoval(indexes, 'not_exists').apply()
    expect(indexes).toEqual(makeIndexes())
    createIndexFieldRemoval(indexes, '').apply()
    expect(indexes).toEqual(makeIndexes())
  })
})
