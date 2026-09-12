/**
 * 结构 diff 引擎：对比两组 schema 结构，输出结构化差异。
 *
 * 匹配策略（不依赖结构对象上的持久化 id，自顶向下解析路径）：
 * - 改名记录优先：调用方传入 RenameLookup，其来自迁移脚本上累积的 RenameEntry。
 * - 其余按路径（即名称）对应；旧结构中未被对应到的记为 removed，新结构中未对应到的记为 added。
 * - 索引在无名称时退化为「列签名」匹配。
 *
 * 改名关系的自动推断不在本模块，见 identity.suggestRenames；
 * 两者的分工是：suggestRenames 产出候选 → 用户确认 → 作为 RenameEntry 落盘 → 本模块消费。
 *
 * 纯函数，不依赖 FS / reactive，可在浏览器端运行。
 */
import type { Field, Index, Schema, Table } from '@/types/schema'
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
import { FIELD_SEMANTIC_KEYS } from './matcher'

/** 对单索引的「语义属性」做对比（排除 name，name 作为匹配标识） */
function compareIndexSemantics(a: Index, b: Index): Record<string, [any, any]> {
  const changes: Record<string, [any, any]> = {}
  const keys: (keyof Index)[] = ['type', 'using', 'columns', 'comment', 'pre_comment', 'mysql', 'postgresql', 'sqlite']
  for (const k of keys) {
    const av = (a as any)[k]
    const bv = (b as any)[k]
    if (JSON.stringify(av) !== JSON.stringify(bv)) {
      changes[k] = [av, bv]
    }
  }
  return changes
}

/** 无名称索引用「列签名」作为匹配键 */
function indexColumnSignature(idx: Index): string {
  return idx.columns.map(c => `${c.name}:${c.sort_order ?? ''}`).join(',')
}

/** 按字段路径匹配新旧字段：newIndex → oldIndex */
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

/** 按索引路径匹配，无名称时回退列签名：newIndex → oldIndex */
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

    const changes: Record<string, [any, any]> = {}
    for (const k of FIELD_SEMANTIC_KEYS) {
      const av = (of as any)[k]
      const bv = (nf as any)[k]
      if (JSON.stringify(av) !== JSON.stringify(bv)) {
        changes[k] = [av, bv]
      }
    }
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
 * 对比两组 schema 结构。
 * @param oldSchemas 源结构（如旧版本）
 * @param newSchemas 目标结构（如当前工作区）
 * @param renames 改名反查表，缺省时仅按名称匹配
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

  // 旧 schema 中被删除的
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

/** 计算完整结构 diff（含 from/to 标识与是否变更） */
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
