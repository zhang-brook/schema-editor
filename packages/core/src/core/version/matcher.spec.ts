import { describe, expect, it } from 'vitest'
import type { Field, Index, Table } from '../../types/schema'
import {
  diffSemantics,
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
  it('returns 0 for identical strings', () => {
    expect(levenshtein('abc', 'abc')).toBe(0)
  })

  it('returns the other string length for an empty string', () => {
    expect(levenshtein('', 'abc')).toBe(3)
    expect(levenshtein('abc', '')).toBe(3)
  })

  it('returns distance 1 for a single character substitution', () => {
    expect(levenshtein('user', 'users')).toBe(1)
    expect(levenshtein('user', 'usir')).toBe(1)
  })
})

describe('nameSimilarity', () => {
  it('returns 1 for exactly equal names', () => {
    expect(nameSimilarity('user', 'user')).toBe(1)
  })

  it('ignores case and separator differences', () => {
    expect(nameSimilarity('user_name', 'userName')).toBe(1)
    expect(nameSimilarity('user-name', 'USER_NAME')).toBe(1)
  })

  it('returns 1 for two empty strings and 0 when one side is empty', () => {
    expect(nameSimilarity('', '')).toBe(1)
    expect(nameSimilarity('a', '')).toBe(0)
  })

  it('normalizes edit distance by the longer string', () => {
    // 'user' -> 'users' has distance 1, longer string length 5
    expect(nameSimilarity('user', 'users')).toBeCloseTo(0.8, 5)
  })

  it('returns 0 when there are no common characters', () => {
    expect(nameSimilarity('abc', 'xyz')).toBe(0)
  })
})

describe('jaccard', () => {
  it('returns 1 for two empty sets', () => {
    expect(jaccard(new Set(), new Set())).toBe(1)
  })

  it('returns 0 when one side is empty', () => {
    expect(jaccard(new Set(['a']), new Set())).toBe(0)
  })

  it('divides the intersection by the union', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3, 5)
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1)
  })
})

describe('tableSimilarity', () => {
  it('scores the field weight when field sets match but names differ', () => {
    // field Jaccard = 1, name similarity = 0 (a and b share no characters)
    const a = table('a', [field('id'), field('name')])
    const b = table('b', [field('id'), field('name')])
    expect(tableSimilarity(a, b)).toBeCloseTo(0.7, 5)
  })

  it('returns 0 when field sets are disjoint and names unrelated', () => {
    const a = table('a', [field('id'), field('name')])
    const b = table('b', [field('x'), field('y')])
    expect(tableSimilarity(a, b)).toBe(0)
  })

  it('returns 1 for identical tables', () => {
    const a = table('t', [field('id')])
    expect(tableSimilarity(a, table('t', [field('id')]))).toBe(1)
  })
})

describe('fieldSimilarity', () => {
  it('scores the name weight when semantic attributes match but names differ', () => {
    const a = field('a', { field_type: 'int', not_null: true })
    const b = field('b', { field_type: 'int', not_null: true })
    // all semantics identical = 1, name similarity = 0
    expect(fieldSimilarity(a, b)).toBeCloseTo(0.5, 5)
  })

  it('lowers the score when types differ', () => {
    const a = field('a', { field_type: 'int' })
    const different = field('a', { field_type: 'varchar' })
    const same = field('a', { field_type: 'int' })
    // semantic attribute match ratio is 0, only the name weight remains
    expect(fieldSimilarity(a, different)).toBeCloseTo(0.5, 5)
    expect(fieldSimilarity(a, different)).toBeLessThan(fieldSimilarity(a, same))
  })

  it('ignores attributes unset on both sides', () => {
    // only field_type is set and equal, the rest are undefined, so the semantic match ratio should be 1
    const a = field('a', { field_type: 'int' })
    const b = field('a', { field_type: 'int' })
    expect(fieldSimilarity(a, b)).toBe(1)
  })
})

describe('matchByScore', () => {
  it('pairs greedily by descending score without reusing either side', () => {
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

  it('does not pair candidates below the threshold', () => {
    const result = matchByScore(1, 1, () => 0.4, { threshold: 0.5 })
    expect(result.pairs).toEqual([])
    expect(result.unmatchedFrom).toEqual([0])
    expect(result.unmatchedTo).toEqual([0])
  })

  it('flags ambiguity when scores are close', () => {
    // from 0 scores 0.9 / 0.85 against to 0/1, difference 0.05 < 0.12
    const scores = [
      [0.9, 0.85],
      [0.1, 0.1],
    ]
    const result = matchByScore(2, 2, (i, j) => scores[i]?.[j] ?? 0)
    expect(result.pairs).toHaveLength(1)
    expect(result.ambiguous).toHaveLength(1)
    expect(result.ambiguous[0]?.map(c => c.to)).toEqual([0, 1])
  })

  it('does not flag ambiguity when scores differ clearly', () => {
    const scores = [
      [0.95, 0.6],
      [0.1, 0.1],
    ]
    const result = matchByScore(2, 2, (i, j) => scores[i]?.[j] ?? 0)
    expect(result.ambiguous).toEqual([])
  })
})

describe('matchTables', () => {
  it('detects tables with identical field sets but changed names', () => {
    const olds = [table('user', [field('id'), field('name')])]
    const news = [table('users', [field('id'), field('name')])]
    const result = matchTables(olds, news)
    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0]).toMatchObject({ from: 0, to: 0 })
  })

  it('does not pair structurally unrelated tables', () => {
    const olds = [table('user', [field('id'), field('name')])]
    const news = [table('order', [field('amount'), field('price')])]
    const result = matchTables(olds, news)
    expect(result.pairs).toEqual([])
  })

  it('known limitation: swapped names with identical field sets are conservatively treated as unchanged', () => {
    // b and c have exactly the same field sets; after swapping, b->b and c->c both score 1, higher than 0.7 for cross pairing
    const olds = [table('b', [field('id')]), table('c', [field('id')])]
    const news = [table('c', [field('id')]), table('b', [field('id')])]
    const result = matchTables(olds, news)
    // judged as b->b, c->c, i.e. "unchanged"; such cases need manual linking by the user
    expect(result.pairs).toEqual([
      { from: 0, to: 1, score: 1 },
      { from: 1, to: 0, score: 1 },
    ])
  })
})

describe('matchFields', () => {
  it('detects renames of fields with the same type', () => {
    const olds = [field('user_name', { field_type: 'varchar', field_length: 64 })]
    const news = [field('username', { field_type: 'varchar', field_length: 64 })]
    const result = matchFields(olds, news)
    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0]?.score).toBeGreaterThan(0.9)
  })

  it('does not pair fields differing in both type and name', () => {
    const olds = [field('age', { field_type: 'int' })]
    const news = [field('zzz', { field_type: 'text' })]
    const result = matchFields(olds, news)
    expect(result.pairs).toEqual([])
  })
})

describe('index-level matching', () => {
  it('still pairs when column sets match but names changed', async () => {
    const { matchIndexes } = await import('./matcher')
    const mk = (name: string): Index => ({ name, type: 'index', columns: [{ name: 'user_id' }] })
    const result = matchIndexes([mk('idx_uid')], [mk('idx_user_id')])
    expect(result.pairs).toHaveLength(1)
  })
})

describe('diffSemantics', () => {
  it('reports only changed keys with old/new tuples as values', () => {
    const a = field('u', { field_type: 'varchar', field_length: 32, not_null: true })
    const b = field('u', { field_type: 'varchar', field_length: 64, not_null: true })
    expect(diffSemantics(a, b, ['field_type', 'field_length', 'not_null'])).toEqual({
      field_length: [32, 64],
    })
  })

  it('treats a missing key and an explicit undefined as equal', () => {
    expect(diffSemantics(field('u'), field('u', { comment: undefined }), ['comment'])).toEqual({})
  })

  it('treats null vs empty string and false vs 0 as changes', () => {
    expect(diffSemantics(field('u', { default: null }), field('u', { default: '' }), ['default'])).toEqual({
      default: [null, ''],
    })
    expect(diffSemantics(field('u', { not_null: false }), field('u', { not_null: true }), ['not_null'])).toEqual({
      not_null: [false, true],
    })
  })

  it('compares nested structures with key order sensitivity', () => {
    const keys = ['mysql'] as const
    const a = field('u', { mysql: { field_type: 'int', default: 1 } })
    const b = field('u', { mysql: { default: 1, field_type: 'int' } })
    expect(diffSemantics(a, b, keys)).toEqual({ mysql: [a.mysql, b.mysql] })
    expect(diffSemantics(a, field('u', { mysql: { field_type: 'int', default: 1 } }), keys)).toEqual({})
  })

  it('returns an empty object when nothing changed', () => {
    const a = field('u', { field_type: 'int', field_length: 4 })
    expect(diffSemantics(a, { ...a }, ['field_type', 'field_length'])).toEqual({})
  })
})
