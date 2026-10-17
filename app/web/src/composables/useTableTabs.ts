import { computed, ref, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import type { Schema, Table } from 'schema-editor-core/types/schema'

/** 已打开的编辑标签 */
export interface TableTab {
  schema: Schema
  table: Table
}

/** 标签数量上限：超出后丢弃最早打开的非当前标签 */
const MAX_TABS = 12

const tabs = ref<TableTab[]>([])

/** 把标签追加进列表：已在列表中则不动；超出上限时丢弃最早的非当前标签 */
export function addTab(tabs: TableTab[], tab: TableTab, isActive: (tab: TableTab) => boolean): void {
  if (tabs.some(item => item.schema === tab.schema && item.table === tab.table)) return
  tabs.push(tab)
  if (tabs.length > MAX_TABS) {
    const evictIdx = tabs.findIndex(item => !isActive(item))
    if (evictIdx >= 0) tabs.splice(evictIdx, 1)
  }
}

/** 移除标签，返回应转为激活的邻居：右邻优先，无右邻取左邻；标签不在列表或列表已空时返回 null */
export function removeTab(tabs: TableTab[], tab: TableTab): TableTab | null {
  const idx = tabs.indexOf(tab)
  if (idx < 0) return null
  tabs.splice(idx, 1)
  return tabs[idx] ?? tabs[idx - 1] ?? null
}

/**
 * 表编辑标签：当前选中的表自动进入标签列表，点击标签切回对应表。
 * 标签记录对象引用而非索引，Schema/表重命名、移动后依然指向同一张表。
 */
export function useTableTabs() {
  const store = useEditorStore()

  /** 剔除已被删除的 Schema / 表（含随 Schema 一并删除的表） */
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
    // 关闭当前标签后切到邻居标签，没有邻居就回到 Schema 总览
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
