/**
 * Structure diff engine: compares two sets of schema structures and outputs structured differences.
 *
 * Matching strategy (does not rely on persisted ids on structure objects; resolves paths top-down):
 * - Rename records take priority: callers pass a RenameLookup built from RenameEntry accumulated on migrations.
 * - Everything else is matched by path (i.e. name); unmatched old entries become removed, unmatched new entries become added.
 * - Indexes fall back to "column signature" matching when unnamed.
 *
 * Automatic rename inference lives outside this module; see identity.suggestRenames.
 * The split of responsibilities: suggestRenames produces candidates → user confirms → persisted as RenameEntry → consumed here.
 *
 * Pure functions, no FS / reactive dependencies, so it can run in the browser.
 */
import type { Field, Index, Schema, Table } from '../../types/schema'
import type { FieldDiff, IndexDiff, SchemaDiff, StructureDiff, TableDiff } from './types'
import {
  EMPTY_RENAME_LOOKUP,
  type RenameLookup,
  fieldPath,
  indexPath,
  parsePath,
  resolveOldPath,
  tablePath,
} from './identity'
import { FIELD_SEMANTIC_KEYS, diffSemantics } from './matcher'

/** Semantic properties participating in index comparison (name excluded; name is the match key) */
const INDEX_SEMANTIC_KEYS: (keyof Index)[] = ['type', 'using', 'columns', 'active_only', 'logical_delete', 'comment', 'pre_comment', 'mysql', 'postgresql', 'sqlite']

/** Compare the "semantic properties" of a single index (name excluded; name is the match key) */
function compareIndexSemantics(a: Index, b: Index): Record<string, [unknown, unknown]> {
  // active_only / logical_delete affect the generated index definition (partial and functional indexes), so they must be compared
  return diffSemantics(a, b, INDEX_SEMANTIC_KEYS)
}

/** Use the "column signature" as the match key for unnamed indexes */
function indexColumnSignature(idx: Index): string {
  return idx.columns.map(c => `${c.name}:${c.sort_order ?? ''}`).join(',')
}

/** Match new and old fields by field path: newIndex → oldIndex */
function pairFields(
  oldFields: Field[],
  newFields: Field[],
  schema: string,
  table: string,
  lookup: RenameLookup,
): Map<number, number> {
  const pairs = new Map<number, number>()
  const usedOld = new Set<number>()
  for (let ni = 0; ni < newFields.length; ni++) {
    const nf = newFields[ni]
    if (!nf) continue
    const oldPath = resolveOldPath(fieldPath(schema, table, nf.field_name), lookup)
    const oldName = parsePath(oldPath).name
    const oi = oldFields.findIndex((o, k) => !usedOld.has(k) && o.field_name === oldName)
    if (oi >= 0) {
      pairs.set(ni, oi)
      usedOld.add(oi)
    }
  }
  return pairs
}

/** Match by index path, falling back to column signature when unnamed: newIndex → oldIndex */
function pairIndexes(
  oldIndexes: Index[],
  newIndexes: Index[],
  schema: string,
  table: string,
  lookup: RenameLookup,
): Map<number, number> {
  const pairs = new Map<number, number>()
  const usedOld = new Set<number>()
  const findUnused = (predicate: (o: Index) => boolean): number =>
    oldIndexes.findIndex((o, k) => !usedOld.has(k) && predicate(o))

  for (let ni = 0; ni < newIndexes.length; ni++) {
    const nidx = newIndexes[ni]
    if (!nidx) continue
    let oi = -1
    if (nidx.name) {
      const oldPath = resolveOldPath(indexPath(schema, table, nidx.name), lookup)
      const oldName = parsePath(oldPath).name
      oi = findUnused(o => o.name === oldName)
    }
    if (oi < 0) {
      const signature = indexColumnSignature(nidx)
      oi = findUnused(o => indexColumnSignature(o) === signature)
    }
    if (oi >= 0) {
      pairs.set(ni, oi)
      usedOld.add(oi)
    }
  }
  return pairs
}

function diffFields(
  oldFields: Field[],
  newFields: Field[],
  pairs: Map<number, number>,
): FieldDiff[] {
  const result: FieldDiff[] = []
  const matchedOld = new Set<number>()

  for (let ni = 0; ni < newFields.length; ni++) {
    const nf = newFields[ni]
    if (!nf) continue
    const oi = pairs.get(ni)
    if (oi === undefined) {
      result.push({ type: 'field_added', new_name: nf.field_name })
      continue
    }
    const of = oldFields[oi]
    if (!of) continue
    matchedOld.add(oi)

    if (of.field_name !== nf.field_name) {
      result.push({ type: 'field_renamed', old_name: of.field_name, new_name: nf.field_name })
    }

    const changes = diffSemantics(of, nf, FIELD_SEMANTIC_KEYS)
    if (Object.keys(changes).length > 0) {
      result.push({ type: 'field_modified', old_name: of.field_name, new_name: nf.field_name, changes })
    }
  }

  for (let oi = 0; oi < oldFields.length; oi++) {
    if (matchedOld.has(oi)) continue
    const of = oldFields[oi]
    if (!of) continue
    result.push({ type: 'field_removed', old_name: of.field_name })
  }

  return result
}

function diffIndexes(
  oldIndexes: Index[],
  newIndexes: Index[],
  pairs: Map<number, number>,
): IndexDiff[] {
  const result: IndexDiff[] = []
  const matchedOld = new Set<number>()

  for (let ni = 0; ni < newIndexes.length; ni++) {
    const nidx = newIndexes[ni]
    if (!nidx) continue
    const oi = pairs.get(ni)
    if (oi === undefined) {
      result.push({ type: 'index_added', new_name: nidx.name })
      continue
    }
    const oidx = oldIndexes[oi]
    if (!oidx) continue
    matchedOld.add(oi)
    const changes = compareIndexSemantics(oidx, nidx)
    if (Object.keys(changes).length > 0) {
      result.push({ type: 'index_modified', old_name: oidx.name, new_name: nidx.name, changes })
    }
  }

  for (let oi = 0; oi < oldIndexes.length; oi++) {
    if (matchedOld.has(oi)) continue
    const oidx = oldIndexes[oi]
    if (!oidx) continue
    result.push({ type: 'index_removed', old_name: oidx.name })
  }

  return result
}

function diffTable(
  oldTable: Table | null,
  newTable: Table | null,
  fieldPairs: Map<number, number>,
  indexPairs: Map<number, number>,
): TableDiff | null {
  if (!oldTable && !newTable) return null
  if (!oldTable && newTable) {
    return {
      type: 'table_added',
      new_name: newTable.name,
      fields: newTable.fields.map(f => ({ type: 'field_added' as const, new_name: f.field_name })),
      indexes: newTable.indexes.map(i => ({ type: 'index_added' as const, new_name: i.name })),
    }
  }
  if (oldTable && !newTable) {
    return {
      type: 'table_removed',
      old_name: oldTable.name,
      fields: oldTable.fields.map(f => ({ type: 'field_removed' as const, old_name: f.field_name })),
      indexes: oldTable.indexes.map(i => ({ type: 'index_removed' as const, old_name: i.name })),
    }
  }

  const ot = oldTable!
  const nt = newTable!
  const fields = diffFields(ot.fields, nt.fields, fieldPairs)
  const indexes = diffIndexes(ot.indexes, nt.indexes, indexPairs)
  const renamed = ot.name !== nt.name
  const hasInner = fields.length > 0 || indexes.length > 0

  if (!renamed && !hasInner) return null

  return {
    type: renamed ? 'table_renamed' : 'table_added',
    old_name: renamed ? ot.name : undefined,
    new_name: nt.name,
    fields,
    indexes,
  }
}

/**
 * Compare two sets of schema structures.
 * @param oldSchemas Source structures (e.g. the old version)
 * @param newSchemas Target structures (e.g. the current workspace)
 * @param renames Reverse rename lookup; matches by name only when omitted
 */
export function diffSchemas(
  oldSchemas: Schema[],
  newSchemas: Schema[],
  renames: RenameLookup = EMPTY_RENAME_LOOKUP,
): SchemaDiff[] {
  const result: SchemaDiff[] = []
  const oldSchemaByName = new Map(oldSchemas.map(s => [s.schema, s]))
  const matchedOldSchemas = new Set<string>()

  for (const ns of newSchemas) {
    const oldSchemaName = resolveOldPath(ns.schema, renames)
    const os = oldSchemaByName.get(oldSchemaName)
    if (os) matchedOldSchemas.add(os.schema)

    const tableDiffs: TableDiff[] = []
    const oldTableByName = new Map((os?.tables ?? []).map(t => [t.name, t]))
    const matchedOldTables = new Set<string>()

    for (const nt of ns.tables) {
      const oldTablePath = resolveOldPath(tablePath(ns.schema, nt.name), renames)
      const oldTableName = parsePath(oldTablePath).table
      const ot = oldTableName ? oldTableByName.get(oldTableName) : undefined
      if (ot) matchedOldTables.add(ot.name)

      const fieldPairs = ot
        ? pairFields(ot.fields, nt.fields, ns.schema, nt.name, renames)
        : new Map<number, number>()
      const indexPairs = ot
        ? pairIndexes(ot.indexes, nt.indexes, ns.schema, nt.name, renames)
        : new Map<number, number>()

      const td = diffTable(ot ?? null, nt, fieldPairs, indexPairs)
      if (td) tableDiffs.push(td)
    }

    for (const ot of os?.tables ?? []) {
      if (matchedOldTables.has(ot.name)) continue
      const td = diffTable(ot, null, new Map(), new Map())
      if (td) tableDiffs.push(td)
    }

    if (tableDiffs.length > 0) {
      result.push({ schema: ns.schema, tables: tableDiffs })
    }
  }

  // Old schemas that were deleted
  for (const os of oldSchemas) {
    if (matchedOldSchemas.has(os.schema)) continue
    const tableDiffs: TableDiff[] = []
    for (const t of os.tables) {
      const td = diffTable(t, null, new Map(), new Map())
      if (td) tableDiffs.push(td)
    }
    result.push({ schema: os.schema, tables: tableDiffs })
  }

  return result
}

/** Compute the full structure diff (including from/to references and whether anything changed) */
export function computeStructureDiff(
  fromSchemas: Schema[] | null,
  toSchemas: Schema[],
  fromRef: StructureDiff['from'],
  toRef: StructureDiff['to'],
  renames: RenameLookup = EMPTY_RENAME_LOOKUP,
): StructureDiff {
  const schemas = fromSchemas ? diffSchemas(fromSchemas, toSchemas, renames) : diffSchemas([], toSchemas)
  const hasChanges = schemas.some(s => s.tables.length > 0)
  return { from: fromRef, to: toRef, schemas, hasChanges }
}
