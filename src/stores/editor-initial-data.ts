import { computed, toRaw, type ComputedRef } from 'vue'
import type { Schema, Table, InitialData, InitialDataRow } from '@/types/schema'
import { affectedInitialData, affectedSql, type Command } from '@/core/history/command'
import type { SqlDialect } from '@/utils/sql-generator/shared'
import { captureProps, captureValue, cloneValue } from './editor-action-utils'

export interface InitialDataDeps {
  initialDataMap: Map<string, InitialData>
  initialDataDeletedKeys: Set<string>
  schemas: Schema[]
  currentSchema: ComputedRef<Schema | null | undefined>
  currentTable: ComputedRef<Table | null | undefined>
  executeCommand: (cmd: Command) => void
  t: (key: string, options?: any) => string
}

export function createInitialDataActions(deps: InitialDataDeps) {
  const { initialDataMap, initialDataDeletedKeys, currentSchema, currentTable, executeCommand, t } = deps
  const rowIds = new WeakMap<object, number>()
  let nextRowId = 0

  function initialDataKey(schemaName: string, tableName: string): string {
    return `${schemaName}/${tableName}`
  }

  function findInitialDataOwner(data: InitialData): { schema: string; table: string } | null {
    for (const [key, value] of initialDataMap) {
      if (toRaw(value) === toRaw(data)) {
        const sep = key.indexOf('/')
        return { schema: key.substring(0, sep), table: key.substring(sep + 1) }
      }
    }
    return null
  }

  const currentInitialDataKey = computed(() => {
    if (!currentSchema.value || !currentTable.value) return null
    return initialDataKey(currentSchema.value.schema, currentTable.value.name)
  })
  const currentInitialData = computed(() => {
    if (!currentInitialDataKey.value) return undefined
    return initialDataMap.get(currentInitialDataKey.value)
  })

  function restoreDeleted(key: string, deleted: boolean) {
    if (deleted) initialDataDeletedKeys.add(key)
    else initialDataDeletedKeys.delete(key)
  }

  function files(schema: string, table: string) {
    return [affectedInitialData(schema, table), affectedSql()]
  }

  /** 快照恢复原对象身份；JSON 替换撤销后，之前捕获行对象的命令仍然有效。 */
  function replaceEntry(schema: string, table: string, next: InitialData | undefined, label: string) {
    const key = initialDataKey(schema, table)
    const oldDeleted = initialDataDeletedKeys.has(key)
    const restoreBefore = captureValue(initialDataMap.get(key))
    // 输入必须与调用者隔离，apply/redo 也不能读取已被外部修改的对象内容。
    const restoreAfter = captureValue(cloneValue(next))
    function install(data: InitialData | undefined, deleted: boolean) {
      if (data === undefined) initialDataMap.delete(key)
      else initialDataMap.set(key, data)
      restoreDeleted(key, deleted)
    }
    executeCommand({
      label,
      apply: () => install(restoreAfter(), next === undefined),
      revert: () => install(restoreBefore(), oldDeleted),
      affectedFiles: () => files(schema, table),
    })
  }

  /** 显式初始化保留 {}；不同于 JSON 空对象（删除）及 rows: []（空行集合）。 */
  function addInitialData(schema: string, table: string) {
    if (initialDataMap.has(initialDataKey(schema, table))) return
    replaceEntry(schema, table, {}, t('initialData.init'))
  }

  function setInitialDataObject(schema: string, table: string, data: InitialData) {
    const willDelete = (data.rows?.length ?? 0) === 0 && !data.pre_sql && !data.post_sql
    replaceEntry(schema, table, willDelete ? undefined : data, t('history.editInitialDataObject'))
  }

  function deleteInitialData(schema: string, table: string) {
    const key = initialDataKey(schema, table)
    if (!initialDataMap.has(key) && initialDataDeletedKeys.has(key)) return
    replaceEntry(schema, table, undefined, t('history.deleteInitialData'))
  }

  /** 局部快照同时保存属性存在性及行身份，不把整表复制成新的行对象。 */
  function patchEntry(
    schema: string,
    table: string,
    next: Partial<InitialData>,
    label: string,
    coalesceKey?: string,
  ) {
    const key = initialDataKey(schema, table)
    const before = initialDataMap.get(key)
    const data = before ?? {}
    const oldDeleted = initialDataDeletedKeys.has(key)
    const keys = Object.keys(next) as (keyof InitialData)[]
    const restoreBefore = captureProps(data, keys)
    const restoreAfter = captureValue(next)
    executeCommand({
      label,
      coalesceKey,
      apply() {
        const patch = restoreAfter()
        for (const prop of keys) {
          if (patch[prop] === undefined) delete data[prop]
          else Object.assign(data, { [prop]: patch[prop] })
        }
        // 每次 apply 都安装条目：首次 SQL 输入与随后的输入合并后 redo 仍可原子创建。
        initialDataMap.set(key, data)
        initialDataDeletedKeys.delete(key)
      },
      revert() {
        restoreBefore()
        if (before === undefined) initialDataMap.delete(key)
        else initialDataMap.set(key, before)
        restoreDeleted(key, oldDeleted)
      },
      affectedFiles: () => files(schema, table),
    })
  }

  function addInitialDataRow(schema: string, table: string, row: InitialDataRow = { data: {} }) {
    const rows = initialDataMap.get(initialDataKey(schema, table))?.rows ?? []
    patchEntry(schema, table, { rows: [...rows, cloneValue(row)] }, t('initialData.addRow'))
  }

  function deleteInitialDataRow(schema: string, table: string, index: number) {
    const rows = initialDataMap.get(initialDataKey(schema, table))?.rows
    if (!rows || !Number.isInteger(index) || index < 0 || index >= rows.length) return
    const next = rows.slice()
    next.splice(index, 1)
    patchEntry(schema, table, { rows: next.length ? next : undefined }, t('history.deleteInitialData'))
  }

  function moveInitialDataRow(schema: string, table: string, from: number, to: number) {
    const rows = initialDataMap.get(initialDataKey(schema, table))?.rows
    if (!rows || !Number.isInteger(from) || !Number.isInteger(to)
      || from < 0 || to < 0 || from >= rows.length || to >= rows.length || from === to) return
    const next = rows.slice()
    next.splice(to, 0, next.splice(from, 1)[0]!)
    patchEntry(schema, table, { rows: next }, t('history.editInitialDataObject'))
  }

  function clearInitialDataRows(schema: string, table: string) {
    const data = initialDataMap.get(initialDataKey(schema, table))
    if (!data || !Object.hasOwn(data, 'rows')) return
    patchEntry(schema, table, { rows: undefined }, t('initialData.clear'))
  }

  function rowKey(schema: string, table: string, row: InitialDataRow, property: string, field?: string) {
    const raw = toRaw(row)
    if (!rowIds.has(raw)) rowIds.set(raw, ++nextRowId)
    return JSON.stringify(['initial-data', schema, table, rowIds.get(raw), property, field])
  }

  function patchRow(
    schema: string,
    table: string,
    row: InitialDataRow,
    next: Partial<InitialDataRow>,
    label: string,
    coalesceKey?: string,
  ) {
    const data = initialDataMap.get(initialDataKey(schema, table))
    if (!data?.rows?.some(candidate => toRaw(candidate) === toRaw(row))) return
    const patch = cloneValue(next)
    const keys = Object.keys(patch) as (keyof InitialDataRow)[]
    const restoreBefore = captureProps(row, keys)
    executeCommand({
      label,
      coalesceKey,
      apply() {
        for (const prop of keys) {
          if (patch[prop] === undefined) delete row[prop]
          else Object.assign(row, { [prop]: cloneValue(patch[prop]) })
        }
      },
      revert: restoreBefore,
      affectedFiles: () => files(schema, table),
    })
  }

  function setInitialDataCell(schema: string, table: string, row: InitialDataRow, field: string, val: unknown) {
    if (val === undefined ? !Object.hasOwn(row.data, field) : Object.hasOwn(row.data, field) && Object.is(row.data[field], val)) return
    const data = { ...row.data }
    if (val === undefined) delete data[field]
    else Object.defineProperty(data, field, { value: val, writable: true, enumerable: true, configurable: true })
    patchRow(schema, table, row, { data }, t('history.editInitialDataCell', { name: field }), rowKey(schema, table, row, 'data', field))
  }

  function setInitialDataRowSkip(schema: string, table: string, row: InitialDataRow, checked: boolean) {
    if (checked ? row.is_skip === true : !Object.hasOwn(row, 'is_skip')) return
    patchRow(schema, table, row, { is_skip: checked ? true : undefined }, t('history.toggleSkipRow'))
  }

  function setInitialDataRowComment(schema: string, table: string, row: InitialDataRow, val: string) {
    const comment = val.trim() || undefined
    if (comment === undefined ? !Object.hasOwn(row, 'row_comment') : row.row_comment === comment) return
    patchRow(schema, table, row, { row_comment: comment }, t('history.editInitialDataRowComment'), rowKey(schema, table, row, 'row_comment'))
  }

  function setInitialDataFieldComment(schema: string, table: string, row: InitialDataRow, field: string, val: string) {
    const comment = val.trim()
    if (comment ? row.field_comments?.[field] === comment : !row.field_comments || !Object.hasOwn(row.field_comments, field)) return
    const comments = { ...row.field_comments }
    if (comment) Object.defineProperty(comments, field, { value: comment, writable: true, enumerable: true, configurable: true })
    else delete comments[field]
    patchRow(schema, table, row, { field_comments: Object.keys(comments).length ? comments : undefined },
      t('history.editInitialDataComment', { name: field }), rowKey(schema, table, row, 'field_comments', field))
  }

  function setInitialDataCellExpr(schema: string, table: string, row: InitialDataRow, field: string, checked: boolean) {
    if (checked ? row.expr_fields?.[field] === true : !row.expr_fields || !Object.hasOwn(row.expr_fields, field)) return
    const expressions = { ...row.expr_fields }
    if (checked) Object.defineProperty(expressions, field, { value: true, writable: true, enumerable: true, configurable: true })
    else delete expressions[field]
    patchRow(schema, table, row, { expr_fields: Object.keys(expressions).length ? expressions : undefined },
      t('history.toggleInitialDataExpr', { name: field }))
  }

  function setSql(schema: string, table: string, property: 'pre_sql' | 'post_sql', dialect: SqlDialect, val: string) {
    const sql = initialDataMap.get(initialDataKey(schema, table))?.[property]
    const trimmed = val.trim()
    if (trimmed ? sql?.[dialect] === trimmed : !sql || !Object.hasOwn(sql, dialect)) return
    const next = { ...sql }
    if (trimmed) next[dialect] = trimmed
    else delete next[dialect]
    patchEntry(schema, table, { [property]: Object.keys(next).length ? next : undefined },
      t(property === 'pre_sql' ? 'history.editInitialDataPreSql' : 'history.editInitialDataPostSql', { dialect }),
      JSON.stringify(['initial-data', schema, table, property, dialect]))
  }

  function setInitialDataPreSql(schema: string, table: string, dialect: SqlDialect, val: string) {
    setSql(schema, table, 'pre_sql', dialect, val)
  }

  function setInitialDataPostSql(schema: string, table: string, dialect: SqlDialect, val: string) {
    setSql(schema, table, 'post_sql', dialect, val)
  }

  function clearInitialDataPrePostSql(schema: string, table: string) {
    const data = initialDataMap.get(initialDataKey(schema, table))
    if (!data || (!Object.hasOwn(data, 'pre_sql') && !Object.hasOwn(data, 'post_sql'))) return
    patchEntry(schema, table, { pre_sql: undefined, post_sql: undefined }, t('initialData.clear'))
  }

  return {
    initialDataKey,
    findInitialDataOwner,
    currentInitialDataKey,
    currentInitialData,
    addInitialData,
    setInitialDataObject,
    deleteInitialData,
    addInitialDataRow,
    deleteInitialDataRow,
    moveInitialDataRow,
    clearInitialDataRows,
    setInitialDataRowSkip,
    setInitialDataFieldComment,
    setInitialDataCell,
    setInitialDataRowComment,
    setInitialDataCellExpr,
    setInitialDataPreSql,
    setInitialDataPostSql,
    clearInitialDataPrePostSql,
  }
}
