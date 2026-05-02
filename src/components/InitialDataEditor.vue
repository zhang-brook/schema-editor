<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { parseDefaultInput } from '@/utils/file-helpers'

const store = useEditorStore()

const editorMode = ref<'json' | 'table'>('table')
const jsonText = ref('')
const jsonError = ref('')

// 当前表的字段名列表（用于 table 模式的列头）
const fieldNames = computed(() => {
  if (!store.currentTable) return []
  return store.currentTable.fields
    .filter(f => !f.is_commented_out)
    .map(f => f.field_name)
})

// 当前初始数据行
const rows = computed(() => store.currentInitialData)
const hasData = computed(() => rows.value !== undefined && rows.value.length > 0)
const rowCount = computed(() => rows.value?.length ?? 0)

// 监听当前表切换，重新同步 JSON 文本
watch(() => store.currentInitialDataKey, () => {
  syncJsonText()
  jsonError.value = ''
}, { immediate: true })

// 监听 store 数据变化（table 模式编辑时），同步到 JSON 文本
watch(() => rows.value, () => {
  if (editorMode.value === 'table') {
    syncJsonText()
  }
}, { deep: true })

function syncJsonText() {
  if (rows.value && rows.value.length > 0) {
    jsonText.value = JSON.stringify(rows.value, null, 4)
  } else {
    jsonText.value = '[]'
  }
}

function onJsonInput(text: string) {
  jsonText.value = text
  try {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) {
      jsonError.value = 'JSON must be an array'
      return
    }
    jsonError.value = ''
    if (store.currentSchema && store.currentTable) {
      store.setInitialData(store.currentSchema.schema, store.currentTable.name, parsed)
    }
  } catch (e: any) {
    jsonError.value = e.message || 'Invalid JSON'
  }
}

function switchMode(mode: 'json' | 'table') {
  if (mode === editorMode.value) return

  if (mode === 'table' && editorMode.value === 'json') {
    // JSON -> Table: 先校验
    try {
      const parsed = JSON.parse(jsonText.value)
      if (!Array.isArray(parsed)) {
        jsonError.value = 'JSON must be an array, cannot switch to table mode'
        return
      }
      jsonError.value = ''
      if (store.currentSchema && store.currentTable) {
        store.setInitialData(store.currentSchema.schema, store.currentTable.name, parsed)
      }
    } catch (e: any) {
      jsonError.value = (e.message || 'Invalid JSON') + ' — fix JSON before switching to table mode'
      return
    }
  }

  if (mode === 'json' && editorMode.value === 'table') {
    syncJsonText()
  }

  editorMode.value = mode
}

function addEmptyData() {
  if (!store.currentSchema || !store.currentTable) return
  store.setInitialData(store.currentSchema.schema, store.currentTable.name, [{}])
  editorMode.value = 'table'
}

function addRow() {
  if (!store.currentSchema || !store.currentTable || !rows.value) return
  const newRow: Record<string, any> = {}
  rows.value.push(newRow)
}

function deleteRow(rowIdx: number) {
  if (!store.currentSchema || !store.currentTable || !rows.value) return
  rows.value.splice(rowIdx, 1)
  if (rows.value.length === 0) {
    store.setInitialData(store.currentSchema.schema, store.currentTable.name, [])
  }
}

function clearAllData() {
  if (!store.currentSchema || !store.currentTable) return
  if (!confirm('Clear all initial data for this table?')) return
  store.deleteInitialData(store.currentSchema.schema, store.currentTable.name)
  jsonText.value = '[]'
  jsonError.value = ''
}

function getCellValue(row: Record<string, any>, fieldName: string): string {
  const val = row[fieldName]
  if (val === undefined || val === null) return ''
  return String(val)
}

function setCellValue(row: Record<string, any>, fieldName: string, val: string) {
  if (val === '') {
    delete row[fieldName]
  } else {
    row[fieldName] = parseDefaultInput(val)
  }
}
</script>

<template>
  <div class="section-card" v-if="store.currentTable">
    <div class="section-header">
      <span>Initial Data</span>
      <span class="badge" v-if="hasData">{{ rowCount }} row(s)</span>
      <div class="header-actions">
        <template v-if="rows !== undefined">
          <div class="mode-toggle">
            <button
              class="mode-btn"
              :class="{ active: editorMode === 'table' }"
              @click="switchMode('table')"
            >Table</button>
            <button
              class="mode-btn"
              :class="{ active: editorMode === 'json' }"
              @click="switchMode('json')"
            >JSON</button>
          </div>
          <button class="btn btn-sm btn-danger" @click="clearAllData">Clear</button>
        </template>
      </div>
    </div>
    <div class="section-body" style="padding: 0;">
      <!-- 空状态 -->
      <div v-if="rows === undefined" class="empty-state">
        <span>No initial data configured</span>
        <button class="btn btn-sm btn-primary" @click="addEmptyData">Add Data</button>
      </div>

      <!-- JSON 编辑模式 -->
      <template v-else-if="editorMode === 'json'">
        <textarea
          class="json-editor"
          :value="jsonText"
          @input="onJsonInput(($event.target as HTMLTextAreaElement).value)"
          spellcheck="false"
        ></textarea>
        <div v-if="jsonError" class="json-error">{{ jsonError }}</div>
      </template>

      <!-- Table 编辑模式 -->
      <template v-else>
        <div class="table-toolbar">
          <button class="btn btn-sm btn-primary" @click="addRow">Add Row</button>
        </div>
        <div style="overflow-x: auto;">
          <table class="data-table" v-if="rows && rows.length > 0">
            <thead>
              <tr>
                <th style="width:36px;">#</th>
                <th v-for="fname in fieldNames" :key="fname">{{ fname }}</th>
                <th style="width:50px;">actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rIdx) in rows" :key="rIdx">
                <td class="row-num">{{ rIdx + 1 }}</td>
                <td v-for="fname in fieldNames" :key="fname">
                  <input
                    class="table-input"
                    :value="getCellValue(row, fname)"
                    @change="setCellValue(row, fname, ($event.target as HTMLInputElement).value)"
                    :placeholder="fname"
                  >
                </td>
                <td>
                  <button class="btn btn-sm btn-danger" @click="deleteRow(rIdx)">&times;</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="empty-rows">
            No rows — click "Add Row" to add data
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.section-card {
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 6px;
  margin-bottom: 16px;
  overflow: hidden;
}

.section-header {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  background: #fafafa;
  border-bottom: 1px solid #eee;
  font-weight: 600;
  font-size: 13px;
  color: #444;
  gap: 8px;
}

.section-header .badge {
  font-weight: 400;
  font-size: 11px;
  color: #888;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.mode-toggle {
  display: flex;
  border: 1px solid #ccc;
  border-radius: 3px;
  overflow: hidden;
}

.mode-btn {
  padding: 3px 10px;
  border: none;
  background: #fff;
  font-size: 11px;
  cursor: pointer;
  color: #555;
  transition: all .15s;
}

.mode-btn:not(:last-child) {
  border-right: 1px solid #ccc;
}

.mode-btn.active {
  background: #4a90d9;
  color: #fff;
}

.mode-btn:not(.active):hover {
  background: #f0f0f0;
}

.section-body {
  padding: 14px;
}

/* Empty State */
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px;
  color: #aaa;
  font-size: 12px;
}

/* JSON Editor */
.json-editor {
  width: 100%;
  min-height: 150px;
  max-height: 500px;
  padding: 12px 14px;
  border: none;
  background: #1e1e2e;
  color: #cdd6f4;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.6;
  resize: vertical;
  box-sizing: border-box;
}

.json-editor:focus {
  outline: none;
}

.json-error {
  padding: 6px 14px;
  background: #fff5f5;
  color: #d32f2f;
  font-size: 11px;
  border-top: 1px solid #ffcdd2;
}

/* Table Editor */
.table-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid #eee;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.data-table th,
.data-table td {
  padding: 5px 6px;
  border-bottom: 1px solid #eee;
  text-align: left;
  vertical-align: middle;
}

.data-table th {
  background: #f8f8f8;
  font-weight: 600;
  color: #555;
  font-size: 11px;
  white-space: nowrap;
}

.data-table tbody tr:hover {
  background: #f5f5f5;
}

.row-num {
  text-align: center;
  color: #aaa;
  font-size: 10px;
}

.table-input {
  padding: 3px 5px;
  border: 1px solid #ddd;
  border-radius: 3px;
  font-size: 12px;
  font-family: inherit;
  width: 100%;
  min-width: 60px;
  box-sizing: border-box;
}

.table-input:focus {
  outline: none;
  border-color: #4a90d9;
}

.empty-rows {
  padding: 14px;
  color: #aaa;
  font-size: 12px;
  text-align: center;
}

/* Buttons */
.btn {
  padding: 4px 10px;
  border: 1px solid #ccc;
  background: #fff;
  border-radius: 3px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}

.btn:hover {
  background: #f5f5f5;
}

.btn-primary {
  background: #4a90d9;
  color: #fff;
  border-color: #4a90d9;
}

.btn-primary:hover {
  background: #3a80c9;
}

.btn-danger {
  color: #d32f2f;
  border-color: #d32f2f;
}

.btn-danger:hover {
  background: #ffebee;
}

.btn-sm {
  padding: 2px 6px;
  font-size: 11px;
}
</style>
