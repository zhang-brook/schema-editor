import { toRaw } from 'vue'
import type { Field, Index, Table } from 'schema-editor-core/types/schema'
import { affectedCommon, affectedSql, affectedTable, type AffectedFile } from 'schema-editor-core/core/history/command'
import { sanitizeName } from 'schema-editor-core/core/workspace/layout'
import type { CrudDeps } from './editor-crud'

/** JSON-shaped values, including explicit undefined; never retain caller-owned patch data. */
export function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneValue) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, cloneValue(val)])) as T
  }
  return value
}

/** Snapshot values AND original identities. Restoring a detached tree must not strand older commands. */
export function captureValue<T>(value: T): () => T {
  if (!value || typeof value !== 'object') return () => value
  const target = value as Record<string, unknown>
  const entries = Object.entries(target).map(([key, val]) => [key, captureValue(val)] as const)
  const length = Array.isArray(value) ? value.length : undefined
  return () => {
    for (const key of Object.keys(target)) delete target[key]
    if (Array.isArray(value)) value.length = length!
    for (const [key, restore] of entries) target[key] = restore()
    return value
  }
}

export function captureProps<T extends object>(target: T, keys: (keyof T)[]): () => void {
  const entries = keys.map(key => ({ key, has: Object.hasOwn(target, key), restore: captureValue(target[key]) }))
  return () => {
    for (const { key, has, restore } of entries) {
      if (has) target[key] = restore()
      else delete target[key]
    }
  }
}

export function assignPatch<T extends object>(target: T, patch: Partial<T>) {
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (patch[key] === undefined) delete target[key]
    else target[key] = cloneValue(patch[key])!
  }
}

export function diskName(name: string) {
  return sanitizeName(name).normalize('NFC').toLowerCase()
}

export function validName(name: string): boolean {
  const disk = sanitizeName(name)
  return !!name && !!disk && !/[/\\<>:"|?*\p{Cc}]/u.test(name)
    && !/[. ]$/.test(disk) && disk !== '.' && disk !== '..'
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(disk)
}

export function uniqueName(base: string, names: string[]): string {
  const used = new Set(names.map(diskName))
  let name = base
  for (let n = 2; used.has(diskName(name)); n++) name = `${base}${n}`
  return name
}

export function removeItem<T>(items: T[], item: T) {
  const idx = items.indexOf(item)
  if (idx >= 0) items.splice(idx, 1)
}

export function moveItem<T>(items: T[], item: T, to: number) {
  removeItem(items, item)
  items.splice(to, 0, item)
}

export function createActionContext(deps: CrudDeps) {
  const ids = new WeakMap<object, number>()
  let nextId = 0
  function identity(object: object) {
    const raw = toRaw(object)
    if (!ids.has(raw)) ids.set(raw, ++nextId)
    return ids.get(raw)!
  }
  function ownerTable(item: Field | Index) {
    for (const schema of deps.schemas) {
      const table = schema.tables.find(table => table.fields.includes(item as Field) || table.indexes.includes(item as Index))
      if (table) return { schema, table }
    }
  }
  function currentSchemaName(table: Table) {
    return deps.schemas.find(schema => schema.tables.includes(table))?.schema ?? deps.currentSchema.value?.schema ?? ''
  }
  function tableFiles(table: Table): AffectedFile[] {
    return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
  }
  function fieldFiles(field: Field): AffectedFile[] {
    const owner = ownerTable(field)
    if (owner) return tableFiles(owner.table)
    if (Object.values(deps.commonConfig.value?.common_used_fields ?? {}).includes(field)) {
      return [affectedCommon(), affectedSql()]
    }
    return [affectedSql()]
  }
  function indexFiles(index: Index): AffectedFile[] {
    const owner = ownerTable(index)
    return owner ? tableFiles(owner.table) : [affectedSql()]
  }
  function objectKey(object: Field | Index | Table) {
    const table = 'fields' in object ? object : ownerTable(object)?.table
    const schema = table && deps.schemas.find(schema => schema.tables.includes(table))
    return `${schema ? identity(schema) : 'common'}:${table ? identity(table) : '-'}:${identity(object)}`
  }
  function patch<T extends object>(target: T, changes: Partial<T>, label: string, files: () => AffectedFile[], key?: string) {
    const next = cloneValue(changes)
    const keys = Object.keys(next) as (keyof T)[]
    if (!keys.length || keys.every(k => Object.is(target[k], next[k]))) return
    const restore = captureProps(target, keys)
    deps.executeCommand({
      label,
      coalesceKey: key,
      apply: () => assignPatch(target, next),
      revert: restore,
      affectedFiles: files,
    })
  }
  return { identity, ownerTable, currentSchemaName, tableFiles, fieldFiles, indexFiles, objectKey, patch }
}

export type ActionContext = ReturnType<typeof createActionContext>
