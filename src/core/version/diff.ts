/**
 * 结构 diff 引擎：对比两组 schema 结构，输出结构化差异。
 *
 * 匹配策略（稳定，跨版本可识别 rename）：
 * - schema 通过 schema_id 匹配；无 id 时退化为名称匹配。
 * - table 通过 table_id 匹配；无 id 时退化为名称匹配（可识别 rename）。
 * - field 通过 field_id 匹配；无 id 时退化为名称匹配（可识别 rename）。
 * - index 通过名称匹配（索引无独立 id）。
 *
 * 纯函数，不依赖 FS / reactive，可在浏览器端运行。
 */
import type {
  Field,
  Index,
  Schema,
  Table,
} from '@/types/schema'
import type {
  FieldDiff,
  IndexDiff,
  SchemaDiff,
  StructureDiff,
  TableDiff,
} from './types'

/** 对单字段的「语义属性」做对比（排除 id/name，name 由父级 rename 处理） */
const FIELD_COMPARE_KEYS: (keyof Field)[] = [
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
]

/** 对单索引的「语义属性」做对比（排除 name，name 作为匹配/标识） */
function compareIndexSemantics(a: Index, b: Index): Record<string, [any, any]> {
  const changes: Record<string, [any, any]> = {}
  const keys: (keyof Index)[] = ['type', 'using', 'columns', 'comment', 'pre_comment', 'mysql', 'postgresql']
  for (const k of keys) {
    const av = (a as any)[k]
    const bv = (b as any)[k]
    if (JSON.stringify(av) !== JSON.stringify(bv)) {
      changes[k] = [av, bv]
    }
  }
  return changes
}

function diffFields(oldFields: Field[], newFields: Field[]): FieldDiff[] {
  const result: FieldDiff[] = []
  const oldById = new Map<string, Field>()
  const oldByName = new Map<string, Field>()
  for (const f of oldFields) {
    if (f.field_id) oldById.set(f.field_id, f)
    if (f.field_name) oldByName.set(f.field_name, f)
  }
  const newById = new Map<string, Field>()
  const newByName = new Map<string, Field>()
  for (const f of newFields) {
    if (f.field_id) newById.set(f.field_id, f)
    if (f.field_name) newByName.set(f.field_name, f)
  }

  const matchedOld = new Set<Field>()

  for (const nf of newFields) {
    // 优先按 id 匹配
    let of: Field | undefined = nf.field_id ? oldById.get(nf.field_id) : undefined
    // 退化为名称匹配
    if (!of) of = oldByName.get(nf.field_name)
    if (of) matchedOld.add(of)

    if (!of) {
      result.push({ type: 'field_added', field_id: nf.field_id, new_name: nf.field_name })
      continue
    }

    // 名称变化 = rename
    if (of.field_name !== nf.field_name) {
      result.push({
        type: 'field_renamed',
        field_id: nf.field_id ?? of.field_id,
        old_name: of.field_name,
        new_name: nf.field_name,
      })
    }

    // 属性变化
    const changes: Record<string, [any, any]> = {}
    for (const k of FIELD_COMPARE_KEYS) {
      const av = (of as any)[k]
      const bv = (nf as any)[k]
      if (JSON.stringify(av) !== JSON.stringify(bv)) {
        changes[k] = [av, bv]
      }
    }
    if (Object.keys(changes).length > 0) {
      result.push({
        type: 'field_modified',
        field_id: nf.field_id ?? of.field_id,
        old_name: of.field_name,
        new_name: nf.field_name,
        changes,
      })
    }
  }

  // 旧中存在、新中无（删除）
  for (const of of oldFields) {
    if (matchedOld.has(of)) continue
    result.push({ type: 'field_removed', field_id: of.field_id, old_name: of.field_name })
  }

  return result
}

function diffIndexes(oldIndexes: Index[], newIndexes: Index[]): IndexDiff[] {
  const result: IndexDiff[] = []
  const oldById = new Map<string, Index>()
  for (const i of oldIndexes) {
    if (i.index_id) oldById.set(i.index_id, i)
  }
  const oldByName = new Map<string, Index>()
  for (const i of oldIndexes) {
    const key = i.name || indexColumnSignature(i)
    if (!oldById.has(i.index_id ?? '')) oldByName.set(key, i)
  }
  const matchedOld = new Set<Index>()

  for (const ni of newIndexes) {
    // 优先用 index_id 稳定匹配，否则回退到 name / 列签名
    const oi = (ni.index_id && oldById.get(ni.index_id)) ||
      oldByName.get(ni.name || indexColumnSignature(ni))
    if (oi) {
      matchedOld.add(oi)
      const changes = compareIndexSemantics(oi, ni)
      if (Object.keys(changes).length > 0) {
        result.push({ type: 'index_modified', index_id: ni.index_id ?? oi.index_id, old_name: oi.name, new_name: ni.name, changes })
      }
    } else {
      result.push({ type: 'index_added', index_id: ni.index_id, new_name: ni.name })
    }
  }

  for (const oi of oldIndexes) {
    if (matchedOld.has(oi)) continue
    result.push({ type: 'index_removed', index_id: oi.index_id, old_name: oi.name })
  }

  return result
}

/** 无名称索引用「列签名」作为匹配键 */
function indexColumnSignature(idx: Index): string {
  return idx.columns.map(c => `${c.name}:${c.sort_order ?? ''}`).join(',')
}

function diffTable(oldTable: Table | null, newTable: Table | null): TableDiff | null {
  if (!oldTable && !newTable) return null
  if (!oldTable && newTable) {
    return {
      type: 'table_added',
      table_id: newTable.table_id,
      new_name: newTable.name,
      fields: newTable.fields.map(f => ({ type: 'field_added' as const, field_id: f.field_id, new_name: f.field_name })),
      indexes: newTable.indexes.map(i => ({ type: 'index_added' as const, index_id: i.index_id, new_name: i.name })),
    }
  }
  if (oldTable && !newTable) {
    return {
      type: 'table_removed',
      table_id: oldTable.table_id,
      old_name: oldTable.name,
      fields: oldTable.fields.map(f => ({ type: 'field_removed' as const, field_id: f.field_id, old_name: f.field_name })),
      indexes: oldTable.indexes.map(i => ({ type: 'index_removed' as const, index_id: i.index_id, old_name: i.name })),
    }
  }

  // 两者均存在：判断是否 rename + 内部差异
  const ot = oldTable!
  const nt = newTable!
  const fields = diffFields(ot.fields, nt.fields)
  const indexes = diffIndexes(ot.indexes, nt.indexes)
  const renamed = ot.name !== nt.name
  const hasInner = fields.length > 0 || indexes.length > 0

  // 仅当表名变化，或内部有变化时才返回 diff
  if (!renamed && !hasInner) return null

  return {
    type: renamed ? 'table_renamed' : 'table_added',
    table_id: nt.table_id ?? ot.table_id,
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
 */
export function diffSchemas(
  oldSchemas: Schema[],
  newSchemas: Schema[],
): SchemaDiff[] {
  const result: SchemaDiff[] = []

  const oldBySchemaId = new Map<string, Schema>()
  const oldByName = new Map<string, Schema>()
  for (const s of oldSchemas) {
    if (s.schema_id) oldBySchemaId.set(s.schema_id, s)
    if (s.schema) oldByName.set(s.schema, s)
  }
  const newBySchemaId = new Map<string, Schema>()
  const newByName = new Map<string, Schema>()
  for (const s of newSchemas) {
    if (s.schema_id) newBySchemaId.set(s.schema_id, s)
    if (s.schema) newByName.set(s.schema, s)
  }

  const matchedOld = new Set<Schema>()

  for (const ns of newSchemas) {
    let os: Schema | undefined = ns.schema_id ? oldBySchemaId.get(ns.schema_id) : undefined
    if (!os) os = oldByName.get(ns.schema)
    if (os) matchedOld.add(os)

    const tableDiffs: TableDiff[] = []
    const oldTablesById = new Map<string, Table>()
    const oldTablesByName = new Map<string, Table>()
    for (const t of os?.tables ?? []) {
      if (t.table_id) oldTablesById.set(t.table_id, t)
      if (t.name) oldTablesByName.set(t.name, t)
    }
    const matchedOldTables = new Set<Table>()
    for (const nt of ns.tables) {
      let ot: Table | undefined = nt.table_id ? oldTablesById.get(nt.table_id) : undefined
      if (!ot) ot = oldTablesByName.get(nt.name)
      if (ot) matchedOldTables.add(ot)
      const td = diffTable(ot ?? null, nt)
      if (td) tableDiffs.push(td)
    }
    // 旧表中被删除的
    for (const ot of os?.tables ?? []) {
      if (matchedOldTables.has(ot)) continue
      const td = diffTable(ot, null)
      if (td) tableDiffs.push(td)
    }

    if (tableDiffs.length > 0) {
      const renamed = os && os.schema !== ns.schema
      result.push({
        schema_id: ns.schema_id ?? os?.schema_id,
        schema: ns.schema,
        tables: tableDiffs,
      })
      void renamed
    }
  }

  // 旧 schema 中被删除的
  for (const os of oldSchemas) {
    if (matchedOld.has(os)) continue
    const tableDiffs: TableDiff[] = os.tables.map(t => {
      const td = diffTable(t, null)
      return td!
    }).filter(Boolean)
    result.push({ schema_id: os.schema_id, schema: os.schema, tables: tableDiffs })
  }

  return result
}

/** 计算完整结构 diff（含 from/to 标识与是否变更） */
export function computeStructureDiff(
  fromSchemas: Schema[] | null,
  toSchemas: Schema[],
  fromRef: StructureDiff['from'],
  toRef: StructureDiff['to'],
): StructureDiff {
  const schemas = fromSchemas ? diffSchemas(fromSchemas, toSchemas) : diffSchemas([], toSchemas)
  const hasChanges = schemas.some(s => s.tables.length > 0)
  return { from: fromRef, to: toRef, schemas, hasChanges }
}
