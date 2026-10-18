<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEditorStore } from '@/stores/editor'
import type { UnifiedTypeDefinition } from 'schema-editor-core/types/schema'
import { displayFieldLength, displayFieldScale } from 'schema-editor-core/utils/file-helpers'

const store = useEditorStore()
const localUnifiedTypes = computed(() => store.commonConfig?.unified_types ?? [])

// ===== Unified Types sort (move up/down) =====
function moveUnifiedTypeUp(idx: number) {
  store.moveUnifiedType(idx, idx - 1)
}

function moveUnifiedTypeDown(idx: number) {
  store.moveUnifiedType(idx, idx + 1)
}

// ===== Drag-and-drop for Unified Types =====
const dragUnifiedTypeIdx = ref(-1)

function onUnifiedTypeDragStart(e: DragEvent, idx: number) {
  dragUnifiedTypeIdx.value = idx
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
  const tr = (e.currentTarget as HTMLElement).closest('tr')
  tr?.classList.add('row-dragging')
}

function onUnifiedTypeDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  ;(e.currentTarget as HTMLElement)?.classList.add('drag-over-row')
}

function onUnifiedTypeDragLeave(e: DragEvent) {
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-row')
}

function onUnifiedTypeDrop(e: DragEvent, toIdx: number) {
  e.preventDefault()
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-row')
  const fromIdx = dragUnifiedTypeIdx.value
  if (fromIdx < 0 || fromIdx === toIdx) return
  store.moveUnifiedType(fromIdx, toIdx > fromIdx ? toIdx - 1 : toIdx)
  dragUnifiedTypeIdx.value = -1
}

function onUnifiedTypeDragEnd(e: DragEvent) {
  const tr = (e.currentTarget as HTMLElement).closest('tr')
  tr?.classList.remove('row-dragging')
  document.querySelectorAll('.drag-over-row, .drag-over-tail').forEach(el => el.classList.remove('drag-over-row', 'drag-over-tail'))
  dragUnifiedTypeIdx.value = -1
}

function onUnifiedTypeDropTailOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  ;(e.currentTarget as HTMLElement)?.classList.add('drag-over-tail')
}

function onUnifiedTypeDropTailLeave(e: DragEvent) {
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-tail')
}

function onUnifiedTypeDropTail(e: DragEvent) {
  e.preventDefault()
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-tail')
  const fromIdx = dragUnifiedTypeIdx.value
  store.moveUnifiedType(fromIdx, localUnifiedTypes.value.length - 1)
  dragUnifiedTypeIdx.value = -1
}

// Names are committed on change, never mutated before the atomic rename.
function finishRename(ut: UnifiedTypeDefinition, event: Event) {
  const input = event.target as HTMLInputElement
  const oldName = ut.name
  const requested = input.value.trim()
  input.value = store.renameUnifiedType(oldName, requested) ? requested : oldName
}

const newUnifiedTypeName = ref('')

function handleAddUnifiedType() {
  if (store.addUnifiedType(newUnifiedTypeName.value)) newUnifiedTypeName.value = ''
}

function handleDeleteUnifiedType(idx: number) {
  store.deleteUnifiedType(idx)
}

/** Read a SQLite mapping value (returns an empty string when unset) */
function sqliteValue(ut: UnifiedTypeDefinition, key: 'type' | 'length' | 'scale'): string {
  const value = ut.sqlite?.[key]
  return value === undefined || value === null ? '' : String(value)
}
</script>

<template>
    <!-- Unified Types -->
    <div class="section-card">
      <div class="section-header">
        <span>
          {{ $t('commonConfig.unifiedTypesTitle') }}
          <span class="badge">{{ $t('commonConfig.badge', { n: localUnifiedTypes.length }) }}</span>
        </span>
        <div class="header-actions">
          <input
            v-model="newUnifiedTypeName"
            class="form-input new-field-input"
            :placeholder="$t('commonConfig.newTypePlaceholder')"
            @keyup.enter="handleAddUnifiedType"
          />
          <button class="btn btn-sm btn-primary" @click="handleAddUnifiedType">{{ $t('commonConfig.addType') }}</button>
        </div>
      </div>
      <div class="section-body" style="padding: 0; overflow-x: auto;">
        <table class="common-fields-table">
          <thead>
            <tr>
              <th style="width:24px;"></th>
              <th>{{ $t('commonConfig.unifiedTypes.name') }}</th>
              <th>{{ $t('commonConfig.unifiedTypes.description') }}</th>
              <th>{{ $t('commonConfig.unifiedTypes.mysqlType') }}</th>
              <th>{{ $t('commonConfig.unifiedTypes.mysqlLength') }}</th>
              <th>{{ $t('commonConfig.unifiedTypes.mysqlScale') }}</th>
              <th>{{ $t('commonConfig.unifiedTypes.postgresqlType') }}</th>
              <th>{{ $t('commonConfig.unifiedTypes.postgresqlLength') }}</th>
              <th>{{ $t('commonConfig.unifiedTypes.postgresqlScale') }}</th>
              <th>{{ $t('commonConfig.unifiedTypes.sqliteType') }}</th>
              <th>{{ $t('commonConfig.unifiedTypes.sqliteLength') }}</th>
              <th>{{ $t('commonConfig.unifiedTypes.sqliteScale') }}</th>
              <th style="width:60px;">{{ $t('commonConfig.unifiedTypes.quoteDefault') }}</th>
              <th style="width:100px;">{{ $t('commonConfig.unifiedTypes.defaultInput') }}</th>
              <th style="width:90px;"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(ut, idx) in localUnifiedTypes"
              :key="ut.name"
              @dragover="onUnifiedTypeDragOver"
              @dragleave="onUnifiedTypeDragLeave"
              @drop="onUnifiedTypeDrop($event, idx)"
            >
              <!-- drag handle -->
              <td
                class="drag-handle-cell"
                draggable="true"
                @dragstart="onUnifiedTypeDragStart($event, idx)"
                @dragend="onUnifiedTypeDragEnd"
                :title="$t('commonConfig.dragToSort')"
              >
                <span class="drag-handle">⋮⋮</span>
              </td>
              <td>
                <input
                  class="table-input"
                  :value="ut.name"
                  @change="finishRename(ut, $event)"
                  style="min-width:80px;"
                />
              </td>
              <td>
                <input
                  class="table-input"
                  :value="ut.description"
                  @input="store.updateUnifiedType(ut.name, { description: ($event.target as HTMLInputElement).value }, true)"
                  style="min-width:100px;"
                />
              </td>
              <td>
                <input
                  class="table-input"
                  :value="ut.mysql.type"
                  @input="store.setUnifiedTypeMappingValue(ut.name, 'mysql', 'type', ($event.target as HTMLInputElement).value)"
                  style="min-width:80px;"
                />
              </td>
              <td>
                <input
                  class="table-input"
                  :value="displayFieldLength(ut.mysql.length)"
                  @input="store.setUnifiedTypeMappingValue(ut.name, 'mysql', 'length', ($event.target as HTMLInputElement).value)"
                  style="width:60px;"
                />
              </td>
              <td>
                <input
                  class="table-input"
                  :value="displayFieldScale(ut.mysql.scale)"
                  @input="store.setUnifiedTypeMappingValue(ut.name, 'mysql', 'scale', ($event.target as HTMLInputElement).value)"
                  style="width:50px;"
                />
              </td>
              <td>
                <input
                  class="table-input"
                  :value="ut.postgresql.type"
                  @input="store.setUnifiedTypeMappingValue(ut.name, 'postgresql', 'type', ($event.target as HTMLInputElement).value)"
                  style="min-width:80px;"
                />
              </td>
              <td>
                <input
                  class="table-input"
                  :value="displayFieldLength(ut.postgresql.length)"
                  @input="store.setUnifiedTypeMappingValue(ut.name, 'postgresql', 'length', ($event.target as HTMLInputElement).value)"
                  style="width:60px;"
                />
              </td>
              <td>
                <input
                  class="table-input"
                  :value="displayFieldScale(ut.postgresql.scale)"
                  @input="store.setUnifiedTypeMappingValue(ut.name, 'postgresql', 'scale', ($event.target as HTMLInputElement).value)"
                  style="width:50px;"
                />
              </td>
              <td>
                <input
                  class="table-input"
                  :value="sqliteValue(ut, 'type')"
                  @input="store.setUnifiedTypeMappingValue(ut.name, 'sqlite', 'type', ($event.target as HTMLInputElement).value)"
                  style="min-width:80px;"
                />
              </td>
              <td>
                <input
                  class="table-input"
                  :value="sqliteValue(ut, 'length')"
                  @input="store.setUnifiedTypeMappingValue(ut.name, 'sqlite', 'length', ($event.target as HTMLInputElement).value)"
                  style="width:60px;"
                />
              </td>
              <td>
                <input
                  class="table-input"
                  :value="sqliteValue(ut, 'scale')"
                  @input="store.setUnifiedTypeMappingValue(ut.name, 'sqlite', 'scale', ($event.target as HTMLInputElement).value)"
                  style="width:50px;"
                />
              </td>
              <td style="text-align:center;">
                <input type="checkbox" class="table-checkbox" :checked="!!ut.quote_default" @change="store.updateUnifiedType(ut.name, { quote_default: ($event.target as HTMLInputElement).checked })" />
              </td>
              <td style="text-align:center;">
                <select class="table-input" :value="ut.default_input ?? ''" @change="store.updateUnifiedType(ut.name, { default_input: ($event.target as HTMLSelectElement).value === 'boolean' ? 'boolean' : undefined })" style="min-width:100px;">
                  <option value="">{{ $t('commonConfig.unifiedTypes.defaultInputText') }}</option>
                  <option value="boolean">{{ $t('commonConfig.unifiedTypes.defaultInputBoolean') }}</option>
                </select>
              </td>
              <td style="min-width: 90px;">
                <div class="move-btns" style="display:inline-flex; margin-right:2px;">
                  <button class="move-btn" @click="moveUnifiedTypeUp(idx)" :disabled="idx === 0">↑</button>
                  <button class="move-btn" @click="moveUnifiedTypeDown(idx)" :disabled="idx === localUnifiedTypes.length - 1">↓</button>
                </div>
                <button
                  class="btn btn-sm btn-danger"
                  @click="handleDeleteUnifiedType(idx)"
                  :title="$t('commonConfig.deleteType')"
                >&times;</button>
              </td>
            </tr>
            <!-- Tail drop zone -->
            <tr
              v-if="localUnifiedTypes.length > 0"
              class="drop-tail-row"
              @dragover="onUnifiedTypeDropTailOver"
              @dragleave="onUnifiedTypeDropTailLeave"
              @drop="onUnifiedTypeDropTail"
            >
              <td :colspan="15"></td>
            </tr>
            <tr v-if="localUnifiedTypes.length === 0">
              <td colspan="15" style="text-align:center; color:var(--fg-subtle); padding:16px;">
                {{ $t('commonConfig.emptyTypes') }}
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
  background: var(--surface-2);
}

/* Button styles */
.btn {
  padding: 4px 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}

.btn:hover {
  background: var(--surface-2);
}

.btn-primary {
  background: var(--accent);
  color: var(--accent-fg);
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

.table-input {
  padding: 3px 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-family: inherit;
  width: 100%;
  box-sizing: border-box;
}

.table-input:focus {
  outline: none;
  border-color: var(--accent);
}

.move-btns {
  display: inline-flex;
  margin-right: 4px;
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
</style>
