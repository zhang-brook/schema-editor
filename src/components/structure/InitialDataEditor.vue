<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import { parseDefaultInput } from '@/utils/file-helpers'
import { normalizeInitialData } from '@/utils/initial-data-io'
import { getInitialDataPreSql, getInitialDataPostSql, type SqlDialect } from '@/utils/sql-generator/shared'
import { confirmDialog } from '@/composables/useConfirm'
import type { InitialData, InitialDataRow } from '@/types/schema'
import PrePostSqlEditor from '@/components/common/PrePostSqlEditor.vue'
import InitialDataSqlPreview from './InitialDataSqlPreview.vue'

const store = useEditorStore()
const { t } = useI18n()

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

// 当前初始数据（wrapper）
const initialData = computed(() => store.currentInitialData)
const rows = computed(() => initialData.value?.rows)

const hasData = computed(() => rows.value !== undefined && rows.value.length > 0)
const rowCount = computed(() => rows.value?.length ?? 0)

/** JSON 文本是否为合法 JSON（语法有效） */
const isJsonValid = computed(() => {
  try {
    JSON.parse(jsonText.value)
    return true
  } catch {
    return false
  }
})

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
  const wrapper = initialData.value
  if (wrapper && (wrapper.rows?.length || wrapper.pre_sql || wrapper.post_sql)) {
    jsonText.value = JSON.stringify(wrapper, null, 4)
  } else {
    jsonText.value = '{}'
  }
}

/** 格式化 JSON 文本（4 空格缩进） */
function formatJson() {
  try {
    const parsed = JSON.parse(jsonText.value)
    jsonText.value = JSON.stringify(parsed, null, 4)
    jsonError.value = ''
    // 格式化后同步到 store
    const result = parseJsonInput(jsonText.value)
    if (result && store.currentSchema && store.currentTable) {
      store.setInitialDataObject(store.currentSchema.schema, store.currentTable.name, result)
    }
  } catch {
    // 不可达：按钮禁用时不会触发
  }
}

/** 确保当前表有 initialData 条目，供 pre/post SQL 依附（无条目时创建空对象） */
function ensureInitialDataEntry(): InitialData | undefined {
  if (!store.currentSchema || !store.currentTable) return undefined
  let data = initialData.value
  if (!data) {
    const key = store.initialDataKey(store.currentSchema.schema, store.currentTable.name)
    store.initialDataMap.set(key, {})
    data = store.currentInitialData
  }
  return data
}

function handlePreSql(dialect: SqlDialect, val: string) {
  const data = ensureInitialDataEntry()
  if (data) store.setInitialDataPreSql(data, dialect, val)
}

function handlePostSql(dialect: SqlDialect, val: string) {
  const data = ensureInitialDataEntry()
  if (data) store.setInitialDataPostSql(data, dialect, val)
}

function clearPrePostSql() {
  const data = initialData.value
  if (!data) return
  store.setInitialDataPreSql(data, 'mysql', '')
  store.setInitialDataPreSql(data, 'postgresql', '')
  store.setInitialDataPreSql(data, 'sqlite', '')
  store.setInitialDataPostSql(data, 'mysql', '')
  store.setInitialDataPostSql(data, 'postgresql', '')
  store.setInitialDataPostSql(data, 'sqlite', '')
}

function parseJsonInput(text: string): InitialData | null {
  const parsed = JSON.parse(text)
  // 统一归一化为行内结构（兼容纯数组、旧平行数组、行内三种输入）
  return normalizeInitialData(parsed)
}

function onJsonInput(text: string) {
  jsonText.value = text
  try {
    const parsed = parseJsonInput(text)
    if (!parsed) {
      jsonError.value = t('initialData.jsonError.invalidStructure')
      return
    }
    jsonError.value = ''
    if (store.currentSchema && store.currentTable) {
      store.setInitialDataObject(store.currentSchema.schema, store.currentTable.name, parsed)
    }
  } catch (e: any) {
    jsonError.value = e.message || t('initialData.jsonError.invalidSyntax')
  }
}

function switchMode(mode: 'json' | 'table') {
  if (mode === editorMode.value) return

  if (mode === 'table' && editorMode.value === 'json') {
    // JSON -> Table: 先校验
    try {
      const parsed = parseJsonInput(jsonText.value)
      if (!parsed) {
        jsonError.value = t('initialData.jsonError.invalidStructure') + t('initialData.jsonError.fixBeforeSwitch')
        return
      }
      jsonError.value = ''
      // 仅当解析结果包含实际数据时才同步到 store，避免空对象覆盖导致已初始化的条目被误删
      if ((parsed.rows?.length ?? 0) > 0 || parsed.pre_sql || parsed.post_sql) {
        if (store.currentSchema && store.currentTable) {
          store.setInitialDataObject(store.currentSchema.schema, store.currentTable.name, parsed)
        }
      }
    } catch (e: any) {
      jsonError.value = (e.message || t('initialData.jsonError.invalidSyntax')) + t('initialData.jsonError.fixBeforeSwitch')
      return
    }
  }

  if (mode === 'json' && editorMode.value === 'table') {
    syncJsonText()
  }

  editorMode.value = mode
}

/** 创建初始数据条目（仅创建空 JSON 文件，不添加 rows 属性；各板块按需写入） */
function addInitialData() {
  if (!store.currentSchema || !store.currentTable) return
  const key = store.initialDataKey(store.currentSchema.schema, store.currentTable.name)
  store.initialDataMap.set(key, {})
  editorMode.value = 'table'
}

function addRow() {
  if (!store.currentSchema || !store.currentTable || !initialData.value) return
  if (!initialData.value.rows) initialData.value.rows = []
  initialData.value.rows.push({ data: {} })
  syncJsonText()
}

function deleteRow(rowIdx: number) {
  if (!store.currentSchema || !store.currentTable || !initialData.value || !initialData.value.rows) return
  initialData.value.rows.splice(rowIdx, 1)
  if (initialData.value.rows.length === 0) {
    delete initialData.value.rows
  }
}

function moveRowUp(rowIdx: number) {
  const wrapper = initialData.value
  if (!wrapper?.rows || rowIdx <= 0) return
    ;[wrapper.rows[rowIdx - 1], wrapper.rows[rowIdx]] = [wrapper.rows[rowIdx]!, wrapper.rows[rowIdx - 1]!]
}

function moveRowDown(rowIdx: number) {
  const wrapper = initialData.value
  if (!wrapper?.rows || rowIdx >= wrapper.rows.length - 1) return
    ;[wrapper.rows[rowIdx], wrapper.rows[rowIdx + 1]] = [wrapper.rows[rowIdx + 1]!, wrapper.rows[rowIdx]!]
}

async function clearRows() {
  if (!initialData.value) return
  if (!(await confirmDialog({ title: t('confirm.title'), message: t('initialData.clearRowsConfirm'), confirmText: t('confirm.ok'), cancelText: t('confirm.cancel') }))) return
  delete initialData.value.rows
  syncJsonText()
}

async function clearAllData() {
  if (!store.currentSchema || !store.currentTable) return
  if (!(await confirmDialog({ title: t('confirm.title'), message: t('initialData.clearConfirm'), confirmText: t('confirm.ok'), cancelText: t('confirm.cancel') }))) return
  store.deleteInitialData(store.currentSchema.schema, store.currentTable.name)
  jsonText.value = '{}'
  jsonError.value = ''
  editorMode.value = 'table'
}

function getCellValue(row: InitialDataRow, fieldName: string): string {
  const val = row.data[fieldName]
  if (val === undefined || val === null) return ''
  return String(val)
}

function setCellValue(row: InitialDataRow, fieldName: string, val: string) {
  if (!store.currentSchema || !store.currentTable) return
  const parsed = val === '' ? undefined : parseDefaultInput(val)
  store.setInitialDataCell(
    store.currentSchema.schema,
    store.currentTable.name,
    row,
    fieldName,
    parsed as string,
  )
}

// ===== Row Comment =====
function getRowComment(row: InitialDataRow): string {
  return row.row_comment ?? ''
}

function setRowComment(row: InitialDataRow, val: string) {
  if (!store.currentSchema || !store.currentTable) return
  store.setInitialDataRowComment(store.currentSchema.schema, store.currentTable.name, row, val)
}

// ===== Row Skip (不生成该行 INSERT) =====
function isSkipRow(row: InitialDataRow): boolean {
  return row.is_skip === true
}

function setSkipRow(row: InitialDataRow, checked: boolean) {
  if (!store.currentSchema || !store.currentTable) return
  store.setInitialDataRowSkip(store.currentSchema.schema, store.currentTable.name, row, checked)
}

// ===== Field Comment =====
function getFieldComment(row: InitialDataRow, fieldName: string): string {
  return row.field_comments?.[fieldName] ?? ''
}

function setFieldComment(row: InitialDataRow, fieldName: string, val: string) {
  if (!store.currentSchema || !store.currentTable) return
  store.setInitialDataFieldComment(store.currentSchema.schema, store.currentTable.name, row, fieldName, val)
}
</script>

<template>
  <!-- 无初始数据：显示添加提示（数据板块和 pre/post SQL 板块均隐藏） -->
  <div v-if="initialData === undefined && store.currentTable" class="empty-state">
    <span>{{ $t('initialData.empty') }}</span>
    <button class="btn btn-sm btn-primary" @click="addInitialData">{{ $t('initialData.init') }}</button>
  </div>

  <!-- 有初始数据：显示数据板块 + pre/post SQL 板块 -->
  <template v-if="initialData !== undefined">
    <div class="section-card">
      <div class="section-header">
        <span>{{ $t('initialData.title') }}</span>
        <span class="badge" v-if="hasData">{{ $t('initialData.badge', { n: rowCount }) }}</span>
        <div class="header-actions">
          <div class="mode-toggle">
            <button class="mode-btn" :class="{ active: editorMode === 'table' }" @click="switchMode('table')">{{
              $t('initialData.table') }}</button>
            <button class="mode-btn" :class="{ active: editorMode === 'json' }" @click="switchMode('json')">{{
              $t('initialData.json') }}</button>
          </div>
          <button class="btn btn-sm btn-danger" @click="clearRows">{{ $t('initialData.clear') }}</button>
        </div>
      </div>
      <div class="section-body" style="padding: 0;">
        <!-- rows 未配置：在数据板块内显示“添加数据” -->
        <div v-if="rows === undefined" class="empty-state">
          <span>{{ $t('initialData.empty') }}</span>
          <button class="btn btn-sm btn-primary" @click="addRow">{{ $t('initialData.addData') }}</button>
        </div>

        <!-- JSON 编辑模式 -->
        <template v-else-if="editorMode === 'json'">
          <div class="json-toolbar">
            <button class="btn btn-sm" :disabled="!isJsonValid" @click="formatJson">
              {{ $t('initialData.formatJson') }}
            </button>
          </div>
          <textarea class="json-editor" :value="jsonText"
            @input="onJsonInput(($event.target as HTMLTextAreaElement).value)" spellcheck="false"></textarea>
          <div v-if="jsonError" class="json-error">{{ jsonError }}</div>
        </template>

        <!-- Table 编辑模式 -->
        <template v-else>
          <div class="table-toolbar">
            <button class="btn btn-sm btn-primary" @click="addRow">{{ $t('initialData.addRow') }}</button>
          </div>
          <div style="overflow-x: auto;">
            <table class="data-table" v-if="rows.length > 0">
              <thead>
                <tr>
                  <th style="width:36px;">{{ $t('initialData.hash') }}</th>
                  <th v-for="fname in fieldNames" :key="fname">{{ fname }}</th>
                  <th style="width:130px;">{{ $t('initialData.comment') }}</th>
                  <th style="width:80px;">{{ $t('initialData.skipRow') }}<span class="quote-help-icon" :title="$t('initialData.skipRowTitle')">?</span></th>
                  <th style="width:110px;">{{ $t('initialData.actions') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, rIdx) in rows" :key="rIdx">
                  <td class="row-num">{{ rIdx + 1 }}</td>
                  <td v-for="fname in fieldNames" :key="fname" class="cell-stack">
                    <input class="table-input" :value="getCellValue(row, fname)"
                      @change="setCellValue(row, fname, ($event.target as HTMLInputElement).value)"
                      :placeholder="fname" />
                    <input class="field-comment-input" :value="getFieldComment(row, fname)"
                      @change="setFieldComment(row, fname, ($event.target as HTMLInputElement).value)"
                      placeholder="" />
                  </td>
                  <td>
                    <input class="comment-input" :value="getRowComment(row)"
                      @change="setRowComment(row, ($event.target as HTMLInputElement).value)"
                      :placeholder="$t('initialData.rowCommentPlaceholder')" />
                  </td>
                  <td class="row-skip">
                    <input type="checkbox" class="skip-checkbox"
                      :checked="isSkipRow(row)"
                      @change="setSkipRow(row, ($event.target as HTMLInputElement).checked)" />
                  </td>
                  <td>
                    <div class="move-btns" style="display:inline-flex; margin-right:2px;">
                      <button class="move-btn" @click="moveRowUp(rIdx)" :disabled="rIdx === 0">↑</button>
                      <button class="move-btn" @click="moveRowDown(rIdx)" :disabled="rIdx === rows.length - 1">
                        ↓
                      </button>
                    </div>
                    <button class="btn btn-sm btn-danger" @click="deleteRow(rIdx)">&times;</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else class="empty-rows">
              {{ $t('initialData.emptyRows') }}
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Initial Data Pre/Post SQL -->
    <PrePostSqlEditor v-if="store.currentTable" :title="$t('initialData.prePostSql')"
      :pre-placeholder="$t('initialData.preSqlPlaceholder')" :post-placeholder="$t('initialData.postSqlPlaceholder')"
      :mysql-pre="getInitialDataPreSql(initialData, 'mysql')" :mysql-post="getInitialDataPostSql(initialData, 'mysql')"
      :postgresql-pre="getInitialDataPreSql(initialData, 'postgresql')" :postgresql-post="getInitialDataPostSql(initialData, 'postgresql')"
      :sqlite-pre="getInitialDataPreSql(initialData, 'sqlite')" :sqlite-post="getInitialDataPostSql(initialData, 'sqlite')"
      :rows="3" @update:mysql-pre="handlePreSql('mysql', $event)" @update:mysql-post="handlePostSql('mysql', $event)"
      @update:postgresql-pre="handlePreSql('postgresql', $event)" @update:postgresql-post="handlePostSql('postgresql', $event)"
      @update:sqlite-pre="handlePreSql('sqlite', $event)" @update:sqlite-post="handlePostSql('sqlite', $event)">
      <template #header-actions>
        <button class="btn btn-sm btn-danger" @click="clearPrePostSql">{{ $t('initialData.clear') }}</button>
      </template>
    </PrePostSqlEditor>

    <!-- Initial Data SQL Preview -->
    <InitialDataSqlPreview />

    <div class="empty-state">
      <button class="btn btn-sm btn-danger" @click="clearAllData">{{ $t('initialData.clearAll') }}</button>
    </div>
  </template>
</template>

<style scoped src="@/assets/style/section.css"></style>
<style scoped src="@/assets/style/table.css"></style>
<style scoped src="@/assets/style/btn.css"></style>
<style scoped src="@/assets/style/help.css"></style>
<style scoped src="@/assets/style/move-btn.css"></style>
<style scoped>
.section-header {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border-muted);
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
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.mode-btn {
  padding: 3px 10px;
  border: none;
  background: #fff;
  font-size: 11px;
  cursor: pointer;
  color: var(--code-thumb);
  transition: all .15s;
}

.mode-btn:not(:last-child) {
  border-right: 1px solid var(--border);
}

.mode-btn.active {
  background: var(--accent);
  color: #fff;
}

.mode-btn:not(.active):hover {
  background: var(--surface-3);
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
.json-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: var(--code-bg-2);
}

.json-editor {
  width: 100%;
  min-height: 150px;
  max-height: 500px;
  padding: 14px 16px;
  border: none;
  background: var(--code-bg);
  color: var(--code-fg);
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.65;
  resize: vertical;
  box-sizing: border-box;
}

.json-editor:focus {
  outline: none;
}

.json-error {
  padding: 8px 14px;
  background: var(--danger-subtle);
  color: var(--danger);
  font-size: 11px;
  border-top: 1px solid var(--danger-border);
}

/* Table Editor */
.table-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-muted);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.data-table th,
.data-table td {
  padding: 4px 6px;
  border-bottom: 1px solid var(--border-muted);
  text-align: left;
  vertical-align: top;
}

.data-table th {
  background: var(--surface-2);
  font-weight: 600;
  color: var(--code-thumb);
  font-size: 11px;
  white-space: nowrap;
}

.data-table tbody tr:hover {
  background: var(--surface-2);
}

.row-num {
  text-align: center;
  color: #aaa;
  font-size: 10px;
  vertical-align: middle !important;
}

/* Row Skip (启用列) */
.row-skip {
  text-align: center;
  vertical-align: middle !important;
}

.skip-checkbox {
  cursor: pointer;
}

.table-input {
  padding: 3px 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-family: inherit;
  width: 100%;
  min-width: 60px;
  box-sizing: border-box;
}

.table-input:focus {
  outline: none;
  border-color: var(--accent);
}

.empty-rows {
  padding: 14px;
  color: #aaa;
  font-size: 12px;
  text-align: center;
}

/* Stacked cell: value + field comment */
.cell-stack {
  padding: 2px 4px;
}

.cell-stack .table-input {
  margin-bottom: 2px;
}

/* Row Comment */
.comment-input {
  padding: 3px 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-family: inherit;
  width: 100%;
  min-width: 110px;
  box-sizing: border-box;
  background: var(--accent-subtle);
  color: #556;
}

.comment-input:focus {
  outline: none;
  border-color: var(--accent);
  background: #fff;
}

/* Field Comment (inside cell, below value) */
.field-comment-input {
  padding: 1px 5px;
  border: 1px solid transparent;
  border-radius: 2px;
  font-size: 10px;
  font-style: italic;
  font-family: inherit;
  width: 100%;
  min-width: 60px;
  box-sizing: border-box;
  background: transparent;
  color: #999;
  transition: border-color .15s, background .15s;
}

.field-comment-input:hover,
.field-comment-input:focus {
  border-color: var(--border);
  background: var(--surface-2);
  outline: none;
  color: #666;
}

.field-comment-input::placeholder {
  color: var(--border);
}

/* Buttons */
.btn {
  padding: 4px 10px;
  border: 1px solid var(--border);
  background: #fff;
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}

.btn:hover {
  background: var(--surface-2);
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn:disabled:hover {
  background: #fff;
}

.btn-primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-danger {
  color: var(--danger);
  border-color: var(--danger);
}

.btn-danger:hover {
  background: var(--danger-subtle);
}

.btn-sm {
  padding: 2px 6px;
  font-size: 11px;
}

/* Move Buttons */
</style>
