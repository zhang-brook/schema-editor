import { describe, expect, it } from 'vitest'
import type { Field, Index, Table } from '@/types/schema'
import {
  fieldSimilarity,
  jaccard,
  levenshtein,
  matchByScore,
  matchFields,
  matchTables,
  nameSimilarity,
  tableSimilarity,
} from './matcher'

function field(name: string, extra: Partial<Field> = {}): Field {
  return { field_name: name, field_type: 'varchar', ...extra }
}

function table(name: string, fields: Field[]): Table {
  return { name, comment: '', fields, indexes: [] }
}

describe('levenshtein', () => {
  it('相同字符串距离为 0', () => {
    expect(levenshtein('abc', 'abc')).toBe(0)
  })

  it('空串距离为另一串长度', () => {
    expect(levenshtein('', 'abc')).toBe(3)
    expect(levenshtein('abc', '')).toBe(3)
  })

  it('单字符替换距离为 1', () => {
    expect(levenshtein('user', 'users')).toBe(1)
    expect(levenshtein('user', 'usir')).toBe(1)
  })
})

describe('nameSimilarity', () => {
  it('完全相等为 1', () => {
    expect(nameSimilarity('user', 'user')).toBe(1)
  })

  it('忽略大小写与分隔符差异', () => {
    expect(nameSimilarity('user_name', 'userName')).toBe(1)
    expect(nameSimilarity('user-name', 'USER_NAME')).toBe(1)
  })

  it('两个空串为 1，一侧为空为 0', () => {
    expect(nameSimilarity('', '')).toBe(1)
    expect(nameSimilarity('a', '')).toBe(0)
  })

  it('按较长串归一化编辑距离', () => {
    // 'user' -> 'users' 距离 1，较长串长度 5
    expect(nameSimilarity('user', 'users')).toBeCloseTo(0.8, 5)
  })

  it('毫无共同字符时为 0', () => {
    expect(nameSimilarity('abc', 'xyz')).toBe(0)
  })
})

describe('jaccard', () => {
  it('两个空集为 1', () => {
    expect(jaccard(new Set(), new Set())).toBe(1)
  })

  it('一侧为空为 0', () => {
    expect(jaccard(new Set(['a']), new Set())).toBe(0)
  })

  it('交集除以并集', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3, 5)
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1)
  })
})

describe('tableSimilarity', () => {
  it('字段集合相同、名称不同时得分为字段权重', () => {
    // 字段 Jaccard = 1，名称相似度 = 0（a 与 b 无共同字符）
    const a = table('a', [field('id'), field('name')])
    const b = table('b', [field('id'), field('name')])
    expect(tableSimilarity(a, b)).toBeCloseTo(0.7, 5)
  })

  it('字段集合完全不同且名称无关时为 0', () => {
    const a = table('a', [field('id'), field('name')])
    const b = table('b', [field('x'), field('y')])
    expect(tableSimilarity(a, b)).toBe(0)
  })

  it('完全一致为 1', () => {
    const a = table('t', [field('id')])
    expect(tableSimilarity(a, table('t', [field('id')]))).toBe(1)
  })
})

describe('fieldSimilarity', () => {
  it('语义属性相同、名称不同时为名称权重', () => {
    const a = field('a', { field_type: 'int', not_null: true })
    const b = field('b', { field_type: 'int', not_null: true })
    // 语义全同 = 1，名称相似度 = 0
    expect(fieldSimilarity(a, b)).toBeCloseTo(0.5, 5)
  })

  it('类型不同会降低分数', () => {
    const a = field('a', { field_type: 'int' })
    const different = field('a', { field_type: 'varchar' })
    const same = field('a', { field_type: 'int' })
    // 语义属性匹配比例为 0，仅剩名称权重
    expect(fieldSimilarity(a, different)).toBeCloseTo(0.5, 5)
    expect(fieldSimilarity(a, different)).toBeLessThan(fieldSimilarity(a, same))
  })

  it('忽略两侧都未设置的属性', () => {
    // 只有 field_type 有值且相同，其余均为 undefined，语义匹配比例应为 1
    const a = field('a', { field_type: 'int' })
    const b = field('a', { field_type: 'int' })
    expect(fieldSimilarity(a, b)).toBe(1)
  })
})

describe('matchByScore', () => {
  it('按分数降序贪心配对，两端不重复使用', () => {
    const scores = [
      [1.0, 0.9],
      [0.9, 1.0],
    ]
    const result = matchByScore(2, 2, (i, j) => scores[i]?.[j] ?? 0)
    expect(result.pairs).toEqual([
      { from: 0, to: 0, score: 1.0 },
      { from: 1, to: 1, score: 1.0 },
    ])
    expect(result.unmatchedFrom).toEqual([])
    expect(result.unmatchedTo).toEqual([])
  })

  it('低于阈值的候选不参与配对', () => {
    const result = matchByScore(1, 1, () => 0.4, { threshold: 0.5 })
    expect(result.pairs).toEqual([])
    expect(result.unmatchedFrom).toEqual([0])
    expect(result.unmatchedTo).toEqual([0])
  })

  it('分数接近时标注歧义', () => {
    // from 0 对 to 0/1 分数分别为 0.9 / 0.85，差值 0.05 < 0.12
    const scores = [
      [0.9, 0.85],
      [0.1, 0.1],
    ]
    const result = matchByScore(2, 2, (i, j) => scores[i]?.[j] ?? 0)
    expect(result.pairs).toHaveLength(1)
    expect(result.ambiguous).toHaveLength(1)
    expect(result.ambiguous[0]?.map(c => c.to)).toEqual([0, 1])
  })

  it('分数差距明显时不标注歧义', () => {
    const scores = [
      [0.95, 0.6],
      [0.1, 0.1],
    ]
    const result = matchByScore(2, 2, (i, j) => scores[i]?.[j] ?? 0)
    expect(result.ambiguous).toEqual([])
  })
})

describe('matchTables', () => {
  it('识别字段集合相同但名称变更的表', () => {
    const olds = [table('user', [field('id'), field('name')])]
    const news = [table('users', [field('id'), field('name')])]
    const result = matchTables(olds, news)
    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0]).toMatchObject({ from: 0, to: 0 })
  })

  it('结构无关的表不配对', () => {
    const olds = [table('user', [field('id'), field('name')])]
    const news = [table('order', [field('amount'), field('price')])]
    const result = matchTables(olds, news)
    expect(result.pairs).toEqual([])
  })

  it('已知限制：字段集合完全一致的名称对调被保守判为未变', () => {
    // b 与 c 字段集合完全相同，对调后 b->b、c->c 分数均为 1，高于交叉配对的 0.7
    const olds = [table('b', [field('id')]), table('c', [field('id')])]
    const news = [table('c', [field('id')]), table('b', [field('id')])]
    const result = matchTables(olds, news)
    // 判为 b->b、c->c 即「未变」，这类场景需用户手工连线纠正
    expect(result.pairs).toEqual([
      { from: 0, to: 1, score: 1 },
      { from: 1, to: 0, score: 1 },
    ])
  })
})

describe('matchFields', () => {
  it('识别同类型字段的改名', () => {
    const olds = [field('user_name', { field_type: 'varchar', field_length: 64 })]
    const news = [field('username', { field_type: 'varchar', field_length: 64 })]
    const result = matchFields(olds, news)
    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0]?.score).toBeGreaterThan(0.9)
  })

  it('类型与名称均不同的字段不配对', () => {
    const olds = [field('age', { field_type: 'int' })]
    const news = [field('zzz', { field_type: 'text' })]
    const result = matchFields(olds, news)
    expect(result.pairs).toEqual([])
  })
})

describe('索引级配对', () => {
  it('列集合相同、名称变更时仍可配对', async () => {
    const { matchIndexes } = await import('./matcher')
    const mk = (name: string): Index => ({ name, type: 'index', columns: [{ name: 'user_id' }] })
    const result = matchIndexes([mk('idx_uid')], [mk('idx_user_id')])
    expect(result.pairs).toHaveLength(1)
  })
})
