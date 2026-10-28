<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import { parseDefaultInput } from 'schema-editor-core/utils/file-helpers'
import { normalizeInitialData } from 'schema-editor-core/utils/initial-data-io'
import { getInitialDataPreSql, getInitialDataPostSql, isStringTypeField, type SqlDialect } from 'schema-editor-core/utils/sql-generator/shared'
import { confirmDialog } from '@/composables/useConfirm'
import type { InitialData, InitialDataInsertMode, InitialDataRow } from 'schema-editor-core/types/schema'
import PrePostSqlEditor from '@/components/common/PrePostSqlEditor.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import SegmentedSwitch from '@/components/ui/SegmentedSwitch.vue'
import InitialDataSqlPreview from './InitialDataSqlPreview.vue'

const store = useEditorStore()
const { t } = useI18n()

const insertModeLabelKeys: Record<InitialDataInsertMode, string> = {
  insert: 'initialData.insertModeInsertShort',
  ignore: 'initialData.insertModeIgnoreShort',
  overwrite: 'initialData.insertModeOverwriteShort',
}

const editorMode = ref<'json' | 'table'>('table')
const jsonText = ref('')
const jsonError = ref('')

// Field names of the current table (used for column headers in table mode)
const fieldNames = computed(() => {
  if (!store.currentTable) return []
  return store.currentTable.fields
    .filter(f => !f.is_commented_out)
    .map(f => f.field_name)
})

// Set of string-type field names (only these fields show the "expression" checkbox)
const stringFieldSet = computed(() => {
  if (!store.currentTable) return new Set<string>()
  return new Set(
    store.currentTable.fields
      .filter(f => !f.is_commented_out)
      .filter(f => isStringTypeField(f, store.commonConfig))
      .map(f => f.field_name)
  )
})

// Current initial data (wrapper)
const initialData = computed(() => store.currentInitialData)
const rows = computed(() => initialData.value?.rows)

// Table-level INSERT generation mode; inherit means follow the project default
const insertMode = computed(() => initialData.value?.insert_mode ?? 'inherit')
const globalInsertMode = computed<InitialDataInsertMode>(() => store.commonConfig?.initial_data_insert_mode ?? 'insert')
const globalInsertModeLabel = computed(() => t(insertModeLabelKeys[globalInsertMode.value]))

const insertModeOptions = computed(() => [
  { value: 'inherit', label: t('initialData.insertModeInherit', { mode: globalInsertModeLabel.value }) },
  { value: 'insert', label: t('initialData.insertModeInsert') },
  { value: 'ignore', label: t('initialData.insertModeIgnore') },
  { value: 'overwrite', label: t('initialData.insertModeOverwrite') },
])

const hasData = computed(() => rows.value !== undefined && rows.value.length > 0)
const rowCount = computed(() => rows.value?.length ?? 0)

/** Whether the JSON text is valid JSON (syntactically valid) */
const isJsonValid = computed(() => {
  try {
    JSON.parse(jsonText.value)
    return true
  } catch {
    return false
  }
})

// Watch current table switches and re-sync the JSON text
watch(() => store.currentInitialDataKey, () => {
  syncJsonText()
  jsonError.value = ''
}, { immediate: true })

// Sync rows and pre/post SQL; watching and switching are read-only and never implicitly create data or commands.
watch(() => initialData.value, () => {
  if (editorMode.value === 'table') {
    syncJsonText()
  }
}, { deep: true })

function syncJsonText() {
  const wrapper = initialData.value
  if (wrapper && (wrapper.rows?.length || wrapper.insert_mode || wrapper.pre_sql || wrapper.post_sql)) {
    jsonText.value = JSON.stringify(wrapper, null, 4)
  } else {
    jsonText.value = '{}'
  }
}

/** Format the JSON text (4-space indent) */
function formatJson() {
  try {
    const parsed = JSON.parse(jsonText.value)
    jsonText.value = JSON.stringify(parsed, null, 4)
    jsonError.value = ''
    // Sync to the store after formatting
    const result = parseJsonInput(jsonText.value)
    if (result && store.currentSchema && store.currentTable) {
      store.setInitialDataObject(store.currentSchema.schema, store.currentTable.name, result)
    }
  } catch {
    // Unreachable: not triggered while the button is disabled
  }
}

function handleInsertMode(value: string) {
  if (!store.currentSchema || !store.currentTable) return
  const mode = value === 'insert' || value === 'ignore' || value === 'overwrite' ? value : undefined
  store.setInitialDataInsertMode(store.currentSchema.schema, store.currentTable.name, mode)
}

function handlePreSql(dialect: SqlDialect, val: string) {
  if (!store.currentSchema || !store.currentTable) return
  store.setInitialDataPreSql(store.currentSchema.schema, store.currentTable.name, dialect, val)
}

function handlePostSql(dialect: SqlDialect, val: string) {
  if (!store.currentSchema || !store.currentTable) return
  store.setInitialDataPostSql(store.currentSchema.schema, store.currentTable.name, dialect, val)
}

function clearPrePostSql() {
  if (!store.currentSchema || !store.currentTable) return
  store.clearInitialDataPrePostSql(store.currentSchema.schema, store.currentTable.name)
}

function parseJsonInput(text: string): InitialData | null {
  const parsed = JSON.parse(text)
  // Normalize uniformly to the inline row structure (supports plain arrays, legacy parallel arrays, and inline input)
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
  } catch (e: unknown) {
    jsonError.value = (e instanceof Error && e.message) || t('initialData.jsonError.invalidSyntax')
  }
}

function switchMode(mode: 'json' | 'table') {
  if (mode === editorMode.value) return

  if (mode === 'table' && editorMode.value === 'json') {
    // JSON -> Table: validate first
    try {
      const parsed = parseJsonInput(jsonText.value)
      if (!parsed) {
        jsonError.value = t('initialData.jsonError.invalidStructure') + t('initialData.jsonError.fixBeforeSwitch')
        return
      }
      // Edits are already written by onJsonInput; switching modes only validates and does not duplicate history.
      jsonError.value = ''
    } catch (e: unknown) {
      jsonError.value = ((e instanceof Error && e.message) || t('initialData.jsonError.invalidSyntax')) + t('initialData.jsonError.fixBeforeSwitch')
      return
    }
  }

  if (mode === 'json' && editorMode.value === 'table') {
    syncJsonText()
  }

  editorMode.value = mode
}

/** Explicitly create an empty JSON file without adding a rows property. */
function addInitialData() {
  if (!store.currentSchema || !store.currentTable) return
  store.addInitialData(store.currentSchema.schema, store.currentTable.name)
  editorMode.value = 'table'
}

function addRow() {
  if (!store.currentSchema || !store.currentTable) return
  store.addInitialDataRow(store.currentSchema.schema, store.currentTable.name)
  syncJsonText()
}

function deleteRow(rowIdx: number) {
  if (!store.currentSchema || !store.currentTable) return
  store.deleteInitialDataRow(store.currentSchema.schema, store.currentTable.name, rowIdx)
}

function moveRowUp(rowIdx: number) {
  if (!store.currentSchema || !store.currentTable) return
  store.moveInitialDataRow(store.currentSchema.schema, store.currentTable.name, rowIdx, rowIdx - 1)
}

function moveRowDown(rowIdx: number) {
  if (!store.currentSchema || !store.currentTable) return
  store.moveInitialDataRow(store.currentSchema.schema, store.currentTable.name, rowIdx, rowIdx + 1)
}

async function clearRows() {
  const schema = store.currentSchema?.schema
  const table = store.currentTable?.name
  if (!initialData.value || schema === undefined || table === undefined) return
  if (!(await confirmDialog({ title: t('confirm.title'), message: t('initialData.clearRowsConfirm'), confirmText: t('confirm.ok'), cancelText: t('confirm.cancel') }))) return
  store.clearInitialDataRows(schema, table)
  syncJsonText()
}

async function clearAllData() {
  const schema = store.currentSchema?.schema
  const table = store.currentTable?.name
  if (schema === undefined || table === undefined) return
  if (!(await confirmDialog({ title: t('confirm.title'), message: t('initialData.clearConfirm'), confirmText: t('confirm.ok'), cancelText: t('confirm.cancel') }))) return
  store.deleteInitialData(schema, table)
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
    parsed,
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

// ===== Row Skip (this row's INSERT is not generated) =====
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

// ===== Field Expression (value output verbatim as a SQL expression, unquoted) =====
function isExprField(row: InitialDataRow, fieldName: string): boolean {
  return row.expr_fields?.[fieldName] === true
}

function setExprField(row: InitialDataRow, fieldName: string, checked: boolean) {
  if (!store.currentSchema || !store.currentTable) return
  store.setInitialDataCellExpr(store.currentSchema.schema, store.currentTable.name, row, fieldName, checked)
}
</script>

<template>
  <!-- No initial data: show the add prompt (data section and pre/post SQL section are both hidden) -->
  <div v-if="initialData === undefined && store.currentTable" class="empty-state">
    <span>{{ $t('initialData.empty') }}</span>
    <button class="btn btn-sm btn-primary" @click="addInitialData">{{ $t('initialData.init') }}</button>
  </div>

  <!-- Initial data exists: show the data section + pre/post SQL section -->
  <template v-if="initialData !== undefined">
    <div class="section-card">
      <div class="section-header">
        <span class="section-title">
          {{ $t('initialData.title') }}
          <span class="badge" v-if="hasData">{{ $t('initialData.badge', { n: rowCount }) }}</span>
        </span>
        <div class="header-actions">
          <label class="insert-mode" :title="$t('initialData.insertModeTitle')">
            <span>{{ $t('initialData.insertMode') }}</span>
            <AppSelect
              class="insert-mode-select"
              size="sm"
              :model-value="insertMode"
              :options="insertModeOptions"
              @update:model-value="handleInsertMode"
            />
          </label>
          <SegmentedSwitch
            :model-value="editorMode"
            :options="[
              { value: 'table', label: $t('initialData.table') },
              { value: 'json', label: $t('initialData.json') },
            ]"
            @update:model-value="switchMode($event as 'json' | 'table')"
          />
          <button class="btn btn-sm btn-danger" @click="clearRows">{{ $t('initialData.clear') }}</button>
        </div>
      </div>
      <div class="section-body" style="padding: 0;">
        <!-- rows not configured: show "add data" inside the data section -->
        <div v-if="rows === undefined" class="empty-state">
          <span>{{ $t('initialData.empty') }}</span>
          <button class="btn btn-sm btn-primary" @click="addRow">{{ $t('initialData.addData') }}</button>
        </div>

        <!-- JSON edit mode -->
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

        <!-- Table edit mode -->
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
                    <label v-if="stringFieldSet.has(fname)" class="expr-toggle"
                      :class="{ active: isExprField(row, fname) }" :title="$t('initialData.exprTitle')">
                      <input type="checkbox" class="checkbox checkbox-xs"
                        :checked="isExprField(row, fname)"
                        @change="setExprField(row, fname, ($event.target as HTMLInputElement).checked)" />
                      <span>{{ $t('initialData.expr') }}</span>
                    </label>
                  </td>
                  <td>
                    <input class="comment-input" :value="getRowComment(row)"
                      @change="setRowComment(row, ($event.target as HTMLInputElement).value)"
                      :placeholder="$t('initialData.rowCommentPlaceholder')" />
                  </td>
                  <td class="row-skip">
                    <input type="checkbox" class="checkbox checkbox-sm"
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

<style scoped>
.insert-mode {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 400;
  color: var(--fg-muted);
  cursor: pointer;
  white-space: nowrap;
}

.insert-mode-select {
  min-width: 128px;
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
  border-collapse: collapse;
}

/* Data cells stack value + field comment + expression toggle, so they align from the top */
.data-table th,
.data-table td {
  padding: var(--pad-cell-y) 6px;
  vertical-align: top;
}

.row-num {
  text-align: center;
  color: var(--fg-subtle);
  font-size: 10px;
  vertical-align: middle !important;
}

/* Row Skip (enable column) */
.row-skip {
  text-align: center;
  vertical-align: middle !important;
}

.empty-rows {
  padding: 14px;
  color: var(--fg-subtle);
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
  color: var(--fg);
}

.comment-input:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--surface);
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
  color: var(--fg-subtle);
  transition: border-color .15s, background .15s;
}

.field-comment-input:hover,
.field-comment-input:focus {
  border-color: var(--border);
  background: var(--surface-2);
  outline: none;
  color: var(--fg-muted);
}

.field-comment-input::placeholder {
  color: var(--border);
}

/* Field Expression toggle (only shown for string-type fields) */
.expr-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 3px;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 10px;
  color: var(--fg-subtle);
  cursor: pointer;
  user-select: none;
  transition: all .15s;
}

.expr-toggle:hover {
  border-color: var(--accent);
  color: var(--fg-muted);
}

.expr-toggle.active {
  background: var(--accent-subtle);
  border-color: var(--accent);
  color: var(--accent);
}
</style>
