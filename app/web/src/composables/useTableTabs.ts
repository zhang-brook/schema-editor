import { computed, ref, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import type { Schema, Table } from 'schema-editor-core/types/schema'

/** Opened editor tabs */
export interface TableTab {
  schema: Schema
  table: Table
}

/** Maximum number of tabs: beyond this, the oldest non-active tab is dropped */
const MAX_TABS = 12

const tabs = ref<TableTab[]>([])

/** Appends a tab to the list: no-op if already present; drops the oldest non-active tab when exceeding the limit */
export function addTab(tabs: TableTab[], tab: TableTab, isActive: (tab: TableTab) => boolean): void {
  if (tabs.some(item => item.schema === tab.schema && item.table === tab.table)) return
  tabs.push(tab)
  if (tabs.length > MAX_TABS) {
    const evictIdx = tabs.findIndex(item => !isActive(item))
    if (evictIdx >= 0) tabs.splice(evictIdx, 1)
  }
}

/** Removes a tab and returns the neighbor that should become active: right neighbor first, left neighbor if none; returns null when the tab is not in the list or the list is already empty */
export function removeTab(tabs: TableTab[], tab: TableTab): TableTab | null {
  const idx = tabs.indexOf(tab)
  if (idx < 0) return null
  tabs.splice(idx, 1)
  return tabs[idx] ?? tabs[idx - 1] ?? null
}

/**
 * Table editor tabs: the currently selected table automatically enters the tab list, and clicking a tab switches back to that table.
 * Tabs store object references rather than indices, so they still point to the same table after Schema/table renames or moves.
 */
export function useTableTabs() {
  const store = useEditorStore()

  /** Filters out deleted Schemas / tables (including tables deleted together with their Schema) */
  const openTabs = computed(() =>
    tabs.value.filter(tab => store.schemas.includes(tab.schema) && tab.schema.tables.includes(tab.table)),
  )

  function isActive(tab: TableTab): boolean {
    return store.currentSchema === tab.schema && store.currentTable === tab.table
  }

  function activate(tab: TableTab) {
    const schemaIdx = store.schemas.indexOf(tab.schema)
    const tableIdx = schemaIdx < 0 ? -1 : tab.schema.tables.indexOf(tab.table)
    if (schemaIdx < 0 || tableIdx < 0) return
    store.selectTable(schemaIdx, tableIdx)
  }

  function close(tab: TableTab) {
    if (!tabs.value.includes(tab)) return
    const wasActive = isActive(tab)
    const next = removeTab(tabs.value, tab)
    if (!wasActive) return
    // After closing the current tab, switch to a neighbor tab, or return to the Schema overview if there is none
    if (next) activate(next)
    else if (store.selectedSchemaIdx >= 0) store.selectSchemaOnly(store.selectedSchemaIdx)
  }

  watch(
    () => [store.currentSchema, store.currentTable] as const,
    ([schema, table]) => {
      if (!schema || !table) return
      addTab(tabs.value, { schema, table }, isActive)
    },
    { immediate: true },
  )

  return { openTabs, isActive, activate, close }
}
