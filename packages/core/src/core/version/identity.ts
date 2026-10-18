/**
 * Identity layer: path construction, aggregation of rename records with transitive closure, and similarity-based rename suggestions.
 *
 * Relation to a persisted-id approach:
 * - Structure objects carry no ids; "are objects in two versions the same entity" is answered by paths + rename records.
 * - Rename records accumulate on migration scripts (Migration.renames); this module aggregates scattered records into queryable maps.
 * - When records are missing, this degrades to similarity inference (suggestRenames); results are persisted only after user confirmation.
 */
import type { Schema } from '../../types/schema'
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

/** Max hops for the transitive closure, preventing infinite loops on malformed data */
const MAX_CHAIN_HOPS = 32

// ===== Path construction and parsing =====

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
  /** Table name; present when kind is table / field / index */
  table?: string
  /** Field or index name; present when kind is field / index */
  name?: string
}

/** Parse an object path. Separator check order: # (index) → . (field) → / (table) → otherwise treat as schema */
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

/** Rebuild a path from its parsed form */
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

// ===== Rename record aggregation =====

export interface RenameConflict {
  /** The same source is pointed at multiple different targets */
  from: ObjectPath
  targets: ObjectPath[]
}

export interface RenameMap {
  /** Source path → final target path (transitive closure applied); only entries that actually changed are kept */
  map: Map<ObjectPath, ObjectPath>
  /** Recorded when one source points to multiple targets, so the UI can ask the user to decide */
  conflicts: RenameConflict[]
  /** Detected cycles (e.g. a→b and b→a); these sources are left unmapped */
  cyclic: ObjectPath[]
}

/** Rename record priority: editor / manual always outrank auto; ties are broken by confidence */
function entryPriority(e: RenameEntry): number {
  const base = e.source === 'auto' ? 0 : 10
  return base + (e.confidence ?? (e.source === 'auto' ? 0 : 1))
}

/**
 * Aggregate rename records and compute the transitive closure: a→b and b→c combine into a→c,
 * so identity resolution across multiple migrations (v1 → v3) needs no step-by-step replay.
 */
export function buildRenameMap(entries: RenameEntry[]): RenameMap {
  // 1. Direct mapping: when one source has multiple targets, pick by priority
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

  // 2. Transitive closure
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

/** Invert the map so diff can look up old objects from the new structure */
export function invertRenameMap(map: Map<ObjectPath, ObjectPath>): Map<ObjectPath, ObjectPath> {
  const out = new Map<ObjectPath, ObjectPath>()
  for (const [from, to] of map) if (!out.has(to)) out.set(to, from)
  return out
}

/** Lookup table used by diff: new structure path → old structure path */
export interface RenameLookup {
  /** Full-path level (table / field / index renames) */
  full: Map<ObjectPath, ObjectPath>
  /** Schema-name level (schema renames) */
  schema: Map<ObjectPath, ObjectPath>
}

/** Build the lookup table from the rename map (old → new) */
export function buildRenameLookup(map: Map<ObjectPath, ObjectPath>): RenameLookup {
  const full = invertRenameMap(map)
  const schema = new Map<ObjectPath, ObjectPath>()
  for (const [from, to] of map) {
    if (parsePath(from).kind === 'schema' && !schema.has(to)) schema.set(to, from)
  }
  return { full, schema }
}

/** Empty lookup table, used by diff when no rename records are available */
export const EMPTY_RENAME_LOOKUP: RenameLookup = {
  full: new Map(),
  schema: new Map(),
}

/**
 * Resolve an old structure path from a new one, trying in this order:
 * 1. Direct hit on a table-level record (records look like `db/users` → `db/accounts`)
 * 2. After a schema-level hit, look up table-level records again using the old schema name
 *    (covers schema and table renames recorded in different migrations)
 * 3. Replace only the schema segment
 * 4. Otherwise return as-is (the name did not change)
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

// ===== Rename suggestions =====

export interface RenameCandidate {
  to: ObjectPath
  score: number
}

export interface RenameSuggestion {
  /** Suggested rename entry; source is always auto and should only be persisted after user confirmation */
  entry: RenameEntry
  /** Competing candidates (including the chosen one), in descending score order */
  candidates: RenameCandidate[]
  /** A close-scoring competitor exists; the UI should ask the user to confirm */
  ambiguous: boolean
}

/** Schema-level similarity: table sets primary, names secondary */
function schemaSimilarity(a: Schema, b: Schema): number {
  const ta = new Set(a.tables.map(t => normalizeName(t.name ?? '')))
  const tb = new Set(b.tables.map(t => normalizeName(t.name ?? '')))
  return 0.6 * jaccard(ta, tb) + 0.4 * nameSimilarity(a.schema ?? '', b.schema ?? '')
}

/** Ambiguity entry: index and score of a competitor */
export interface AmbiguityEntry {
  index: number
  score: number
}

/** Build a source index → competing candidates map, used to flag ambiguity */
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
 * Infer rename relationships between two versions based on similarity.
 *
 * Only objects that cannot be matched by name are handled; objects already sharing a name produce no suggestion.
 * The search space narrows top-down: align schemas first, then tables within aligned schemas, then fields / indexes.
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

  // --- Schema level
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

  // --- Table level (within aligned schemas)
  for (const [os, ns] of schemaPairs) {
    const newTableByName = new Map(ns.tables.map(t => [t.name, t]))
    const oldTableByName = new Map(os.tables.map(t => [t.name, t]))
    const looseOldTables = os.tables.filter(t => !newTableByName.has(t.name))
    const looseNewTables = ns.tables.filter(t => !oldTableByName.has(t.name))
    const res = matchTables(looseOldTables, looseNewTables)
    const ambiguous = ambiguityIndex(res)

    // [old schema, old table name, new schema, new table name]
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

    // --- Fields and indexes (within aligned tables)
    for (const [osRef, oldTableName, nsRef, newTableName] of tablePairs) {
      const ot = osRef.tables.find(t => t.name === oldTableName)
      const nt = nsRef.tables.find(t => t.name === newTableName)
      if (!ot || !nt) continue

      // Fields
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

      // Indexes: only named indexes are handled; unnamed ones rely on direct column-signature matching
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

