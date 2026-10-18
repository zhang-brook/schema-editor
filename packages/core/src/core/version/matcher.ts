/**
 * Similarity inference engine: when no rename records are available, guess whether "an object missing from the
 * old structure" and "an object added in the new structure" are the same object renamed.
 *
 * Design boundaries (important):
 * - Only basic signals are used: table level combines field-set Jaccard + name similarity; field level combines semantic-attribute match ratio + name similarity.
 * - Renames are theoretically undecidable in some cases: if two tables have identical field sets and only swap names (b ↔ c),
 *   the similarity matrix is symmetric and no algorithm can distinguish "swapped" from "unchanged"; this engine conservatively reports unchanged.
 *   Such cases must be corrected by the user through manual linking in the migration editor.
 * - This module is pure functions with no FS / reactive dependencies.
 */
import type { Field, Index, Table } from '../../types/schema'

/** Attributes participating in field semantic comparison (excluding field_name, which nameSimilarity scores separately) */
export const FIELD_SEMANTIC_KEYS: (keyof Field)[] = [
  'unified_type',
  'field_type',
  'field_length',
  'field_scale',
  'not_null',
  'primary_key',
  'default',
  'quote_default',
  'comment',
  'is_commented_out',
  'field_length_disabled',
  'field_scale_disabled',
  'use_common_used_fields',
  'mysql',
  'postgresql',
  'sqlite',
]

/** Compare two objects on the given attributes; return changed attributes → [old value, new value] */
export function diffSemantics<T extends object>(a: T, b: T, keys: readonly (keyof T)[]): Record<string, [unknown, unknown]> {
  const changes: Record<string, [unknown, unknown]> = {}
  for (const key of keys) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) changes[String(key)] = [a[key], b[key]]
  }
  return changes
}

/** Candidates scoring below this are treated as unrelated */
export const MATCH_THRESHOLD = 0.5
/** If the gap between the best and second-best score is below this, treat it as ambiguous and let the user decide */
export const AMBIGUITY_MARGIN = 0.12

/** Score component weights */
const W_TABLE_FIELDS = 0.7
const W_TABLE_NAME = 0.3
const W_FIELD_SEMANTIC = 0.5
const W_FIELD_NAME = 0.5
const W_INDEX_COLUMNS = 0.6
const W_INDEX_NAME = 0.4

// ===== Name similarity =====

/** Compute Levenshtein edit distance (rolling arrays, O(min(m,n)) space) */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  // Ensure the inner array is the shorter one
  let prev: number[] = []
  let curr: number[] = []
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      const deletion = (prev[j] ?? 0) + 1
      const insertion = (curr[j - 1] ?? 0) + 1
      const substitution = (prev[j - 1] ?? 0) + cost
      curr[j] = Math.min(deletion, insertion, substitution)
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }
  return prev[b.length] ?? b.length
}

/** Name normalization: ignore case and separator differences so user_name and userName are equivalent */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s_\-.]/g, '')
}

/**
 * Name similarity 0-1: 1 when identical, edit distance normalized by the longer string.
 * Two empty strings count as 1; an empty and a non-empty string count as 0.
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a ?? '')
  const nb = normalizeName(b ?? '')
  if (!na && !nb) return 1
  if (!na || !nb) return 0
  if (na === nb) return 1
  const max = Math.max(na.length, nb.length)
  return 1 - levenshtein(na, nb) / max
}

// ===== Set similarity =====

/** Jaccard similarity of two sets: |intersection| / |union| */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const v of a) if (b.has(v)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/** Field-set signature (normalized field names) */
function fieldNameSet(table: Table): Set<string> {
  return new Set(table.fields.map(f => normalizeName(f.field_name ?? '')))
}

/** Set of index column signatures */
function indexColumnSet(index: Index): Set<string> {
  return new Set(index.columns.map(c => normalizeName(c.name ?? '')))
}

// ===== Object similarity =====

/** Table-level similarity: field sets primary, names secondary */
export function tableSimilarity(a: Table, b: Table): number {
  const fields = jaccard(fieldNameSet(a), fieldNameSet(b))
  // Only worth considering when the field sets are identical, which avoids mismatching structurally different tables
  const name = nameSimilarity(a.name ?? '', b.name ?? '')
  return W_TABLE_FIELDS * fields + W_TABLE_NAME * name
}

/**
 * Field-level similarity: semantic attribute match ratio primary, names secondary.
 * Only attributes where at least one side has a value are counted, so many undefined values do not inflate the score.
 */
export function fieldSimilarity(a: Field, b: Field): number {
  let compared = 0
  let same = 0
  for (const k of FIELD_SEMANTIC_KEYS) {
    const av = a[k]
    const bv = b[k]
    if (av === undefined && bv === undefined) continue
    compared++
    if (JSON.stringify(av) === JSON.stringify(bv)) same++
  }
  const semantic = compared === 0 ? 1 : same / compared
  const name = nameSimilarity(a.field_name ?? '', b.field_name ?? '')
  return W_FIELD_SEMANTIC * semantic + W_FIELD_NAME * name
}

/** Index similarity: column sets primary, names secondary */
export function indexSimilarity(a: Index, b: Index): number {
  const columns = jaccard(indexColumnSet(a), indexColumnSet(b))
  const name = nameSimilarity(a.name ?? '', b.name ?? '')
  return W_INDEX_COLUMNS * columns + W_INDEX_NAME * name
}

// ===== Best pairing =====

export interface MatchCandidate {
  /** Source collection index */
  from: number
  /** Target collection index */
  to: number
  score: number
}

export interface MatchResult {
  /** Pairing result, in descending score order */
  pairs: MatchCandidate[]
  /** Unmatched source indexes */
  unmatchedFrom: number[]
  /** Unmatched target indexes */
  unmatchedTo: number[]
  /**
   * Ambiguity groups: one source has multiple close-scoring candidates (or one target is contested by multiple sources).
   * Within each group, candidates are in descending score order; the UI should ask the user to confirm.
   */
  ambiguous: MatchCandidate[][]
}

/**
 * Pair objects between two collections: greedily assign in descending score order, then flag ambiguities.
 *
 * Greedy rather than Hungarian: at this project's scale the difference is negligible, and greedy readily yields runner-up candidates for ambiguity hints.
 * The trade-off is that extreme cases are not globally optimal, but combined with the ambiguous hints this is sufficient.
 */
export function matchByScore(
  fromCount: number,
  toCount: number,
  score: (i: number, j: number) => number,
  options?: { threshold?: number; ambiguityMargin?: number },
): MatchResult {
  const threshold = options?.threshold ?? MATCH_THRESHOLD
  const margin = options?.ambiguityMargin ?? AMBIGUITY_MARGIN

  // Collect all candidates above the threshold
  const all: MatchCandidate[] = []
  for (let i = 0; i < fromCount; i++) {
    for (let j = 0; j < toCount; j++) {
      const s = score(i, j)
      if (s >= threshold) all.push({ from: i, to: j, score: s })
    }
  }
  all.sort((a, b) => b.score - a.score)

  // Greedy assignment
  const usedFrom = new Set<number>()
  const usedTo = new Set<number>()
  const pairs: MatchCandidate[] = []
  for (const c of all) {
    if (usedFrom.has(c.from) || usedTo.has(c.to)) continue
    usedFrom.add(c.from)
    usedTo.add(c.to)
    pairs.push(c)
  }

  // Ambiguity flagging: for each source, find qualifying candidates that were not chosen and group those close to the chosen one
  const ambiguous: MatchCandidate[][] = []
  const byFrom = new Map<number, MatchCandidate[]>()
  for (const c of all) {
    const list = byFrom.get(c.from)
    if (list) list.push(c)
    else byFrom.set(c.from, [c])
  }
  for (const c of pairs) {
    const candidates = byFrom.get(c.from)
    if (!candidates || candidates.length < 2) continue
    const rivals = candidates.filter(x => x.to !== c.to && c.score - x.score <= margin)
    if (rivals.length > 0) ambiguous.push([c, ...rivals])
  }

  const unmatchedFrom: number[] = []
  for (let i = 0; i < fromCount; i++) if (!usedFrom.has(i)) unmatchedFrom.push(i)
  const unmatchedTo: number[] = []
  for (let j = 0; j < toCount; j++) if (!usedTo.has(j)) unmatchedTo.push(j)

  return { pairs, unmatchedFrom, unmatchedTo, ambiguous }
}

/** Convenience entry point for table-level pairing */
export function matchTables(oldTables: Table[], newTables: Table[]): MatchResult {
  return matchByScore(oldTables.length, newTables.length, (i, j) => {
    const a = oldTables[i]
    const b = newTables[j]
    return a && b ? tableSimilarity(a, b) : 0
  })
}

/** Convenience entry point for field-level pairing */
export function matchFields(oldFields: Field[], newFields: Field[]): MatchResult {
  return matchByScore(oldFields.length, newFields.length, (i, j) => {
    const a = oldFields[i]
    const b = newFields[j]
    return a && b ? fieldSimilarity(a, b) : 0
  })
}

/** Convenience entry point for index-level pairing */
export function matchIndexes(oldIndexes: Index[], newIndexes: Index[]): MatchResult {
  return matchByScore(oldIndexes.length, newIndexes.length, (i, j) => {
    const a = oldIndexes[i]
    const b = newIndexes[j]
    return a && b ? indexSimilarity(a, b) : 0
  })
}

