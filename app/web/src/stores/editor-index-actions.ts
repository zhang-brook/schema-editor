import type { Index, Table } from 'schema-editor-core/types/schema'
import type { SqlDialect } from 'schema-editor-core/utils/sql-generator/shared'
import { resolveIndexName } from 'schema-editor-core/utils/sql-generator/shared'
import { formatIndexColumn } from 'schema-editor-core/utils/index-column-utils'
import { confirmDialog } from '@/composables/useConfirm'
import { captureValue, cloneValue, moveItem, removeItem, type ActionContext } from './editor-action-utils'
import type { CrudDeps } from './editor-crud'

export function createIndexActions(deps: CrudDeps, ctx: ActionContext) {
  const { executeCommand, showToast, t } = deps
  function addIndex(table: Table) {
    const index: Index = { type: 'index', columns: [{ name: '' }], using: '', use_default_name: true }
    const restore = captureValue(index)
    executeCommand({ label: t('history.addIndex'), apply() { table.indexes.push(restore()) }, revert() { removeItem(table.indexes, index) }, affectedFiles: () => ctx.tableFiles(table) })
    showToast(t('toast.indexAdded'))
  }
  async function deleteIndex(table: Table, idx: number) {
    const index = table.indexes[idx]
    if (!index || !(await confirmDialog({ title: t('confirm.title'), message: t('confirm.deleteIndex'), confirmText: t('confirm.ok'), cancelText: t('confirm.cancel') }))) return
    const position = table.indexes.indexOf(index)
    if (position < 0) return
    const restore = captureValue(index)
    executeCommand({ label: t('history.deleteIndex'), apply() { removeItem(table.indexes, index) }, revert() { table.indexes.splice(position, 0, restore()) }, affectedFiles: () => ctx.tableFiles(table) })
    showToast(t('toast.indexDeleted'))
  }
  function moveIndex(table: Table, fromIdx: number, toIdx: number) {
    const index = table.indexes[fromIdx]
    if (!index || toIdx < 0 || toIdx > table.indexes.length) return
    const insertIdx = toIdx > fromIdx ? toIdx - 1 : toIdx
    if (fromIdx === insertIdx) return
    executeCommand({ label: t('history.moveIndex'), apply: () => moveItem(table.indexes, index, insertIdx), revert: () => moveItem(table.indexes, index, fromIdx), affectedFiles: () => ctx.tableFiles(table) })
  }
  function moveIndexUp(table: Table, idx: number) { if (idx > 0) moveIndex(table, idx, idx - 1) }
  function moveIndexDown(table: Table, idx: number) { if (idx < table.indexes.length - 1) moveIndex(table, idx, idx + 2) }
  /** The complete columns array (including dialect overrides) is one atomic, non-coalescing patch. */
  function updateIndex(table: Table, index: Index, changes: Partial<Index>, key?: string) {
    ctx.patch(index, changes, t(Object.hasOwn(changes, 'columns') ? 'history.editIndexColumns' : 'history.editIndexOverride'), () => ctx.tableFiles(table),
      Object.hasOwn(changes, 'columns') ? undefined : `index:${ctx.objectKey(index)}:${key ?? Object.keys(changes).sort().join(',')}`)
  }
  function indexColumnsText(index: Index) { return (index.columns ?? []).map(formatIndexColumn).filter(Boolean).join(', ') }
  function setIndexColumns(index: Index, text: string) {
    const names = text.split(',').map(s => s.trim()).filter(Boolean)
    ctx.patch(index, { columns: names.length ? names.map(name => ({ name })) : [{ name: '' }] }, t('history.editIndexColumns'), () => ctx.indexFiles(index))
  }
  function getResolvedIndexNameForDb(index: Index, table: Table, db: SqlDialect) { return resolveIndexName(index, db, table.name) || '-' }
  function getIndexOverrideValue(index: Index, db: SqlDialect, key: string) { return (index[db] as Record<string, unknown> | undefined)?.[key] ?? '' }
  function setIndexOverrideValue(index: Index, db: SqlDialect, key: string, value: unknown) {
    const next: Record<string, unknown> = cloneValue(index[db] ?? {})
    if (value === '' || value == null) delete next[key]
    else next[key] = cloneValue(value)
    ctx.patch(index, { [db]: Object.keys(next).length ? next : undefined }, t('history.editIndexOverride'), () => ctx.indexFiles(index), `index-override:${ctx.objectKey(index)}:${db}:${key}`)
  }
  return { addIndex, deleteIndex, moveIndex, moveIndexUp, moveIndexDown, updateIndex, indexColumnsText, setIndexColumns, getResolvedIndexNameForDb, getIndexOverrideValue, setIndexOverrideValue }
}
