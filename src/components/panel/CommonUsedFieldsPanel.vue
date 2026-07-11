<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import type { Field } from '@/types/schema'
import { displayFieldLength, displayFieldScale, displayDefault, parseDefaultInput, parseFieldLengthInput, parseFieldScaleInput } from '@/utils/file-helpers'

const store = useEditorStore()
const { t } = useI18n()

// ===== 本地数组：从 store 有序方法派生 =====
const localFields = ref<Field[]>([...store.getOrderedCommonUsedFields()])

// 切换项目时重新读取
watch(() => store.commonConfig, () => {
  localFields.value = [...store.getOrderedCommonUsedFields()]
})

// ===== Rename =====
const editingFieldName = ref('')
const editingOldName = ref('')

function startRename(oldName: string) {
  editingOldName.value = oldName
  editingFieldName.value = oldName
}

function finishRename() {
  const oldName = editingOldName.value
  const newName = editingFieldName.value.trim()
  editingOldName.value = ''

  if (!newName) { store.showToast(t('toast.fieldNameEmpty')); return }
  if (oldName === newName) return
  if (localFields.value.some(f => f.field_name === newName)) {
    store.showToast(t('toast.commonFieldExists', { name: newName }))
    editingFieldName.value = ''
    return
  }

  const field = localFields.value.find(f => f.field_name === oldName)
  if (!field) return
  field.field_name = newName
  store.updateCommonUsedFieldName(oldName, newName)
  store.rebuildCommonUsedFieldsFromArray(localFields.value)
  store.showToast(t('toast.commonFieldRenamed'))
  editingFieldName.value = ''
}

// ===== Add =====
const newCommonFieldName = ref('')

function handleAdd() {
  const name = newCommonFieldName.value.trim()
  if (!name) { store.showToast(t('toast.pleaseEnterFieldName')); return }
  if (localFields.value.some(f => f.field_name === name)) {
    store.showToast(t('toast.commonFieldExists', { name }))
    return
  }
  const newField: Field = {
    field_name: name,
    field_type: 'varchar',
    field_length: 255,
    not_null: false,
    primary_key: false,
    comment: ''
  }
  localFields.value.push(newField)
  store.rebuildCommonUsedFieldsFromArray(localFields.value)
  newCommonFieldName.value = ''
  store.showToast(t('toast.commonFieldAdded'))
}

// ===== Sort (move up/down) =====
function moveCommonFieldUp(idx: number) {
  if (idx <= 0) return
  const arr = localFields.value;
  [arr[idx - 1], arr[idx]] = [arr[idx]!, arr[idx - 1]!]
  store.rebuildCommonUsedFieldsFromArray(arr)
}

function moveCommonFieldDown(idx: number) {
  if (idx >= localFields.value.length - 1) return
  const arr = localFields.value;
  [arr[idx], arr[idx + 1]] = [arr[idx + 1]!, arr[idx]!]
  store.rebuildCommonUsedFieldsFromArray(arr)
}

// ===== Drag-and-drop for Common Fields =====
const dragCommonFieldIdx = ref(-1)

function onCommonFieldDragStart(e: DragEvent, idx: number) {
  dragCommonFieldIdx.value = idx
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
  const tr = (e.currentTarget as HTMLElement).closest('tr')
  tr?.classList.add('row-dragging')
}

function onCommonFieldDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  ;(e.currentTarget as HTMLElement)?.classList.add('drag-over-row')
}

function onCommonFieldDragLeave(e: DragEvent) {
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-row')
}

function onCommonFieldDrop(e: DragEvent, toIdx: number) {
  e.preventDefault()
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-row')
  const fromIdx = dragCommonFieldIdx.value
  if (fromIdx < 0 || fromIdx === toIdx) return
  const arr = localFields.value
  const [item] = arr.splice(fromIdx, 1)
  if (item) {
    const insertIdx = toIdx > fromIdx ? toIdx - 1 : toIdx
    arr.splice(insertIdx, 0, item)
    store.rebuildCommonUsedFieldsFromArray(arr)
  }
  dragCommonFieldIdx.value = -1
}

function onCommonFieldDragEnd(e: DragEvent) {
  const tr = (e.currentTarget as HTMLElement).closest('tr')
  tr?.classList.remove('row-dragging')
  document.querySelectorAll('.drag-over-row, .drag-over-tail').forEach(el => el.classList.remove('drag-over-row', 'drag-over-tail'))
  dragCommonFieldIdx.value = -1
}

function onCommonFieldDropTailOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  ;(e.currentTarget as HTMLElement)?.classList.add('drag-over-tail')
}

function onCommonFieldDropTailLeave(e: DragEvent) {
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-tail')
}

function onCommonFieldDropTail(e: DragEvent) {
  e.preventDefault()
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-tail')
  const fromIdx = dragCommonFieldIdx.value
  if (fromIdx < 0) return
  const arr = localFields.value
  if (fromIdx === arr.length - 1) return
  const [item] = arr.splice(fromIdx, 1)
  if (item) {
    arr.push(item)
    store.rebuildCommonUsedFieldsFromArray(arr)
  }
  dragCommonFieldIdx.value = -1
}

// ===== Delete =====
function handleDelete(name: string) {
  const refs: string[] = []
  for (const schema of store.schemas) {
    for (const table of schema.tables) {
      if (table.fields.some(f => f.use_common_used_fields && f.field_name === name)) {
        refs.push(`${schema.schema}.${table.name}`)
      }
    }
  }
  if (refs.length > 0) {
    if (!confirm(
      t('confirm.deleteCommonField', { name, refs: refs.join('\n') })
    )) return
  }
  localFields.value = localFields.value.filter(f => f.field_name !== name)
  store.rebuildCommonUsedFieldsFromArray(localFields.value)
  store.showToast(t('toast.commonFieldDeleted'))
}

/** 选择统一类型时仅清除 field_type，长度和小数位由用户决定是否覆盖 */
function handleUnifiedTypeChange(field: Field, value: string) {
  if (value) {
    field.unified_type = value
    field.field_type = ''
    // 统一类型字段的 quote_default 由类型定义决定，清除字段级设置
    field.quote_default = undefined
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

/** 切换字段是否有默认值 */
function toggleHasDefault(field: Field) {
  if (field.default !== undefined) {
    field.default = undefined
    field.quote_default = undefined
  } else {
    field.default = ''
  }
}

/** 获取统一类型定义的默认值输入组件类型 */
function getDefaultInputType(field: Field): string {
  if (!field.unified_type || !store.commonConfig?.unified_types) return ''
  const def = store.commonConfig.unified_types.find(ut => ut.name === field.unified_type)
  return def?.default_input || ''
}

// ===== Common field expand =====
const expandedCommonFields = reactive(new Set<string>())

function toggleCommonFieldExpand(fieldName: string) {
  if (expandedCommonFields.has(fieldName)) {
    expandedCommonFields.delete(fieldName)
  } else {
    expandedCommonFields.add(fieldName)
  }
}
</script>

<template>
    <!-- Common Used Fields -->
    <div class="section-card">
      <div class="section-header">
        <span>
          {{ $t('commonConfig.commonUsedFields') }}
          <span class="badge">{{ $t('commonConfig.badge', { n: localFields.length }) }}</span>
        </span>
        <div class="header-actions">
          <input
            v-model="newCommonFieldName"
            class="form-input new-field-input"
            :placeholder="$t('commonConfig.newFieldPlaceholder')"
            @keyup.enter="handleAdd"
          />
          <button class="btn btn-sm btn-primary" @click="handleAdd">{{ $t('commonConfig.addField') }}</button>
        </div>
      </div>
      <div class="section-body" style="padding: 0; overflow-x: auto;">
        <table class="common-fields-table">
          <thead>
            <tr>
              <th style="width:24px;"></th>
              <th style="width:30px;"></th>
              <th>{{ $t('commonConfig.fields.fieldName') }}</th>
              <th>{{ $t('commonConfig.fields.fieldType') }}</th>
              <th>{{ $t('commonConfig.fields.length') }}</th>
              <th>{{ $t('commonConfig.fields.scale') }}</th>
              <th>{{ $t('commonConfig.fields.notNull') }}</th>
              <th>{{ $t('commonConfig.fields.pk') }}</th>
              <th>{{ $t('commonConfig.fields.default') }}</th>
              <th style="width:40px;">
                "?"
                <span class="quote-help-icon" :title="$t('fieldTable.quoteDefaultHint')">?</span>
              </th>
              <th>{{ $t('commonConfig.fields.comment') }}</th>
              <th style="width:90px;"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="field in localFields" :key="field.field_name">
            <tr
              @dragover="onCommonFieldDragOver"
              @dragleave="onCommonFieldDragLeave"
              @drop="onCommonFieldDrop($event, localFields.indexOf(field))"
            >
              <!-- drag handle -->
              <td
                class="drag-handle-cell"
                draggable="true"
                @dragstart="onCommonFieldDragStart($event, localFields.indexOf(field))"
                @dragend="onCommonFieldDragEnd"
                :title="$t('commonConfig.dragToSort')"
              >
                <span class="drag-handle">⋮⋮</span>
              </td>
              <!-- expand toggle -->
              <td>
                <span class="expand-toggle" @click="toggleCommonFieldExpand(field.field_name)">
                  {{ expandedCommonFields.has(field.field_name) ? '▼' : '▶' }}
                </span>
              </td>
              <!-- field_name -->
              <td>
                <input
                  v-if="editingOldName === field.field_name"
                  class="table-input"
                  v-model="editingFieldName"
                  @blur="finishRename"
                  @keyup.enter="($event.target as HTMLInputElement).blur()"
                  @keyup.escape="editingOldName = ''; editingFieldName = ''"
                  style="min-width:80px;"
                />
                <span
                  v-else
                  class="editable-field-name"
                  @click="startRename(field.field_name)"
                  :title="$t('commonConfig.clickToRename')"
                >{{ field.field_name }}</span>
              </td>
              <!-- field_type -->
              <td>
                <div class="type-cell">
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
                  <span v-if="store.hasFieldOverrides(field)" class="override-badge" :title="$t('fieldTable.hasOverrides')">⚡</span>
                </div>
              </td>
              <!-- field_length -->
              <td>
                <div class="field-num-cell">
                  <input
                    v-if="!field.field_length_disabled"
                    class="table-input"
                    :value="displayFieldLength(field.field_length)"
                    :placeholder="getUnifiedTypePlaceholder(field, 'length')"
                    @input="field.field_length = parseFieldLengthInput(($event.target as HTMLInputElement).value)"
                    style="width:38px;"
                  />
                  <span v-else class="disabled-indicator" title="已禁用长度（点击恢复）" @click="field.field_length_disabled = undefined">—</span>
                  <label class="mini-checkbox-label" title="不设置长度">
                    <input
                      type="checkbox"
                      class="mini-checkbox"
                      :checked="!!field.field_length_disabled"
                      @change="field.field_length_disabled = ($event.target as HTMLInputElement).checked || undefined"
                    />{{ $t('fieldTable.notSet') }}
                  </label>
                </div>
              </td>
              <!-- field_scale -->
              <td>
                <div class="field-num-cell">
                  <input
                    v-if="!field.field_scale_disabled"
                    class="table-input"
                    :value="displayFieldScale(field.field_scale)"
                    :placeholder="getUnifiedTypePlaceholder(field, 'scale')"
                    @input="field.field_scale = parseFieldScaleInput(($event.target as HTMLInputElement).value)"
                    style="width:38px;"
                  />
                  <span v-else class="disabled-indicator" title="已禁用小数位（点击恢复）" @click="field.field_scale_disabled = undefined">—</span>
                  <label class="mini-checkbox-label" title="不设置小数位">
                    <input
                      type="checkbox"
                      class="mini-checkbox"
                      :checked="!!field.field_scale_disabled"
                      @change="field.field_scale_disabled = ($event.target as HTMLInputElement).checked || undefined"
                    />{{ $t('fieldTable.notSet') }}
                  </label>
                </div>
              </td>
              <!-- not_null -->
              <td>
                <input type="checkbox" class="table-checkbox" v-model="field.not_null" />
              </td>
              <!-- primary_key -->
              <td>
                <input type="checkbox" class="table-checkbox" v-model="field.primary_key" />
              </td>
              <!-- default -->
              <td>
                <div class="default-cell">
                  <input
                    type="checkbox"
                    class="table-checkbox"
                    :checked="field.default !== undefined"
                    @change="toggleHasDefault(field)"
                    :title="$t('fieldTable.hasDefault')"
                  >
                  <select
                    v-if="field.default !== undefined && getDefaultInputType(field) === 'boolean'"
                    class="table-input"
                    :value="field.default === true ? 'TRUE' : field.default === false ? 'FALSE' : ''"
                    @change="field.default = ($event.target as HTMLSelectElement).value === 'TRUE' ? true : ($event.target as HTMLSelectElement).value === 'FALSE' ? false : undefined"
                    style="min-width:80px;"
                  >
                    <option value=""></option>
                    <option value="TRUE">TRUE</option>
                    <option value="FALSE">FALSE</option>
                  </select>
                  <input
                    v-else-if="field.default !== undefined"
                    class="table-input"
                    :value="displayDefault(field.default)"
                    @input="field.default = parseDefaultInput(($event.target as HTMLInputElement).value)"
                    style="min-width:60px;"
                  >
                </div>
              </td>
              <!-- "?" quote_default -->
              <td style="text-align:center;">
                <template v-if="field.default === undefined">
                </template>
                <template v-else-if="field.unified_type">
                  <span v-if="store.quoteDefaultForField(field)" style="color:#4a90d9; font-size:11px;">✓</span>
                </template>
                <input v-else type="checkbox" class="table-checkbox" v-model="field.quote_default">
              </td>
              <!-- comment -->
              <td>
                <input class="table-input" v-model="field.comment" style="min-width:80px;" />
              </td>
              <!-- delete / move -->
              <td style="min-width: 80px;">
                <div class="move-btns">
                  <button class="move-btn" @click="moveCommonFieldUp(localFields.indexOf(field))" :disabled="localFields.indexOf(field) === 0">↑</button>
                  <button class="move-btn" @click="moveCommonFieldDown(localFields.indexOf(field))" :disabled="localFields.indexOf(field) === localFields.length - 1">↓</button>
                </div>
                <button
                  class="btn btn-sm btn-danger"
                  @click="handleDelete(field.field_name)"
                  :title="$t('commonConfig.deleteField')"
                >&times;</button>
              </td>
            </tr>
            <!-- 展开行：数据库方言覆盖 -->
            <tr v-if="expandedCommonFields.has(field.field_name)">
              <td :colspan="12">
                <div class="field-expand-content">
                  <!-- 解析后类型预览 -->
                  <div class="expand-section">
                    <div class="expand-section-title">{{ $t('fieldTable.resolvedTypes') }}</div>
                    <div class="resolved-type-row">
                      <span class="db-label">MySQL:</span>
                      <code>{{ store.getResolvedFieldTypeForDb(field, 'mysql') }}</code>
                      <span class="db-label" style="margin-left:16px;">PostgreSQL:</span>
                      <code>{{ store.getResolvedFieldTypeForDb(field, 'postgresql') }}</code>
                    </div>
                  </div>
                  <div class="expand-section">
                    <div class="expand-section-title">{{ $t('commonConfig.fields.dbOverrides') }}</div>
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
                        <input class="form-input" placeholder="field_type" :value="store.getFieldOverrideValue(field, 'postgresql', 'field_type')" @input="store.setFieldOverrideValue(field, 'postgresql', 'field_type', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="field_length" :value="store.getFieldOverrideValue(field, 'postgresql', 'field_length')" @input="store.setFieldOverrideValue(field, 'postgresql', 'field_length', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="field_scale" :value="store.getFieldOverrideValue(field, 'postgresql', 'field_scale')" @input="store.setFieldOverrideValue(field, 'postgresql', 'field_scale', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="default" :value="store.getFieldOverrideValue(field, 'postgresql', 'default')" @input="store.setFieldOverrideValue(field, 'postgresql', 'default', ($event.target as HTMLInputElement).value)">
                      </div>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
            </template>
            <!-- 尾部 drop 区域 -->
            <tr
              v-if="localFields.length > 0"
              class="drop-tail-row"
              @dragover="onCommonFieldDropTailOver"
              @dragleave="onCommonFieldDropTailLeave"
              @drop="onCommonFieldDropTail"
            >
              <td :colspan="12"></td>
            </tr>
            <tr v-if="localFields.length === 0">
              <td colspan="12" style="text-align:center; color:#aaa; padding:16px;">
                {{ $t('commonConfig.emptyFields') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
</template>

<style scoped src="@/assets/style/section.css"></style>
<style scoped src="@/assets/style/table.css"></style>
<style scoped src="@/assets/style/form.css"></style>
<style scoped src="@/assets/style/btn.css"></style>
<style scoped src="@/assets/style/expand.css"></style>
<style scoped src="@/assets/style/help.css"></style>
<style scoped src="@/assets/style/move-btn.css"></style>
<style scoped>
.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.new-field-input {
  width: 150px;
  padding: 3px 6px;
  font-size: 11px;
}

.common-fields-table tbody tr:hover {
  background: #f5f5f5;
}

.editable-field-name {
  cursor: pointer;
  color: #4a90d9;
  font-weight: 500;
  padding: 2px 4px;
  border-radius: 2px;
  transition: background .15s;
}

.editable-field-name:hover {
  background: #e8f0fe;
  text-decoration: underline;
}

/* Button styles */
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

.move-btns {
  display: inline-flex;
  margin-right: 4px;
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

.override-badge {
  font-size: 11px;
  cursor: help;
  flex-shrink: 0;
  line-height: 1;
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

.mini-checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  font-size: 9px;
  opacity: 0.6;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
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

/* Default value cell */
.default-cell {
  display: flex;
  align-items: center;
  gap: 4px;
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
</style>
