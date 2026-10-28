<script setup lang="ts">
import { computed, ref, reactive } from 'vue'
import { useEditorStore } from '@/stores/editor'
import AppSelect from '@/components/ui/AppSelect.vue'
import type { Field, UnifiedTypeDefinition } from 'schema-editor-core/types/schema'
import { displayFieldLength, displayFieldScale, displayDefault, parseDefaultInput, parseFieldLengthInput, parseFieldScaleInput } from 'schema-editor-core/utils/file-helpers'

const store = useEditorStore()

// Read-only projection, including command undo/redo and project switches.
const localFields = computed(() => store.getOrderedCommonUsedFields())

function updateField(field: Field, patch: Partial<Omit<Field, 'field_name'>>, coalesce = false) {
  store.updateCommonUsedField(field.field_name, patch, coalesce)
}

// ===== Rename =====
const editingFieldName = ref('')
const editingOldName = ref('')

function startRename(oldName: string) {
  editingOldName.value = oldName
  editingFieldName.value = oldName
}

function finishRename() {
  const oldName = editingOldName.value
  const newName = editingFieldName.value
  editingOldName.value = ''
  editingFieldName.value = ''
  if (oldName) store.updateCommonUsedFieldName(oldName, newName)
}

// ===== Add =====
const newCommonFieldName = ref('')

function handleAdd() {
  if (store.addCommonUsedField(newCommonFieldName.value)) newCommonFieldName.value = ''
}

// ===== Sort (move up/down) =====
function moveCommonFieldUp(idx: number) {
  store.moveCommonUsedField(idx, idx - 1)
}

function moveCommonFieldDown(idx: number) {
  store.moveCommonUsedField(idx, idx + 1)
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
  store.moveCommonUsedField(fromIdx, toIdx > fromIdx ? toIdx - 1 : toIdx)
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
  store.moveCommonUsedField(fromIdx, localFields.value.length - 1)
  dragCommonFieldIdx.value = -1
}

// ===== Delete =====
async function handleDelete(name: string) {
  await store.deleteCommonUsedField(name)
}

/** Type selection and clearing of the custom type / default quote happen in the same command. */
function handleUnifiedTypeChange(field: Field, value: string) {
  updateField(field, { unified_type: value || undefined })
}

/** Get the placeholder value configured in the unified type definition (prefers the MySQL value) */
function getUnifiedTypePlaceholder(field: Field, key: 'length' | 'scale'): string {
  if (!field.unified_type || !store.commonConfig?.unified_types) return ''
  const def = store.commonConfig.unified_types.find((ut: UnifiedTypeDefinition) => ut.name === field.unified_type)
  if (!def) return ''
  const val = def.mysql[key]
  return val !== undefined && val !== null ? String(val) : ''
}

/** Toggle whether the field has a default value */
function toggleHasDefault(field: Field) {
  updateField(field, field.default !== undefined
    ? { default: undefined, quote_default: undefined }
    : { default: '' })
}

/** When ON UPDATE is checked, prefill the fractional-seconds precision from the field length (datetime(3) → 3); lengths outside 0-6 are ignored */
function defaultOnUpdatePrecision(field: Field): number | undefined {
  const len = field.field_length
  return typeof len === 'number' && len >= 0 && len <= 6 ? len : undefined
}

/** Toggle MySQL ON UPDATE CURRENT_TIMESTAMP */
function toggleOnUpdate(field: Field, checked: boolean) {
  updateField(field, {
    on_update_current_timestamp: checked || undefined,
    on_update_current_timestamp_precision: checked ? defaultOnUpdatePrecision(field) : undefined,
  })
}

/** Get the default-value input component type from the unified type definition */
function getDefaultInputType(field: Field): string {
  if (!field.unified_type || !store.commonConfig?.unified_types) return ''
  const def = store.commonConfig.unified_types.find((ut: UnifiedTypeDefinition) => ut.name === field.unified_type)
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
              <th style="width:96px;">
                {{ $t('fieldTable.onUpdate') }}
                <span class="quote-help-icon" :title="$t('fieldTable.onUpdateHint')">?</span>
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
                  <AppSelect
                    variant="table"
                    class="unified-type-select"
                    :model-value="field.unified_type ?? ''"
                    :options="[
                      { value: '', label: $t('fieldTable.customType') },
                      ...store.unifiedTypeNames.map(name => ({ value: name, label: name })),
                    ]"
                    @update:model-value="handleUnifiedTypeChange(field, $event)"
                  />
                  <input
                    v-if="!field.unified_type"
                    class="table-input type-free-input"
                    :value="field.field_type" @input="updateField(field, { field_type: ($event.target as HTMLInputElement).value }, true)"
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
                    @input="updateField(field, { field_length: parseFieldLengthInput(($event.target as HTMLInputElement).value) }, true)"
                    style="width:38px;"
                  />
                  <span v-else class="disabled-indicator" :title="$t('fieldTable.lengthDisabledHint')" @click="updateField(field, { field_length_disabled: undefined })">—</span>
                  <label class="checkbox-label micro" :title="$t('fieldTable.lengthNotSetHint')">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-xs"
                      :checked="!!field.field_length_disabled"
                      @change="updateField(field, { field_length_disabled: ($event.target as HTMLInputElement).checked || undefined })"
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
                    @input="updateField(field, { field_scale: parseFieldScaleInput(($event.target as HTMLInputElement).value) }, true)"
                    style="width:38px;"
                  />
                  <span v-else class="disabled-indicator" :title="$t('fieldTable.scaleDisabledHint')" @click="updateField(field, { field_scale_disabled: undefined })">—</span>
                  <label class="checkbox-label micro" :title="$t('fieldTable.scaleNotSetHint')">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-xs"
                      :checked="!!field.field_scale_disabled"
                      @change="updateField(field, { field_scale_disabled: ($event.target as HTMLInputElement).checked || undefined })"
                    />{{ $t('fieldTable.notSet') }}
                  </label>
                </div>
              </td>
              <!-- not_null -->
              <td>
                <input type="checkbox" class="checkbox checkbox-sm" :checked="!!field.not_null" @change="updateField(field, { not_null: ($event.target as HTMLInputElement).checked })" />
              </td>
              <!-- primary_key -->
              <td>
                <input type="checkbox" class="checkbox checkbox-sm" :checked="!!field.primary_key" @change="updateField(field, { primary_key: ($event.target as HTMLInputElement).checked })" />
              </td>
              <!-- default -->
              <td>
                <div class="default-cell">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm"
                    :checked="field.default !== undefined"
                    @change="toggleHasDefault(field)"
                    :title="$t('fieldTable.hasDefault')"
                  >
                  <AppSelect
                    v-if="field.default !== undefined && getDefaultInputType(field) === 'boolean'"
                    variant="table"
                    :model-value="field.default === true ? 'TRUE' : field.default === false ? 'FALSE' : ''"
                    :options="[
                      { value: '', label: '—' },
                      { value: 'TRUE', label: 'TRUE' },
                      { value: 'FALSE', label: 'FALSE' },
                    ]"
                    @update:model-value="updateField(field, { default: $event === 'TRUE' ? true : ($event === 'FALSE' ? false : undefined) }, true)"
                  />
                  <input
                    v-else-if="field.default !== undefined"
                    class="table-input"
                    :value="displayDefault(field.default)"
                    @input="updateField(field, { default: parseDefaultInput(($event.target as HTMLInputElement).value) }, true)"
                    style="min-width:60px;"
                  >
                </div>
              </td>
              <!-- "?" quote_default -->
              <td style="text-align:center;">
                <template v-if="field.default === undefined">
                </template>
                <template v-else-if="field.unified_type">
                  <span v-if="store.quoteDefaultForField(field)" style="color:var(--accent); font-size:11px;">✓</span>
                </template>
                <input v-else type="checkbox" class="checkbox checkbox-sm" :checked="!!field.quote_default" @change="updateField(field, { quote_default: ($event.target as HTMLInputElement).checked })">
              </td>
              <!-- on_update_current_timestamp -->
              <td>
                <div class="on-update-cell">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm"
                    :checked="!!field.on_update_current_timestamp"
                    @change="toggleOnUpdate(field, ($event.target as HTMLInputElement).checked)"
                  >
                  <input
                    v-if="field.on_update_current_timestamp"
                    class="table-input"
                    type="number"
                    min="0"
                    max="6"
                    :value="field.on_update_current_timestamp_precision ?? ''"
                    @input="updateField(field, { on_update_current_timestamp_precision: parseFieldLengthInput(($event.target as HTMLInputElement).value) }, true)"
                    :title="$t('fieldTable.onUpdatePrecisionHint')"
                    placeholder="0-6"
                    style="width:44px;"
                  >
                </div>
              </td>
              <!-- comment -->
              <td>
                <input class="table-input" :value="field.comment" @input="updateField(field, { comment: ($event.target as HTMLInputElement).value }, true)" style="min-width:80px;" />
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
            <!-- Expand row: database dialect overrides -->
            <tr v-if="expandedCommonFields.has(field.field_name)">
              <td :colspan="13">
                <div class="field-expand-content">
                  <!-- Resolved type preview -->
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
                        <input class="form-input" placeholder="field_type" :value="store.getFieldOverrideValue(field, 'mysql', 'field_type')" @input="store.setCommonUsedFieldOverrideValue(field.field_name, 'mysql', 'field_type', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="field_length" :value="store.getFieldOverrideValue(field, 'mysql', 'field_length')" @input="store.setCommonUsedFieldOverrideValue(field.field_name, 'mysql', 'field_length', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="field_scale" :value="store.getFieldOverrideValue(field, 'mysql', 'field_scale')" @input="store.setCommonUsedFieldOverrideValue(field.field_name, 'mysql', 'field_scale', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="default" :value="store.getFieldOverrideValue(field, 'mysql', 'default')" @input="store.setCommonUsedFieldOverrideValue(field.field_name, 'mysql', 'default', ($event.target as HTMLInputElement).value)">
                      </div>
                      <div class="db-override-group">
                        <div class="db-label">{{ $t('fieldTable.postgresql') }}</div>
                        <input class="form-input" placeholder="field_type" :value="store.getFieldOverrideValue(field, 'postgresql', 'field_type')" @input="store.setCommonUsedFieldOverrideValue(field.field_name, 'postgresql', 'field_type', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="field_length" :value="store.getFieldOverrideValue(field, 'postgresql', 'field_length')" @input="store.setCommonUsedFieldOverrideValue(field.field_name, 'postgresql', 'field_length', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="field_scale" :value="store.getFieldOverrideValue(field, 'postgresql', 'field_scale')" @input="store.setCommonUsedFieldOverrideValue(field.field_name, 'postgresql', 'field_scale', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="default" :value="store.getFieldOverrideValue(field, 'postgresql', 'default')" @input="store.setCommonUsedFieldOverrideValue(field.field_name, 'postgresql', 'default', ($event.target as HTMLInputElement).value)">
                      </div>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
            </template>
            <!-- Tail drop zone -->
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
              <td colspan="12" style="text-align:center; color:var(--fg-subtle); padding:16px;">
                {{ $t('commonConfig.emptyFields') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
</template>

<style scoped>
.new-field-input {
  width: 150px;
  padding: 3px 6px;
  font-size: 11px;
}

.common-fields-table tbody tr:hover {
  background: var(--surface-2);
}

.editable-field-name {
  cursor: pointer;
  color: var(--accent);
  font-weight: 500;
  padding: 2px 4px;
  border-radius: 2px;
  transition: background .15s;
}

.editable-field-name:hover {
  background: var(--accent-subtle);
  text-decoration: underline;
}

/* Button styles */

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
  color: var(--fg-muted);
  font-size: 12px;
}

.field-num-cell {
  display: flex;
  align-items: center;
  gap: 2px;
}

/* Drag-and-drop styles */
.drag-handle-cell {
  cursor: grab;
  text-align: center;
  padding: 4px 6px !important;
  user-select: none;
}

.drag-handle {
  color: var(--border);
  font-size: 18px;
  letter-spacing: -2px;
  line-height: 1;
  transition: color .15s;
}

.drag-handle-cell:hover .drag-handle {
  color: var(--fg-subtle);
}

.row-dragging {
  opacity: 0.4;
}

.drag-over-row {
  border-top: 2px solid var(--accent) !important;
}

.drop-tail-row {
  height: 8px;
}

.drop-tail-row td {
  padding: 0 !important;
  border-bottom: none;
}

.drop-tail-row.drag-over-tail {
  border-top: 2px solid var(--accent);
}

/* Default value cell */
.default-cell {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ON UPDATE cell */
.on-update-cell {
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
  background: var(--accent-subtle);
  color: var(--fg);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-family: 'Consolas', 'Monaco', monospace;
}
</style>
