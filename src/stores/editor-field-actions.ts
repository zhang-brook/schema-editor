import type { CommentOption, Field, Index, Schema, Table } from '@/types/schema'
import type { SqlDialect } from '@/utils/sql-generator/shared'
import { resolveFieldTypeForDialect } from '@/utils/sql-generator/shared'
import { affectedInitialData } from '@/core/history/command'
import { parseFieldLengthInput } from '@/utils/file-helpers'
import { confirmDialog } from '@/composables/useConfirm'
import { captureProps, captureValue, cloneValue, moveItem, removeItem, type ActionContext } from './editor-action-utils'
import type { CrudDeps } from './editor-crud'

export function createFieldActions(deps: CrudDeps, ctx: ActionContext) {
  const { schemas, commonConfig, executeCommand, showToast, t } = deps
  function isCommonField(field: Field) { return field.use_common_used_fields === true }
  function getResolvedField(field: Field): Field {
    return isCommonField(field) ? commonConfig.value?.common_used_fields[field.field_name] ?? field : field
  }
  function fieldKey(schema: Schema, table: Table, field: Field) { return `${schema.schema}-${table.name}-${field.field_name}` }
  function indexKey(schema: Schema, table: Table, index: Index, idx: number) { return `${schema.schema}-${table.name}-idx-${index.name || idx}` }
  function getResolvedFieldTypeForDb(field: Field, db: SqlDialect): string {
    const info = resolveFieldTypeForDialect(getResolvedField(field), db, commonConfig.value)
    if (!info.type) return '-'
    if (typeof info.scale === 'number' && typeof info.length === 'number') return `${info.type}(${info.length},${info.scale})`
    return info.length == null ? info.type : `${info.type}(${info.length})`
  }
  function fieldTypeDisplay(field: Field) { const f = getResolvedField(field); return f.unified_type || f.field_type || '-' }
  function hasFieldOverrides(field: Field) {
    const f = getResolvedField(field)
    return [f.mysql, f.postgresql, f.sqlite].some(value => value && Object.keys(value).length > 0)
  }
  function quoteDefaultForField(field: Field) {
    const f = getResolvedField(field)
    return f.quote_default ?? commonConfig.value?.unified_types?.find(type => type.name === f.unified_type)?.quote_default ?? false
  }
  function currentSchemaNameOfField(field: Field) { return ctx.ownerTable(field)?.schema.schema ?? deps.currentSchema.value?.schema ?? '' }

  /** Related structures are snapshotted once, with their original objects retained for older history entries. */
  function changeStructure(table: Table, label: string, recipe: () => void, initialData = false) {
    const keys: (keyof Table)[] = ['fields', 'indexes', 'comment_before_fields', 'partition']
    const before = captureProps(table, keys)
    const schema = ctx.currentSchemaName(table)
    const data = initialData ? deps.initialDataMap.get(deps.initialDataKey(schema, table.name)) : undefined
    const beforeData = captureValue(data)
    let after: (() => void) | undefined
    let afterData: (() => unknown) | undefined
    executeCommand({
      label,
      apply() {
        if (after) { after(); afterData?.() }
        else { recipe(); after = captureProps(table, keys); afterData = captureValue(data) }
      },
      revert() { before(); beforeData() },
      affectedFiles: () => [...ctx.tableFiles(table), ...(data ? [affectedInitialData(schema, table.name)] : [])],
    })
  }

  /** Field deletion deliberately preserves initial rows and partition expressions, as before. */
  function removeFieldReferences(table: Table, names: string[]) {
    const removedNames = new Set(names.filter(Boolean))
    for (const index of [...table.indexes]) {
      if (!index.columns.some(col => removedNames.has(col.name))) continue
      index.columns = index.columns.filter(col => !removedNames.has(col.name))
      if (!index.columns.length) removeItem(table.indexes, index)
    }
    if (table.comment_before_fields) {
      for (const name of names) delete table.comment_before_fields[name]
      if (!Object.keys(table.comment_before_fields).length) delete table.comment_before_fields
    }
  }

  function openAddFieldModal(schemaIdx: number, tableIdx: number, mode: 'normal' | 'common') {
    deps.addFieldSchemaIdx.value = schemaIdx
    deps.addFieldTableIdx.value = tableIdx
    deps.addFieldMode.value = mode
    deps.newFieldName.value = ''
    deps.newFieldSelectCommon.value = ''
    if (mode === 'common') deps.newFieldSelectCommons.value = schemas[schemaIdx]?.tables[tableIdx]?.fields.filter(isCommonField).map(f => f.field_name) ?? []
    deps.showAddFieldModal.value = true
  }
  function addField(table: Table, field: Field) {
    const restore = captureValue(field)
    executeCommand({ label: t('history.addField'), apply() { table.fields.push(restore()) }, revert() { removeItem(table.fields, field) }, affectedFiles: () => ctx.tableFiles(table) })
  }
  function confirmAddField() {
    const table = schemas[deps.addFieldSchemaIdx.value]?.tables[deps.addFieldTableIdx.value]
    if (!table) return
    if (deps.addFieldMode.value === 'common') {
      const selected = [...new Set(deps.newFieldSelectCommons.value)]
      const removed = table.fields.filter(f => isCommonField(f) && !selected.includes(f.field_name))
      const added: Field[] = selected.filter(name => !table.fields.some(f => f.field_name === name)).map(field_name => ({ field_name, use_common_used_fields: true }))
      if (removed.length || added.length) {
        changeStructure(table, t('history.editCommonFields'), () => {
          for (const field of removed) removeItem(table.fields, field)
          table.fields.push(...added)
          removeFieldReferences(table, removed.map(f => f.field_name))
        })
      }
      showToast(added.length && removed.length ? t('toast.commonFieldsUpdated', { added: added.length, removed: removed.length })
        : added.length ? t('toast.commonFieldsAdded', { n: added.length })
          : removed.length ? t('toast.commonFieldsRemoved', { n: removed.length }) : t('toast.noChange'))
    } else {
      const name = deps.newFieldName.value.trim()
      if (!name) { showToast(t('toast.pleaseEnterFieldName')); return }
      if (table.fields.some(f => f.field_name.toLowerCase() === name.toLowerCase())) { showToast(t('toast.fieldExistsInTable', { name })); return }
      const ut = deps.newFieldUnifiedType.value || undefined
      addField(table, { field_name: name, unified_type: ut, field_type: ut ? undefined : 'varchar', field_length: ut ? undefined : 255, not_null: false, primary_key: false, comment: '' })
      showToast(t('toast.fieldAdded'))
    }
    deps.showAddFieldModal.value = false
  }
  function directAddField(schemaIdx: number, tableIdx: number) {
    const table = schemas[schemaIdx]?.tables[tableIdx]
    if (!table) return
    addField(table, { field_name: '', field_type: 'varchar', field_length: 255, not_null: false, primary_key: false, comment: '' })
    showToast(t('toast.fieldAdded'))
  }
  async function deleteField(table: Table, fieldIdx: number) {
    const field = table.fields[fieldIdx]
    if (!field) return
    if (field.field_name && !(await confirmDialog({ title: t('confirm.title'), message: t('confirm.deleteField', { name: field.field_name }), confirmText: t('confirm.ok'), cancelText: t('confirm.cancel') }))) return
    if (!table.fields.includes(field)) return
    changeStructure(table, t('history.deleteField', { name: field.field_name }), () => {
      removeItem(table.fields, field)
      removeFieldReferences(table, [field.field_name])
    })
    showToast(t('toast.fieldDeleted'))
  }

  function updateFieldProp(table: Table, field: Field, prop: keyof Field, value: unknown, key?: string) {
    updateFieldProps(table, field, { [prop]: value }, key)
  }
  function updateFieldProps(table: Table, field: Field, changes: Partial<Field>, key?: string) {
    if (changes.field_name !== undefined && changes.field_name !== field.field_name) {
      renameField(table, field, changes.field_name, changes)
      return
    }
    ctx.patch(field, changes, t('history.editField', { prop: Object.keys(changes).join(',') }), () => ctx.fieldFiles(field),
      `field:${ctx.objectKey(field)}:${key ?? 'props'}:${Object.keys(changes).sort().join(',')}`)
  }
  function renameRecordKey(record: Record<string, unknown> | undefined, oldName: string, newName: string) {
    if (!record || !Object.hasOwn(record, oldName)) return
    const entries = Object.entries(record).filter(([key]) => key !== newName).map(([key, value]) => [key === oldName ? newName : key, value])
    for (const key of Object.keys(record)) delete record[key]
    Object.assign(record, Object.fromEntries(entries))
  }
  function renameIndexColumns(table: Table, oldName: string, newName: string) {
    if (!oldName) return
    for (const index of table.indexes) for (const col of index.columns) if (col.name === oldName) col.name = newName
  }
  function renameField(table: Table, field: Field, name: string, changes: Partial<Field> = {}) {
    const newName = name.trim()
    const oldName = field.field_name
    if (!newName || newName === oldName) return
    if (table.fields.some(f => f !== field && f.field_name.toLowerCase() === newName.toLowerCase())) {
      showToast(t('toast.fieldExistsInTable', { name: newName }))
      return
    }
    const next = cloneValue(changes)
    changeStructure(table, t('history.renameField', { name: newName }), () => {
      Object.assign(field, cloneValue(next), { field_name: newName })
      renameIndexColumns(table, oldName, newName)
      if (oldName) {
        renameRecordKey(table.comment_before_fields, oldName, newName)
        for (const db of ['mysql', 'postgresql', 'sqlite'] as const) {
          const cfg = table.partition?.[db]
          if (cfg?.columns) cfg.columns = cfg.columns.map(name => name === oldName ? newName : name)
        }
        const data = deps.initialDataMap.get(deps.initialDataKey(ctx.currentSchemaName(table), table.name))
        for (const row of data?.rows ?? []) {
          renameRecordKey(row.data, oldName, newName)
          renameRecordKey(row.field_comments, oldName, newName)
          renameRecordKey(row.expr_fields, oldName, newName)
        }
      }
    }, true)
  }
  function updateFieldName(table: Table, field: Field, newName: string) { renameField(table, field, newName) }
  /** Compatibility action; unlike the former helper it never writes outside a command. */
  function syncFieldNameInIndexes(table: Table, oldName: string, newName: string) {
    if (!oldName || !newName || oldName === newName) return
    changeStructure(table, t('history.renameField', { name: newName }), () => renameIndexColumns(table, oldName, newName))
  }

  function moveField(table: Table, fromIdx: number, toIdx: number) {
    const field = table.fields[fromIdx]
    if (!field || toIdx < 0 || toIdx > table.fields.length) return
    const insertIdx = toIdx > fromIdx ? toIdx - 1 : toIdx
    if (fromIdx === insertIdx) return
    executeCommand({ label: t('history.moveField'), apply: () => moveItem(table.fields, field, insertIdx), revert: () => moveItem(table.fields, field, fromIdx), affectedFiles: () => ctx.tableFiles(table) })
  }
  function moveFieldUp(table: Table, idx: number) { if (idx > 0) moveField(table, idx, idx - 1) }
  function moveFieldDown(table: Table, idx: number) { if (idx < table.fields.length - 1) moveField(table, idx, idx + 2) }

  function getFieldOverrideValue(field: Field, db: SqlDialect, key: string) { return (field[db] as Record<string, unknown> | undefined)?.[key] ?? '' }
  function setFieldOverrideValue(field: Field, db: SqlDialect, key: string, value: unknown) {
    const next: Record<string, unknown> = { ...cloneValue(field[db] ?? {}) }
    const val = value === '' || value == null ? undefined : key === 'field_length' || key === 'field_scale' ? parseFieldLengthInput(String(value)) : cloneValue(value)
    if (val === undefined) delete next[key]
    else next[key] = val
    ctx.patch(field, { [db]: Object.keys(next).length ? next : undefined }, t('history.editFieldOverride', { db }), () => ctx.fieldFiles(field), `field-override:${ctx.objectKey(field)}:${db}:${key}`)
  }
  function applyCommentOptions(field: Field, value: CommentOption[], key?: string) {
    ctx.patch(field, { comment_options: value.length ? value : undefined }, t('history.editFieldCommentOptions'), () => ctx.fieldFiles(field), key ? `comment-options:${ctx.objectKey(field)}:${key}` : undefined)
  }
  function setFieldCommentOptionsEnabled(_table: Table, field: Field, enabled: boolean) {
    const next: Partial<Field> = { comment_options_enabled: enabled || undefined }
    if (enabled && !field.comment_options?.length) next.comment_options = [{ label: '', value: '' }]
    ctx.patch(field, next, t('history.editFieldCommentOptions'), () => ctx.fieldFiles(field))
  }
  function addFieldCommentOption(_table: Table, field: Field) { applyCommentOptions(field, [...(field.comment_options ?? []), { label: '', value: '' }]) }
  function updateFieldCommentOption(_table: Table, field: Field, idx: number, key: keyof CommentOption, value: string) {
    if (!field.comment_options?.[idx]) return
    const next = cloneValue(field.comment_options)
    const option = next[idx]!
    if (['mysql', 'postgresql', 'sqlite'].includes(key) && !value) delete option[key]
    else option[key] = value
    applyCommentOptions(field, next, `${idx}:${key}`)
  }
  function removeFieldCommentOption(_table: Table, field: Field, idx: number) {
    if (field.comment_options?.[idx]) applyCommentOptions(field, field.comment_options.filter((_, i) => i !== idx))
  }

  return { isCommonField, getResolvedField, fieldKey, indexKey, getResolvedFieldTypeForDb, fieldTypeDisplay, hasFieldOverrides, quoteDefaultForField, currentSchemaNameOfField, openAddFieldModal, confirmAddField, directAddField, deleteField, updateFieldProp, updateFieldProps, updateFieldName, syncFieldNameInIndexes, moveField, moveFieldUp, moveFieldDown, getFieldOverrideValue, setFieldOverrideValue, setFieldCommentOptionsEnabled, addFieldCommentOption, updateFieldCommentOption, removeFieldCommentOption }
}
