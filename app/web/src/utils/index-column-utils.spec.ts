import { describe, it, expect } from 'vitest'
import type { Index } from '@/types/schema'
import { createIndexFieldRemoval } from './index-column-utils'

function makeIndexes(): Index[] {
  return [
    { type: 'index', name: 'idx_single', columns: [{ name: 'age' }] },
    { type: 'index', name: 'idx_multi', columns: [{ name: 'name' }, { name: 'age', sort_order: 'DESC' }, { name: 'email' }] },
    { type: 'index', name: 'idx_other', columns: [{ name: 'email' }] },
  ]
}

describe('createIndexFieldRemoval', () => {
  it('多列索引只移除对应列，索引保留', () => {
    const indexes = makeIndexes()
    createIndexFieldRemoval(indexes, 'email').apply()
    expect(indexes.map(i => i.name)).toEqual(['idx_single', 'idx_multi'])
    expect(indexes[1]!.columns).toEqual([{ name: 'name' }, { name: 'age', sort_order: 'DESC' }])
  })

  it('仅剩该列的索引被整体移除', () => {
    const indexes = makeIndexes()
    createIndexFieldRemoval(indexes, 'age').apply()
    expect(indexes.map(i => i.name)).toEqual(['idx_multi', 'idx_other'])
    expect(indexes[0]!.columns).toEqual([{ name: 'name' }, { name: 'email' }])
  })

  it('撤销后恢复被移除的列与被整体移除的索引（含原位置）', () => {
    const indexes = makeIndexes()
    const removal = createIndexFieldRemoval(indexes, 'age')
    removal.apply()
    removal.restore()
    expect(indexes).toEqual(makeIndexes())
  })

  it('多个索引同时被整体移除时，撤销后顺序与列均恢复', () => {
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

  it('重复 apply 幂等，且撤销后仍回到初始状态', () => {
    const indexes = makeIndexes()
    const removal = createIndexFieldRemoval(indexes, 'age')
    removal.apply()
    removal.apply()
    expect(indexes.map(i => i.name)).toEqual(['idx_multi', 'idx_other'])
    removal.restore()
    expect(indexes).toEqual(makeIndexes())
  })

  it('字段未被任何索引引用或字段名为空时无改动', () => {
    const indexes = makeIndexes()
    createIndexFieldRemoval(indexes, 'not_exists').apply()
    expect(indexes).toEqual(makeIndexes())
    createIndexFieldRemoval(indexes, '').apply()
    expect(indexes).toEqual(makeIndexes())
  })
})
