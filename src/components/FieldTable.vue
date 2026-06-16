<script setup lang="ts">
import { ref } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { displayDefault, displayFieldLength, displayFieldScale, parseDefaultInput, parseFieldLengthInput, parseFieldScaleInput } from '@/utils/file-helpers'
import type { Field } from '@/types/schema'

const store = useEditorStore()

function handleFieldNameChange(field: Field, newName: string) {
  const oldName = field.field_name
  const trimmed = newName.trim()
  if (!trimmed || oldName === trimmed) return
  field.field_name = trimmed
  if (store.currentTable) {
    store.syncFieldNameInIndexes(store.currentTable, oldName, trimmed)
  }
}

// ===== Drag-and-drop for Fields =====
const dragFieldIdx = ref(-1)

function onDragStart(e: DragEvent, idx: number) {
  dragFieldIdx.value = idx
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
  const tr = (e.currentTarget as HTMLElement).closest('tr')
  tr?.classList.add('row-dragging')
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  ;(e.currentTarget as HTMLElement)?.classList.add('drag-over-row')
}

function onDragLeave(e: DragEvent) {
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-row')
}

function onDrop(e: DragEvent, toIdx: number) {
  e.preventDefault()
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-row')
  const fromIdx = dragFieldIdx.value
  if (fromIdx < 0 || fromIdx === toIdx || !store.currentTable) return
  const arr = store.currentTable.fields
  const [item] = arr.splice(fromIdx, 1)
  if (item) {
    const insertIdx = toIdx > fromIdx ? toIdx - 1 : toIdx
    arr.splice(insertIdx, 0, item)
  }
  dragFieldIdx.value = -1
}

function onDragEnd(e: DragEvent) {
  const tr = (e.currentTarget as HTMLElement).closest('tr')
  tr?.classList.remove('row-dragging')
  document.querySelectorAll('.drag-over-row, .drag-over-tail').forEach(el => el.classList.remove('drag-over-row', 'drag-over-tail'))
  dragFieldIdx.value = -1
}

/** 选择统一类型时仅清除 field_type，长度和小数位由用户决定是否覆盖 */
function handleUnifiedTypeChange(field: Field, value: string) {
  if (value) {
    field.unified_type = value
    field.field_type = ''
  } else {
    field.unified_type = undefined
  }
}

/** 获取统一类型定义中配置的 placeholder 值（优先取 MySQL 的值） */
function getUnifiedTypePlaceholder(field: Field, key: 'length' | 'scale'): string {
  if (!field.unified_type || !store.commonConfig?.unified_types) return ''
  const def = store.commonConfig.unified_types.find(ut => ut.name === field.unified_type)
  if (!def) return ''
  const val = def.mysql[key]
  return val !== undefined && val !== null ? String(val) : ''
}

function onDropTailOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  ;(e.currentTarget as HTMLElement)?.classList.add('drag-over-tail')
}

function onDropTailLeave(e: DragEvent) {
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-tail')
}

function onDropTail(e: DragEvent) {
  e.preventDefault()
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-tail')
  const fromIdx = dragFieldIdx.value
  if (fromIdx < 0 || !store.currentTable) return
  const arr = store.currentTable.fields
  if (fromIdx === arr.length - 1) return
  const [item] = arr.splice(fromIdx, 1)
  if (item) {
    arr.push(item)
  }
  dragFieldIdx.value = -1
}
</script>

<template>
  <div class="section-card" v-if="store.currentTable">
    <div class="section-header">
      {{ $t('fieldTable.fields') }}
      <span class="badge">{{ $t('fieldTable.badge', { n: store.currentTable.fields.length }) }}</span>
      <div style="margin-left:auto; display:flex; gap:6px;">
        <button class="btn btn-sm btn-primary" @click="store.openAddFieldModal(store.selectedSchemaIdx, store.selectedTableIdx, 'normal')">{{ $t('fieldTable.addField') }}</button>
        <button class="btn btn-sm" @click="store.openAddFieldModal(store.selectedSchemaIdx, store.selectedTableIdx, 'common')" :disabled="!store.commonConfig">{{ $t('fieldTable.addCommonField') }}</button>
      </div>
    </div>
    <div class="section-body" style="padding: 0; overflow-x: auto;">
      <table class="fields-table">
        <thead>
          <tr>
            <th style="width:24px;"></th>
            <th style="width:30px;"></th>
            <th>{{ $t('fieldTable.fieldName') }}</th>
            <th>{{ $t('fieldTable.type') }}</th>
            <th>{{ $t('fieldTable.length') }}</th>
            <th>{{ $t('fieldTable.scale') }}</th>
            <th style="width:40px;">{{ $t('fieldTable.nn') }}</th>
            <th style="width:40px;">{{ $t('fieldTable.pk') }}</th>
            <th>{{ $t('fieldTable.default') }}</th>
            <th style="width:32px;" :title="$t('fieldTable.quoteDefault')">"?"</th>
            <th>{{ $t('fieldTable.comment') }}</th>
            <th style="width:40px;">{{ $t('fieldTable.removed') }}</th>
            <th style="width:90px;">{{ $t('fieldTable.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(field, fIdx) in store.currentTable.fields" :key="field.field_name + fIdx">
            <tr
              :class="{
                'common-field-row': store.isCommonField(field),
                'commented-out-row': store.getResolvedField(field).is_commented_out
              }"
              @dragover="onDragOver"
              @dragleave="onDragLeave"
              @drop="onDrop($event, fIdx)"
            >
              <!-- drag handle -->
              <td
                class="drag-handle-cell"
                draggable="true"
                @dragstart="onDragStart($event, fIdx)"
                @dragend="onDragEnd"
              >
                <span class="drag-handle">⋮⋮</span>
              </td>
              <td>
                <span class="expand-toggle" @click="store.toggleFieldExpand(store.fieldKey(store.currentSchema!, store.currentTable!, field))">
                  {{ store.expandedFields.has(store.fieldKey(store.currentSchema!, store.currentTable!, field)) ? '▼' : '▶' }}
                </span>
              </td>
              <td>
                <div class="field-name-cell">
                  <span v-if="store.isCommonField(field)" class="common-badge">C</span>
                  <span v-if="store.getResolvedField(field).is_commented_out" class="commented-badge">~</span>
                  <input v-if="!store.isCommonField(field)" class="table-input" :value="field.field_name" @change="handleFieldNameChange(field, ($event.target as HTMLInputElement).value)" style="min-width:80px;">
                  <span v-else style="font-weight:500;">{{ field.field_name }}</span>
                </div>
              </td>
              <td>
                <template v-if="store.isCommonField(field)">
                  {{ store.fieldTypeDisplay(field) }}
                </template>
                <div v-else class="type-cell">
                  <select
                    class="table-input unified-type-select"
                    :value="field.unified_type ?? ''"
                    @change="handleUnifiedTypeChange(field, ($event.target as HTMLSelectElement).value)"
                    style="min-width:80px;"
                  >
                    <option value="">{{ $t('fieldTable.customType') }}</option>
                    <option v-for="ut in store.unifiedTypeNames" :key="ut" :value="ut">{{ ut }}</option>
                  </select>
                  <input
                    v-if="!field.unified_type"
                    class="table-input type-free-input"
                    v-model="field.field_type"
                    :placeholder="$t('fieldTable.typePlaceholder')"
                    style="min-width:60px;"
                  />
                </div>
              </td>
              <td>
                <template v-if="store.isCommonField(field)">
                  {{ displayFieldLength(store.getResolvedField(field).field_length) || '-' }}
                </template>
                <div v-else class="field-num-cell">
                  <input
                    v-if="!field.field_length_disabled"
                    class="table-input"
                    :value="displayFieldLength(field.field_length)"
                    :placeholder="getUnifiedTypePlaceholder(field, 'length')"
                    @input="field.field_length = parseFieldLengthInput(($event.target as HTMLInputElement).value)"
                    style="width:38px;"
                  />
                  <span v-else class="disabled-indicator" title="已禁用长度（点击恢复）" @click="field.field_length_disabled = undefined">—</span>
                  <input
                    type="checkbox"
                    class="mini-checkbox"
                    :checked="!!field.field_length_disabled"
                    @change="field.field_length_disabled = ($event.target as HTMLInputElement).checked || undefined"
                    title="不设置长度"
                  />
                </div>
              </td>
              <td>
                <template v-if="store.isCommonField(field)">
                  {{ displayFieldScale(store.getResolvedField(field).field_scale) || '-' }}
                </template>
                <div v-else class="field-num-cell">
                  <input
                    v-if="!field.field_scale_disabled"
                    class="table-input"
                    :value="displayFieldScale(field.field_scale)"
                    :placeholder="getUnifiedTypePlaceholder(field, 'scale')"
                    @input="field.field_scale = parseFieldScaleInput(($event.target as HTMLInputElement).value)"
                    style="width:38px;"
                  />
                  <span v-else class="disabled-indicator" title="已禁用小数位（点击恢复）" @click="field.field_scale_disabled = undefined">—</span>
                  <input
                    type="checkbox"
                    class="mini-checkbox"
                    :checked="!!field.field_scale_disabled"
                    @change="field.field_scale_disabled = ($event.target as HTMLInputElement).checked || undefined"
                    title="不设置小数位"
                  />
                </div>
              </td>
              <td>
                <template v-if="store.isCommonField(field)">
                  {{ store.getResolvedField(field).not_null ? '✓' : '' }}
                </template>
                <input v-else type="checkbox" class="table-checkbox" v-model="field.not_null">
              </td>
              <td>
                <template v-if="store.isCommonField(field)">
                  {{ store.getResolvedField(field).primary_key ? '✓' : '' }}
                </template>
                <input v-else type="checkbox" class="table-checkbox" v-model="field.primary_key">
              </td>
              <td>
                <template v-if="store.isCommonField(field)">
                  {{ displayDefault(store.getResolvedField(field).default) }}
                </template>
                <input v-else class="table-input" :value="displayDefault(field.default)" @input="field.default = parseDefaultInput(($event.target as HTMLInputElement).value)" style="min-width:60px;">
              </td>
              <td style="text-align:center;">
                <template v-if="store.isCommonField(field)">
                  <!-- common field: quote determined by common field definition -->
                </template>
                <template v-else-if="field.unified_type">
                  <!-- unified type: quote determined by type definition, show resolved status -->
                  <span v-if="store.quoteDefaultForField(field)" style="color:#4a90d9; font-size:11px;">✓</span>
                </template>
                <input v-else type="checkbox" class="table-checkbox" v-model="field.quote_default">
              </td>
              <td>
                <template v-if="store.isCommonField(field)">
                  {{ store.getResolvedField(field).comment || '' }}
                </template>
                <input v-else class="table-input" v-model="field.comment" style="min-width:100px;">
              </td>
              <td>
                <template v-if="store.isCommonField(field)">
                  {{ store.getResolvedField(field).is_commented_out ? '✓' : '' }}
                </template>
                <input v-else type="checkbox" class="table-checkbox" v-model="field.is_commented_out">
              </td>
              <td style="min-width: 80px;">
                <div class="move-btns" style="display:inline-flex; margin-right:2px;">
                  <button class="move-btn" @click="store.moveFieldUp(store.currentTable!, fIdx)" :disabled="fIdx === 0">↑</button>
                  <button class="move-btn" @click="store.moveFieldDown(store.currentTable!, fIdx)" :disabled="fIdx === store.currentTable!.fields.length - 1">↓</button>
                </div>
                <button class="btn btn-sm btn-danger" @click="store.deleteField(store.currentTable!, fIdx)">×</button>
              </td>
            </tr>
            <!-- Expanded Field Detail -->
            <tr v-if="store.expandedFields.has(store.fieldKey(store.currentSchema!, store.currentTable!, field))">
              <td colspan="13">
                <div class="field-expand-content">
                  <!-- 解析后类型预览 -->
                  <div class="expand-section" v-if="!store.isCommonField(field)">
                    <div class="expand-section-title">{{ $t('fieldTable.resolvedTypes') }}</div>
                    <div class="resolved-type-row">
                      <span class="db-label">MySQL:</span>
                      <code>{{ store.getResolvedFieldTypeForDb(field, 'mysql') }}</code>
                      <span class="db-label" style="margin-left:16px;">PostgreSQL:</span>
                      <code>{{ store.getResolvedFieldTypeForDb(field, 'pgsql') }}</code>
                    </div>
                  </div>
                  <!-- MySQL/PGSQL Override -->
                  <div class="expand-section" v-if="!store.isCommonField(field)">
                    <div class="expand-section-title">{{ $t('fieldTable.dbOverrides') }}</div>
                    <div class="db-override-grid">
                      <div class="db-override-group">
                        <div class="db-label">{{ $t('fieldTable.mysql') }}</div>
                        <input class="form-input" placeholder="field_type" :value="store.getFieldOverrideValue(field, 'mysql', 'field_type')" @input="store.setFieldOverrideValue(field, 'mysql', 'field_type', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="field_length" :value="store.getFieldOverrideValue(field, 'mysql', 'field_length')" @input="store.setFieldOverrideValue(field, 'mysql', 'field_length', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="field_scale" :value="store.getFieldOverrideValue(field, 'mysql', 'field_scale')" @input="store.setFieldOverrideValue(field, 'mysql', 'field_scale', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="default" :value="store.getFieldOverrideValue(field, 'mysql', 'default')" @input="store.setFieldOverrideValue(field, 'mysql', 'default', ($event.target as HTMLInputElement).value)">
                      </div>
                      <div class="db-override-group">
                        <div class="db-label">{{ $t('fieldTable.postgresql') }}</div>
                        <input class="form-input" placeholder="field_type" :value="store.getFieldOverrideValue(field, 'pgsql', 'field_type')" @input="store.setFieldOverrideValue(field, 'pgsql', 'field_type', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="field_length" :value="store.getFieldOverrideValue(field, 'pgsql', 'field_length')" @input="store.setFieldOverrideValue(field, 'pgsql', 'field_length', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="field_scale" :value="store.getFieldOverrideValue(field, 'pgsql', 'field_scale')" @input="store.setFieldOverrideValue(field, 'pgsql', 'field_scale', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="default" :value="store.getFieldOverrideValue(field, 'pgsql', 'default')" @input="store.setFieldOverrideValue(field, 'pgsql', 'default', ($event.target as HTMLInputElement).value)">
                      </div>
                    </div>
                  </div>
                  <!-- Comment Before Field -->
                  <div class="expand-section">
                    <div class="expand-section-title">{{ $t('fieldTable.commentBeforeField') }}</div>
                    <textarea class="field-comment-editor"
                              :value="store.commentBeforeFieldText(store.currentTable!, field.field_name)"
                              @input="store.setCommentBeforeField(store.currentTable!, field.field_name, ($event.target as HTMLTextAreaElement).value)"
                              rows="2"
                              :placeholder="$t('fieldTable.commentPlaceholder')"></textarea>
                  </div>
                </div>
              </td>
            </tr>
          </template>
          <!-- 尾部 drop 区域 -->
          <tr
            v-if="store.currentTable.fields.length > 0"
            class="drop-tail-row"
            @dragover="onDropTailOver"
            @dragleave="onDropTailLeave"
            @drop="onDropTail"
          >
            <td :colspan="13"></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.fields-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.fields-table th,
.fields-table td {
  padding: 6px 8px;
  border-bottom: 1px solid #eee;
  text-align: left;
  vertical-align: middle;
}

.fields-table th {
  background: #f8f8f8;
  font-weight: 600;
  color: #555;
  font-size: 11px;
  white-space: nowrap;
}

.fields-table tbody tr:hover {
  background: #f5f5f5;
}

.common-field-row {
  background: #e8f0fe !important;
}

.common-field-row:hover {
  background: #d8e4f8 !important;
}

.commented-out-row {
  background: #f0f0f0 !important;
  text-decoration: line-through;
  color: #999;
}

.commented-out-row:hover {
  background: #e8e8e8 !important;
}

.expand-toggle {
  cursor: pointer;
  font-size: 10px;
  color: #888;
  user-select: none;
}

.field-name-cell {
  display: flex;
  align-items: center;
  gap: 4px;
}

.common-badge {
  display: inline-block;
  background: #4a90d9;
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  line-height: 1;
}

.commented-badge {
  display: inline-block;
  background: #999;
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  line-height: 1;
}

.table-input {
  padding: 3px 5px;
  border: 1px solid #ddd;
  border-radius: 3px;
  font-size: 12px;
  font-family: inherit;
  width: 100%;
  box-sizing: border-box;
}

.table-input:focus {
  outline: none;
  border-color: #4a90d9;
}

.table-checkbox {
  width: 14px;
  height: 14px;
  cursor: pointer;
}

.move-btns {
  display: inline-flex;
}

.move-btn {
  padding: 2px 5px;
  font-size: 10px;
  border: 1px solid #ccc;
  background: #fff;
  cursor: pointer;
  border-radius: 2px;
  margin-right: 2px;
}

.move-btn:hover:not(:disabled) {
  background: #f0f0f0;
}

.move-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

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

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

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
  justify-content: space-between;
  padding: 10px 14px;
  background: #fafafa;
  border-bottom: 1px solid #eee;
  font-weight: 600;
  font-size: 13px;
  color: #444;
}

.section-header .badge {
  font-weight: 400;
  font-size: 11px;
  color: #888;
  margin-left: 8px;
}

.section-body {
  padding: 14px;
}

.field-expand-content {
  padding: 10px 14px;
  background: #fafafa;
  border-top: 1px solid #eee;
}

.expand-section {
  margin-bottom: 12px;
}

.expand-section:last-child {
  margin-bottom: 0;
}

.expand-section-title {
  font-size: 11px;
  font-weight: 600;
  color: #666;
  margin-bottom: 6px;
}

.db-override-grid {
  display: flex;
  gap: 16px;
}

.db-override-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.db-label {
  font-size: 10px;
  font-weight: 600;
  color: #888;
  text-transform: uppercase;
  margin-bottom: 2px;
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

.field-comment-editor {
  width: 100%;
  min-height: 40px;
  padding: 5px 8px;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-size: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  line-height: 1.5;
  resize: vertical;
  box-sizing: border-box;
}

.field-comment-editor:focus {
  outline: none;
  border-color: #4a90d9;
}

/* Type cell with unified type select + custom input */
.type-cell {
  display: flex;
  gap: 4px;
  align-items: center;
}

.unified-type-select {
  max-width: 100px;
}

.type-free-input {
  max-width: 70px;
}

.resolved-length {
  color: #666;
  font-size: 12px;
}

.field-num-cell {
  display: flex;
  align-items: center;
  gap: 2px;
}

.mini-checkbox {
  width: 12px;
  height: 12px;
  cursor: pointer;
  flex-shrink: 0;
}

.disabled-indicator {
  color: #999;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}

.disabled-indicator:hover {
  color: #4a90d9;
}

.resolved-type-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.resolved-type-row code {
  background: #e8f0fe;
  color: #333;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-family: 'Consolas', 'Monaco', monospace;
}

/* Drag-and-drop styles */
.drag-handle-cell {
  cursor: grab;
  text-align: center;
  padding: 4px 6px !important;
  user-select: none;
}

.drag-handle {
  color: #ccc;
  font-size: 18px;
  letter-spacing: -2px;
  line-height: 1;
  transition: color .15s;
}

.drag-handle-cell:hover .drag-handle {
  color: #999;
}

.row-dragging {
  opacity: 0.4;
}

.drag-over-row {
  border-top: 2px solid #4a90d9 !important;
}

.drop-tail-row {
  height: 8px;
}

.drop-tail-row td {
  padding: 0 !important;
  border-bottom: none;
}

.drop-tail-row.drag-over-tail {
  border-top: 2px solid #4a90d9;
}
</style>
