/**
 * 身份识别层：路径构造、改名记录的聚合与传递闭包、基于相似度的改名建议。
 *
 * 与持久化 id 方案的对应关系：
 * - 结构对象自身不带 id，"两个版本里的对象是否为同一实体"由路径 + 改名记录回答。
 * - 改名记录累积在迁移脚本上（Migration.renames），这里负责把零散记录聚合为可查询的映射。
 * - 记录缺失时退化为相似度推断（suggestRenames），结论需经用户确认后才落盘。
 */
import type { Schema } from '@/types/schema'
import type { ObjectPath, RenameEntry, RenameKind } from './types'
import { PATH_FIELD_SEP, PATH_INDEX_SEP, PATH_TABLE_SEP } from './types'
import {
  type MatchResult,
  jaccard,
  matchByScore,
  matchFields,
  matchIndexes,
  matchTables,
  nameSimilarity,
  normalizeName,
} from './matcher'

/** 传递闭包的最大跳数，防止异常数据导致死循环 */
const MAX_CHAIN_HOPS = 32

// ===== 路径构造与解析 =====

export function schemaPath(schema: string): ObjectPath {
  return schema
}

export function tablePath(schema: string, table: string): ObjectPath {
  return `${schema}${PATH_TABLE_SEP}${table}`
}

export function fieldPath(schema: string, table: string, field: string): ObjectPath {
  return `${tablePath(schema, table)}${PATH_FIELD_SEP}${field}`
}

export function indexPath(schema: string, table: string, index: string): ObjectPath {
  return `${tablePath(schema, table)}${PATH_INDEX_SEP}${index}`
}

export interface ParsedPath {
  kind: RenameKind
  schema: string
  /** 表名，kind 为 table / field / index 时存在 */
  table?: string
  /** 字段名或索引名，kind 为 field / index 时存在 */
  name?: string
}

/** 解析对象路径。分隔符判定顺序：#（索引）→ .（字段）→ /（表）→ 其余视为 schema */
export function parsePath(path: ObjectPath): ParsedPath {
  const hashIdx = path.lastIndexOf(PATH_INDEX_SEP)
  if (hashIdx >= 0) {
    const parent = parsePath(path.slice(0, hashIdx))
    return { kind: 'index', schema: parent.schema, table: parent.table, name: path.slice(hashIdx + 1) }
  }
  const dotIdx = path.lastIndexOf(PATH_FIELD_SEP)
  if (dotIdx >= 0) {
    const parent = parsePath(path.slice(0, dotIdx))
    return { kind: 'field', schema: parent.schema, table: parent.table, name: path.slice(dotIdx + 1) }
  }
  const slashIdx = path.indexOf(PATH_TABLE_SEP)
  if (slashIdx >= 0) {
    return { kind: 'table', schema: path.slice(0, slashIdx), table: path.slice(slashIdx + 1) }
  }
  return { kind: 'schema', schema: path }
}

/** 由解析结果重建路径 */
export function rebuildPath(p: ParsedPath): ObjectPath {
  switch (p.kind) {
    case 'table':
      return tablePath(p.schema, p.table ?? '')
    case 'field':
      return fieldPath(p.schema, p.table ?? '', p.name ?? '')
    case 'index':
      return indexPath(p.schema, p.table ?? '', p.name ?? '')
    default:
      return schemaPath(p.schema)
  }
}

// ===== 改名记录聚合 =====

export interface RenameConflict {
  /** 同一个源被指向了多个不同目标 */
  from: ObjectPath
  targets: ObjectPath[]
}

export interface RenameMap {
  /** 源路径 → 最终目标路径（已求传递闭包），仅保留确实发生变化的项 */
  map: Map<ObjectPath, ObjectPath>
  /** 同一源指向多个目标时记录，供 UI 提示用户裁决 */
  conflicts: RenameConflict[]
  /** 检测到的环（如 a→b 且 b→a），这些源保持原样不做映射 */
  cyclic: ObjectPath[]
}

/** 改名记录优先级：editor / manual 恒高于 auto，同级比较置信度 */
function entryPriority(e: RenameEntry): number {
  const base = e.source === 'auto' ? 0 : 10
  return base + (e.confidence ?? (e.source === 'auto' ? 0 : 1))
}

/**
 * 聚合改名记录并求传递闭包：a→b 与 b→c 会合并出 a→c，
 * 使跨多个迁移的身份识别（v1 → v3）无需逐段重放。
 */
export function buildRenameMap(entries: RenameEntry[]): RenameMap {
  // 1. 直接映射：同一源出现多个目标时按优先级裁决
  const direct = new Map<ObjectPath, ObjectPath>()
  const chosen = new Map<ObjectPath, RenameEntry>()
  const targetCount = new Map<ObjectPath, Set<ObjectPath>>()
  for (const e of entries) {
    if (!e?.from || !e?.to || e.from === e.to) continue
    const seen = targetCount.get(e.from)
    if (seen) seen.add(e.to)
    else targetCount.set(e.from, new Set([e.to]))

    const cur = chosen.get(e.from)
    if (!cur || entryPriority(e) >= entryPriority(cur)) {
      chosen.set(e.from, e)
      direct.set(e.from, e.to)
    }
  }

  const conflicts: RenameConflict[] = []
  for (const [from, targets] of targetCount) {
    if (targets.size > 1) conflicts.push({ from, targets: [...targets] })
  }

  // 2. 传递闭包
  const map = new Map<ObjectPath, ObjectPath>()
  const cyclic: ObjectPath[] = []
  for (const from of direct.keys()) {
    const seen = new Set<ObjectPath>([from])
    let cur = from
    let isCyclic = false
    for (let hop = 0; hop < MAX_CHAIN_HOPS; hop++) {
      const next = direct.get(cur)
      if (next === undefined || next === cur) break
      if (seen.has(next)) {
        isCyclic = true
        break
      }
      seen.add(next)
      cur = next
    }
    if (isCyclic) {
      cyclic.push(from)
      continue
    }
    if (cur !== from) map.set(from, cur)
  }

  return { map, conflicts, cyclic }
}

/** 反转映射，供 diff 由新结构反查旧对象 */
export function invertRenameMap(map: Map<ObjectPath, ObjectPath>): Map<ObjectPath, ObjectPath> {
  const out = new Map<ObjectPath, ObjectPath>()
  for (const [from, to] of map) if (!out.has(to)) out.set(to, from)
  return out
}

/** diff 使用的反查表：新结构路径 → 旧结构路径 */
export interface RenameLookup {
  /** 完整路径级（表 / 字段 / 索引改名） */
  full: Map<ObjectPath, ObjectPath>
  /** schema 名级（schema 改名） */
  schema: Map<ObjectPath, ObjectPath>
}

/** 由 rename 映射（旧 → 新）构造反查表 */
export function buildRenameLookup(map: Map<ObjectPath, ObjectPath>): RenameLookup {
  const full = invertRenameMap(map)
  const schema = new Map<ObjectPath, ObjectPath>()
  for (const [from, to] of map) {
    if (parsePath(from).kind === 'schema' && !schema.has(to)) schema.set(to, from)
  }
  return { full, schema }
}

/** 空反查表，diff 在未获得改名记录时使用 */
export const EMPTY_RENAME_LOOKUP: RenameLookup = {
  full: new Map(),
  schema: new Map(),
}

/**
 * 由新结构路径反查旧结构路径，按以下顺序尝试：
 * 1. 表级记录直接命中（记录形如 `db/users` → `db/accounts`）
 * 2. schema 级命中后，用旧 schema 名再查一次表级记录
 *    （应对 schema 与 table 改名分别落在不同迁移的情况）
 * 3. 仅替换 schema 段
 * 4. 都没有则原样返回（名称未变）
 */
export function resolveOldPath(newPath: ObjectPath, lookup: RenameLookup): ObjectPath {
  const parsed = parsePath(newPath)
  if (parsed.table === undefined) {
    return lookup.schema.get(parsed.schema) ?? newPath
  }

  const tableKey = tablePath(parsed.schema, parsed.table)
  let oldSchema = parsed.schema
  let oldTable = parsed.table

  const byTable = lookup.full.get(tableKey)
  if (byTable) {
    const p = parsePath(byTable)
    oldSchema = p.schema
    oldTable = p.table ?? parsed.table
  } else {
    const mappedSchema = lookup.schema.get(parsed.schema)
    if (mappedSchema) {
      oldSchema = mappedSchema
      const retry = lookup.full.get(tablePath(mappedSchema, parsed.table))
      if (retry) {
        const p = parsePath(retry)
        oldSchema = p.schema
        oldTable = p.table ?? parsed.table
      }
    }
  }

  if (oldSchema === parsed.schema && oldTable === parsed.table) return newPath
  return rebuildPath({ kind: parsed.kind, schema: oldSchema, table: oldTable, name: parsed.name })
}

// ===== 改名建议 =====

export interface RenameCandidate {
  to: ObjectPath
  score: number
}

export interface RenameSuggestion {
  /** 建议的改名记录，source 恒为 auto，需用户确认后才应落盘 */
  entry: RenameEntry
  /** 竞争候选（含中选者），按分数降序 */
  candidates: RenameCandidate[]
  /** 存在分数接近的竞争者，UI 应提示用户确认 */
  ambiguous: boolean
}

/** schema 级相似度：表集合为主，名称为辅 */
function schemaSimilarity(a: Schema, b: Schema): number {
  const ta = new Set(a.tables.map(t => normalizeName(t.name ?? '')))
  const tb = new Set(b.tables.map(t => normalizeName(t.name ?? '')))
  return 0.6 * jaccard(ta, tb) + 0.4 * nameSimilarity(a.schema ?? '', b.schema ?? '')
}

/** 歧义项：竞争者的下标与分数 */
export interface AmbiguityEntry {
  index: number
  score: number
}

/** 建立「源下标 → 竞争候选」索引，用于标注歧义 */
function ambiguityIndex(result: MatchResult): Map<number, AmbiguityEntry[]> {
  const out = new Map<number, AmbiguityEntry[]>()
  for (const group of result.ambiguous) {
    const first = group[0]
    if (!first) continue
    out.set(
      first.from,
      group.map(c => ({ index: c.to, score: c.score })),
    )
  }
  return out
}

/**
 * 基于相似度推断两版本之间的改名关系。
 *
 * 只处理「按名称无法直接对应」的对象，已同名的对象不产生建议。
 * 自顶向下收敛搜索空间：先对齐 schema，再在已对齐的 schema 内对齐 table，依次到 field / index。
 */
export function suggestRenames(
  oldSchemas: Schema[],
  newSchemas: Schema[],
  options?: { threshold?: number },
): RenameSuggestion[] {
  const threshold = options?.threshold
  const out: RenameSuggestion[] = []

  const push = (
    kind: RenameKind,
    from: ObjectPath,
    to: ObjectPath,
    score: number,
    candidates: RenameCandidate[],
  ) => {
    out.push({
      entry: { kind, from, to, source: 'auto', confidence: score },
      candidates: candidates.length > 0 ? candidates : [{ to, score }],
      ambiguous: candidates.length > 1,
    })
  }

  // --- schema 级
  const newSchemaByName = new Map(newSchemas.map(s => [s.schema, s]))
  const oldSchemaByName = new Map(oldSchemas.map(s => [s.schema, s]))
  const looseOldSchemas = oldSchemas.filter(s => !newSchemaByName.has(s.schema))
  const looseNewSchemas = newSchemas.filter(s => !oldSchemaByName.has(s.schema))
  const schemaRes = matchByScore(
    looseOldSchemas.length,
    looseNewSchemas.length,
    (i, j) => {
      const a = looseOldSchemas[i]
      const b = looseNewSchemas[j]
      if (!a || !b) return 0
      return schemaSimilarity(a, b)
    },
    threshold === undefined ? undefined : { threshold },
  )
  const schemaAmbiguous = ambiguityIndex(schemaRes)

  const schemaPairs: [Schema, Schema][] = []
  for (const os of oldSchemas) {
    const ns = newSchemaByName.get(os.schema)
    if (ns) schemaPairs.push([os, ns])
  }
  for (const p of schemaRes.pairs) {
    const os = looseOldSchemas[p.from]
    const ns = looseNewSchemas[p.to]
    if (!os || !ns) continue
    schemaPairs.push([os, ns])
    const candidates: RenameCandidate[] = []
    for (const c of schemaAmbiguous.get(p.from) ?? []) {
      const target = looseNewSchemas[c.index]
      if (target) candidates.push({ to: schemaPath(target.schema), score: c.score })
    }
    push('schema', schemaPath(os.schema), schemaPath(ns.schema), p.score, candidates)
  }

  // --- table 级（在已对齐的 schema 内）
  for (const [os, ns] of schemaPairs) {
    const newTableByName = new Map(ns.tables.map(t => [t.name, t]))
    const oldTableByName = new Map(os.tables.map(t => [t.name, t]))
    const looseOldTables = os.tables.filter(t => !newTableByName.has(t.name))
    const looseNewTables = ns.tables.filter(t => !oldTableByName.has(t.name))
    const res = matchTables(looseOldTables, looseNewTables)
    const ambiguous = ambiguityIndex(res)

    // [旧 schema, 旧表名, 新 schema, 新表名]
    const tablePairs: [Schema, string, Schema, string][] = []
    for (const ot of os.tables) {
      const nt = newTableByName.get(ot.name)
      if (nt) tablePairs.push([os, ot.name, ns, nt.name])
    }
    for (const p of res.pairs) {
      const ot = looseOldTables[p.from]
      const nt = looseNewTables[p.to]
      if (!ot || !nt) continue
      const candidates: RenameCandidate[] = []
      for (const c of ambiguous.get(p.from) ?? []) {
        const target = looseNewTables[c.index]
        if (target) candidates.push({ to: tablePath(ns.schema, target.name), score: c.score })
      }
      push('table', tablePath(os.schema, ot.name), tablePath(ns.schema, nt.name), p.score, candidates)
      tablePairs.push([os, ot.name, ns, nt.name])
    }

    // --- field 与 index（在已对齐的 table 内）
    for (const [osRef, oldTableName, nsRef, newTableName] of tablePairs) {
      const ot = osRef.tables.find(t => t.name === oldTableName)
      const nt = nsRef.tables.find(t => t.name === newTableName)
      if (!ot || !nt) continue

      // 字段
      const newFieldByName = new Map(nt.fields.map(f => [f.field_name, f]))
      const oldFieldByName = new Map(ot.fields.map(f => [f.field_name, f]))
      const looseOldFields = ot.fields.filter(f => !newFieldByName.has(f.field_name))
      const looseNewFields = nt.fields.filter(f => !oldFieldByName.has(f.field_name))
      const fieldRes = matchFields(looseOldFields, looseNewFields)
      const fieldAmbiguous = ambiguityIndex(fieldRes)
      for (const p of fieldRes.pairs) {
        const of = looseOldFields[p.from]
        const nf = looseNewFields[p.to]
        if (!of || !nf) continue
        const candidates: RenameCandidate[] = []
        for (const c of fieldAmbiguous.get(p.from) ?? []) {
          const target = looseNewFields[c.index]
          if (target) {
            candidates.push({ to: fieldPath(nsRef.schema, newTableName, target.field_name), score: c.score })
          }
        }
        push(
          'field',
          fieldPath(osRef.schema, oldTableName, of.field_name),
          fieldPath(nsRef.schema, newTableName, nf.field_name),
          p.score,
          candidates,
        )
      }

      // 索引：仅处理有名称的索引，无名索引依赖列签名直接匹配
      const namedOld = ot.indexes.filter(i => i.name && !nt.indexes.some(n => n.name === i.name))
      const namedNew = nt.indexes.filter(i => i.name && !ot.indexes.some(o => o.name === i.name))
      const indexRes = matchIndexes(namedOld, namedNew)
      const indexAmbiguous = ambiguityIndex(indexRes)
      for (const p of indexRes.pairs) {
        const oi = namedOld[p.from]
        const ni = namedNew[p.to]
        if (!oi?.name || !ni?.name) continue
        const candidates: RenameCandidate[] = []
        for (const c of indexAmbiguous.get(p.from) ?? []) {
          const target = namedNew[c.index]
          if (target?.name) {
            candidates.push({ to: indexPath(nsRef.schema, newTableName, target.name), score: c.score })
          }
        }
        push(
          'index',
          indexPath(osRef.schema, oldTableName, oi.name),
          indexPath(nsRef.schema, newTableName, ni.name),
          p.score,
          candidates,
        )
      }
    }
  }

  return out
}
