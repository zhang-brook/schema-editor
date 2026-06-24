<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
const { t } = useI18n()

// 行号
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const lineNumbersRef = ref<HTMLElement | null>(null)

const lineCount = computed(() => {
  const text = store.importSqlText
  if (!text) return 1
  return text.split('\n').length
})

function syncLineNumbersScroll() {
  if (textareaRef.value && lineNumbersRef.value) {
    lineNumbersRef.value.scrollTop = textareaRef.value.scrollTop
  }
}

// 防抖解析
let parseTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => store.importSqlText,
  () => {
    if (parseTimer) clearTimeout(parseTimer)
    parseTimer = setTimeout(() => store.parseImportSql(), 500)
  },
)

// 预览摘要
const parsedSummary = computed(() => {
  const tables = store.importSqlParsedTables
  if (tables.length === 0) return null
  const totalFields = tables.reduce((s, tbl) => s + tbl.columns.length, 0)
  const totalConstraints = tables.reduce((s, tbl) => s + tbl.constraints.length, 0)
  return { tableCount: tables.length, fieldCount: totalFields, constraintCount: totalConstraints }
})

// Schema 列表（用于目标选择）
const schemaOptions = computed(() => {
  return store.schemas.map((s, i) => ({ name: s.schema, index: i }))
})

// 展开/折叠表预览
const expandedTables = ref(new Set<number>())
function toggleTableExpand(idx: number) {
  if (expandedTables.value.has(idx)) {
    expandedTables.value.delete(idx)
  } else {
    expandedTables.value.add(idx)
  }
}

// 方言选项
const dialectOptions = [
  { value: 'auto' as const, label: 'auto' },
  { value: 'mysql' as const, label: 'MySQL' },
  { value: 'pgsql' as const, label: 'PostgreSQL' },
]

// 格式化列类型显示
function formatColType(col: import('@/utils/sql-parser').ParsedColumn): string {
  let display = col.rawType
  if (col.length != null) {
    display += `(${col.length}`
    if (col.scale != null) {
      display += `,${col.scale}`
    }
    display += ')'
  }
  const flags: string[] = []
  if (col.primaryKey) flags.push('PK')
  if (col.notNull) flags.push('NN')
  if (col.autoIncrement) flags.push('AI')
  if (col.unique) flags.push('UQ')
  if (flags.length > 0) display += ' ' + flags.join(' ')
  return display
}

function formatConstraintType(type: string): string {
  const map: Record<string, string> = {
    PRIMARY_KEY: 'PRIMARY KEY',
    UNIQUE: 'UNIQUE',
    INDEX: 'INDEX',
    FULLTEXT: 'FULLTEXT',
    SPATIAL: 'SPATIAL',
  }
  return map[type] || type
}

// 错误和警告分类
const errors = computed(() => store.importSqlErrors.filter(e => e.type === 'error'))
const warnings = computed(() => store.importSqlErrors.filter(e => e.type === 'warning'))

// SQL 中检测到的 schema 提示
const detectedSchemaHint = computed(() => {
  const schema = store.importSqlDetectedSchema
  if (!schema) return null
  const matched = store.schemas.some(s => s.schema === schema)
  return { schema, matched }
})
</script>

<template>
  <div class="modal-overlay" v-if="store.showImportSqlModal" @click.self="store.showImportSqlModal = false">
    <div class="modal-box modal-lg">
      <h3>{{ $t('importSqlModal.title') }}</h3>

      <!-- 方言选择 -->
      <div class="form-group">
        <label class="form-label">{{ $t('importSqlModal.dialect') }}</label>
        <div class="radio-group">
          <label v-for="opt in dialectOptions" :key="opt.value" class="radio-label">
            <input
              type="radio"
              :value="opt.value"
              v-model="store.importSqlDialect"
              @change="store.parseImportSql()"
            />
            {{ opt.label === 'auto' ? $t('importSqlModal.autoDetect') : opt.label }}
          </label>
        </div>
      </div>

      <!-- SQL 输入区 -->
      <div class="form-group">
        <label class="form-label">{{ $t('importSqlModal.sqlInput') }}</label>
        <div class="sql-input-container">
          <div ref="lineNumbersRef" class="line-numbers" aria-hidden="true">
            <span v-for="n in lineCount" :key="n" class="line-number">{{ n }}</span>
          </div>
          <textarea
            ref="textareaRef"
            class="sql-textarea"
            v-model="store.importSqlText"
            :placeholder="$t('importSqlModal.sqlPlaceholder')"
            spellcheck="false"
            @scroll="syncLineNumbersScroll"
          ></textarea>
        </div>
      </div>

      <!-- 解析错误 -->
      <div v-if="errors.length > 0" class="parse-errors">
        <div v-for="(err, i) in errors" :key="'err-' + i" class="parse-msg parse-msg-error">
          <span v-if="err.line > 0">L{{ err.line }}: </span>{{ err.message }}
        </div>
      </div>

      <!-- 解析警告 -->
      <div v-if="warnings.length > 0" class="parse-warnings">
        <div v-for="(warn, i) in warnings" :key="'warn-' + i" class="parse-msg parse-msg-warning">
          <span v-if="warn.line > 0">L{{ warn.line }}: </span>{{ warn.message }}
        </div>
      </div>

      <!-- 解析结果预览 -->
      <div v-if="parsedSummary" class="preview-section">
        <div class="preview-header">
          <span class="preview-title">{{ $t('importSqlModal.parsedTables') }}</span>
          <span class="preview-summary">
            {{ $t('importSqlModal.summary', { tables: parsedSummary.tableCount, fields: parsedSummary.fieldCount, indexes: parsedSummary.constraintCount }) }}
          </span>
        </div>

        <div class="table-list">
          <div
            v-for="(table, ti) in store.importSqlParsedTables"
            :key="ti"
            class="table-card"
          >
            <div class="table-card-header" @click="toggleTableExpand(ti)">
              <span class="table-card-toggle">{{ expandedTables.has(ti) ? '▾' : '▸' }}</span>
              <span class="table-card-name">{{ table.schema ? table.schema + '.' : '' }}{{ table.name }}</span>
              <span class="table-card-meta">
                {{ table.columns.length }} {{ $t('importSqlModal.fields') }}
                <template v-if="table.constraints.length">
                  , {{ table.constraints.length }} {{ $t('importSqlModal.indexes') }}
                </template>
                <template v-if="table.options.engine">
                  , ENGINE={{ table.options.engine }}
                </template>
                <template v-if="table.options.charset">
                  , CHARSET={{ table.options.charset }}
                </template>
              </span>
            </div>
            <div v-if="expandedTables.has(ti)" class="table-card-body">
              <!-- 字段列表 -->
              <table v-if="table.columns.length > 0" class="preview-table">
                <thead>
                  <tr>
                    <th>{{ $t('importSqlModal.colName') }}</th>
                    <th>{{ $t('importSqlModal.colType') }}</th>
                    <th>{{ $t('importSqlModal.colDefault') }}</th>
                    <th>{{ $t('importSqlModal.colComment') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(col, ci) in table.columns" :key="ci">
                    <td class="col-name">{{ col.name }}</td>
                    <td class="col-type">{{ formatColType(col) }}</td>
                    <td class="col-default">{{ col.defaultValue || '-' }}</td>
                    <td class="col-comment">{{ col.comment || '-' }}</td>
                  </tr>
                </tbody>
              </table>

              <!-- 约束列表 -->
              <div v-if="table.constraints.length > 0" class="constraint-section">
                <span class="constraint-title">{{ $t('importSqlModal.constraints') }}:</span>
                <span
                  v-for="(c, ci) in table.constraints"
                  :key="ci"
                  class="constraint-item"
                >
                  {{ formatConstraintType(c.type) }}
                  <template v-if="c.name">`{{ c.name }}`</template>
                  ({{ c.columns.map(col => col.name + (col.sortOrder ? ' ' + col.sortOrder : '')).join(', ') }})
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 导入目标 -->
      <div v-if="parsedSummary" class="import-target">
        <label class="form-label">{{ $t('importSqlModal.target') }}</label>

        <!-- SQL schema 智能检测提示 -->
        <div v-if="detectedSchemaHint" class="schema-detect-hint">
          <template v-if="detectedSchemaHint.matched">
            {{ $t('importSqlModal.schemaDetectedMatched', { schema: detectedSchemaHint.schema }) }}
          </template>
          <template v-else>
            {{ $t('importSqlModal.schemaDetectedNew', { schema: detectedSchemaHint.schema }) }}
          </template>
        </div>

        <div class="radio-group">
          <label class="radio-label">
            <input type="radio" value="new" v-model="store.importSqlTargetMode" @change="store.importSqlDetectedSchema = null" />
            {{ $t('importSqlModal.newSchema') }}
          </label>
          <label class="radio-label">
            <input type="radio" value="existing" v-model="store.importSqlTargetMode" @change="store.importSqlDetectedSchema = null" />
            {{ $t('importSqlModal.existingSchema') }}
          </label>
        </div>
        <div class="target-input-row">
          <input
            v-if="store.importSqlTargetMode === 'new'"
            class="form-input target-input"
            v-model="store.importSqlNewSchemaName"
            :placeholder="$t('importSqlModal.schemaNamePlaceholder')"
            @input="store.importSqlDetectedSchema = null"
          />
          <select
            v-else
            class="form-input target-input"
            v-model="store.importSqlTargetSchemaIdx"
            @change="store.importSqlDetectedSchema = null"
          >
            <option value="-1" disabled>{{ $t('importSqlModal.selectSchema') }}</option>
            <option v-for="opt in schemaOptions" :key="opt.index" :value="opt.index">
              {{ opt.name }}
            </option>
          </select>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="modal-actions">
        <button class="btn" @click="store.showImportSqlModal = false">
          {{ $t('importSqlModal.cancel') }}
        </button>
        <button
          class="btn btn-primary"
          @click="store.confirmImportSql()"
          :disabled="!parsedSummary || (store.importSqlTargetMode === 'existing' && store.importSqlTargetSchemaIdx < 0)"
        >
          {{ $t('importSqlModal.importBtn') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Modal 基础样式 — 复用项目现有风格 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-box {
  background: #fff;
  border-radius: 8px;
  padding: 20px 24px;
  min-width: 360px;
  max-width: 720px;
  width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
}

.modal-box h3 {
  margin-bottom: 12px;
  font-size: 15px;
  color: #333;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 12px;
}

.form-label {
  font-size: 11px;
  color: #888;
  font-weight: 500;
}

.form-input {
  padding: 5px 8px;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-size: 12px;
  font-family: inherit;
  color: #333;
  transition: border-color .15s;
}

.form-input:focus {
  outline: none;
  border-color: #4a90d9;
}

/* 方言选择器 */
.radio-group {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.radio-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #555;
  cursor: pointer;
}

.radio-label input[type="radio"] {
  margin: 0;
  cursor: pointer;
}

/* SQL 文本框 — 带行号 */
.sql-input-container {
  display: flex;
  border: 1px solid #ccc;
  border-radius: 4px;
  overflow: hidden;
  transition: border-color .15s;
}

.sql-input-container:focus-within {
  border-color: #4a90d9;
}

.line-numbers {
  flex-shrink: 0;
  width: 36px;
  padding: 8px 0;
  background: #f5f5f5;
  border-right: 1px solid #e0e0e0;
  overflow: hidden;
  user-select: none;
  text-align: right;
}

.line-number {
  display: block;
  padding: 0 6px 0 2px;
  font-size: 12px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  line-height: 1.6;
  color: #b0b0b0;
}

.sql-textarea {
  flex: 1;
  padding: 8px 10px;
  border: none;
  border-radius: 0;
  font-size: 12px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  color: #333;
  min-height: 120px;
  max-height: 250px;
  resize: vertical;
  tab-size: 2;
  line-height: 1.6;
  outline: none;
}

.sql-textarea::placeholder {
  color: #bbb;
}

/* 解析消息 */
.parse-errors,
.parse-warnings {
  margin-bottom: 10px;
}

.parse-msg {
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 3px;
  margin-bottom: 3px;
}

.parse-msg-error {
  background: #fff0f0;
  color: #c0392b;
  border: 1px solid #f5c6cb;
}

.parse-msg-warning {
  background: #fffbe6;
  color: #856404;
  border: 1px solid #ffeeba;
}

/* 预览区 */
.preview-section {
  margin-bottom: 14px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  overflow: hidden;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  background: #f7f7f7;
  border-bottom: 1px solid #e0e0e0;
}

.preview-title {
  font-size: 12px;
  font-weight: 600;
  color: #444;
}

.preview-summary {
  font-size: 11px;
  color: #888;
}

/* 表卡片列表 */
.table-list {
  max-height: 260px;
  overflow-y: auto;
}

.table-card {
  border-bottom: 1px solid #eee;
}

.table-card:last-child {
  border-bottom: none;
}

.table-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  transition: background .1s;
}

.table-card-header:hover {
  background: #f0f7ff;
}

.table-card-toggle {
  font-size: 10px;
  color: #999;
  width: 14px;
  flex-shrink: 0;
}

.table-card-name {
  font-size: 13px;
  font-weight: 600;
  color: #2c3e50;
}

.table-card-meta {
  font-size: 10px;
  color: #999;
  margin-left: auto;
}

.table-card-body {
  padding: 6px 10px 8px;
  background: #fafafa;
}

/* 预览表格 */
.preview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  margin-bottom: 6px;
}

.preview-table th {
  text-align: left;
  padding: 3px 6px;
  background: #f0f0f0;
  color: #666;
  font-weight: 500;
  border-bottom: 1px solid #ddd;
}

.preview-table td {
  padding: 2px 6px;
  border-bottom: 1px solid #f0f0f0;
  color: #333;
}

.col-name {
  font-weight: 500;
  color: #2c3e50;
}

.col-type {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 10px;
  color: #555;
}

.col-default {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 10px;
  color: #888;
}

.col-comment {
  color: #888;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 约束 */
.constraint-section {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.constraint-title {
  font-size: 10px;
  color: #999;
  font-weight: 500;
}

.constraint-item {
  font-size: 10px;
  color: #555;
  background: #f0f0f0;
  padding: 1px 5px;
  border-radius: 2px;
  font-family: 'Consolas', 'Monaco', monospace;
}

/* SQL schema 检测提示 */
.schema-detect-hint {
  font-size: 11px;
  color: #4a90d9;
  background: #edf4fc;
  padding: 5px 8px;
  border-radius: 3px;
  margin-bottom: 8px;
  border: 1px solid #c5d9f0;
}

/* 导入目标 */
.import-target {
  margin-bottom: 14px;
}

.target-input-row {
  margin-top: 6px;
}

.target-input {
  width: 100%;
  box-sizing: border-box;
}

/* 操作按钮 */
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  color: #333;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all .15s;
}

.btn:hover {
  background: #e8e8e8;
  border-color: #aaa;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: #4a90d9;
  color: #fff;
  border-color: #4a90d9;
}

.btn-primary:hover:not(:disabled) {
  background: #3a7bc8;
  border-color: #3a7bc8;
}
</style>
