/**
 * 相似度推断引擎：在没有改名记录可依据时，猜测「旧结构里消失的对象」与「新结构里新增的对象」
 * 是否为同一个对象的改名。
 *
 * 设计边界（重要）：
 * - 只做最基础的信号：表级用「字段集合 Jaccard + 名称相似度」，字段级用「语义属性匹配度 + 名称相似度」。
 * - 改名存在理论上的不可判定情况：若两个表字段集合完全一致且仅互换名称（b ↔ c），
 *   相似度矩阵对称，任何算法都无法区分「对调」与「未变」，此时本引擎会保守地判为未变。
 *   这类场景必须由用户在迁移编辑器中手工连线纠正。
 * - 本模块为纯函数，不依赖 FS / reactive。
 */
import type { Field, Index, Table } from '@/types/schema'

/** 参与字段语义对比的属性（不含 field_name，名称由 nameSimilarity 单独打分） */
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

/** 低于该分数的候选直接视为「不相关」 */
export const MATCH_THRESHOLD = 0.5

/** 最优与次优分数差小于该值时，认为存在歧义，需交由用户确认 */
export const AMBIGUITY_MARGIN = 0.12

/** 分数构成权重 */
const W_TABLE_FIELDS = 0.7
const W_TABLE_NAME = 0.3
const W_FIELD_SEMANTIC = 0.5
const W_FIELD_NAME = 0.5
const W_INDEX_COLUMNS = 0.6
const W_INDEX_NAME = 0.4

// ===== 名称相似度 =====

/** 计算 Levenshtein 编辑距离（滚动数组，空间 O(min(m,n))） */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  // 保证内层数组更短
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

/** 名称归一化：忽略大小写与分隔符差异，使 user_name 与 userName 等价 */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s_\-.]/g, '')
}

/**
 * 名称相似度 0~1：完全相等为 1，编辑距离按较长串归一化。
 * 空串与空串视为 1，空串与非空串视为 0。
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

// ===== 集合相似度 =====

/** 两个集合的 Jaccard 相似度：|交集| / |并集| */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const v of a) if (b.has(v)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/** 字段集合签名（归一化字段名） */
function fieldNameSet(table: Table): Set<string> {
  return new Set(table.fields.map(f => normalizeName(f.field_name ?? '')))
}

/** 索引列签名集合 */
function indexColumnSet(index: Index): Set<string> {
  return new Set(index.columns.map(c => normalizeName(c.name ?? '')))
}

// ===== 对象相似度 =====

/** 表级相似度：字段集合为主，名称为辅 */
export function tableSimilarity(a: Table, b: Table): number {
  const fields = jaccard(fieldNameSet(a), fieldNameSet(b))
  // 字段集合完全相同时才值得考虑，避免把结构迥异的表误配
  const name = nameSimilarity(a.name ?? '', b.name ?? '')
  return W_TABLE_FIELDS * fields + W_TABLE_NAME * name
}

/**
 * 字段级相似度：语义属性匹配比例为主，名称为辅。
 * 仅统计两侧「至少一侧有值」的属性，避免大量 undefined 拉高分数。
 */
export function fieldSimilarity(a: Field, b: Field): number {
  let compared = 0
  let same = 0
  for (const k of FIELD_SEMANTIC_KEYS) {
    const av = (a as unknown as Record<string, unknown>)[k]
    const bv = (b as unknown as Record<string, unknown>)[k]
    if (av === undefined && bv === undefined) continue
    compared++
    if (JSON.stringify(av) === JSON.stringify(bv)) same++
  }
  const semantic = compared === 0 ? 1 : same / compared
  const name = nameSimilarity(a.field_name ?? '', b.field_name ?? '')
  return W_FIELD_SEMANTIC * semantic + W_FIELD_NAME * name
}

/** 索引相似度：列集合为主，名称为辅 */
export function indexSimilarity(a: Index, b: Index): number {
  const columns = jaccard(indexColumnSet(a), indexColumnSet(b))
  const name = nameSimilarity(a.name ?? '', b.name ?? '')
  return W_INDEX_COLUMNS * columns + W_INDEX_NAME * name
}

// ===== 最优配对 =====

export interface MatchCandidate {
  /** 源集合下标 */
  from: number
  /** 目标集合下标 */
  to: number
  score: number
}

export interface MatchResult {
  /** 配对结果，按分数降序 */
  pairs: MatchCandidate[]
  /** 未配对的源下标 */
  unmatchedFrom: number[]
  /** 未配对的目标下标 */
  unmatchedTo: number[]
  /**
   * 歧义组：同一源存在多个分数接近的候选（或同一目标被多个源争抢）。
   * 每组内 candidates 按分数降序，UI 应提示用户确认。
   */
  ambiguous: MatchCandidate[][]
}

/**
 * 在两组对象间求配对：先按分数降序贪心分配，再标注歧义。
 *
 * 贪心而非匈牙利算法：项目规模下差距极小，且贪心便于产出「次优候选」用于歧义提示。
 * 代价是极端情况下不是全局最优，但配合 ambiguous 提示已足够。
 */
export function matchByScore(
  fromCount: number,
  toCount: number,
  score: (i: number, j: number) => number,
  options?: { threshold?: number; ambiguityMargin?: number },
): MatchResult {
  const threshold = options?.threshold ?? MATCH_THRESHOLD
  const margin = options?.ambiguityMargin ?? AMBIGUITY_MARGIN

  // 收集所有达标候选
  const all: MatchCandidate[] = []
  for (let i = 0; i < fromCount; i++) {
    for (let j = 0; j < toCount; j++) {
      const s = score(i, j)
      if (s >= threshold) all.push({ from: i, to: j, score: s })
    }
  }
  all.sort((a, b) => b.score - a.score)

  // 贪心分配
  const usedFrom = new Set<number>()
  const usedTo = new Set<number>()
  const pairs: MatchCandidate[] = []
  for (const c of all) {
    if (usedFrom.has(c.from) || usedTo.has(c.to)) continue
    usedFrom.add(c.from)
    usedTo.add(c.to)
    pairs.push(c)
  }

  // 歧义标注：对每个源，找出所有达标但未中选的候选，若与中选者分数接近则成组
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

/** 表级配对便捷入口 */
export function matchTables(oldTables: Table[], newTables: Table[]): MatchResult {
  return matchByScore(oldTables.length, newTables.length, (i, j) => {
    const a = oldTables[i]
    const b = newTables[j]
    return a && b ? tableSimilarity(a, b) : 0
  })
}

/** 字段级配对便捷入口 */
export function matchFields(oldFields: Field[], newFields: Field[]): MatchResult {
  return matchByScore(oldFields.length, newFields.length, (i, j) => {
    const a = oldFields[i]
    const b = newFields[j]
    return a && b ? fieldSimilarity(a, b) : 0
  })
}

/** 索引级配对便捷入口 */
export function matchIndexes(oldIndexes: Index[], newIndexes: Index[]): MatchResult {
  return matchByScore(oldIndexes.length, newIndexes.length, (i, j) => {
    const a = oldIndexes[i]
    const b = newIndexes[j]
    return a && b ? indexSimilarity(a, b) : 0
  })
}
