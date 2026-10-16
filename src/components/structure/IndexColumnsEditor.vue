<script setup lang="ts">
import { watch, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { IndexColumn } from '@/types/schema'
import type { SqlDialect } from '@/utils/sql-generator/shared'
import { isColumnDragging } from '@/utils/column-drag-flag'

const props = defineProps<{
  modelValue: IndexColumn[]
  availableFields: string[]
}>()

const { t } = useI18n()

const emit = defineEmits<{
  'update:modelValue': [value: IndexColumn[]]
}>()

// Per-column expanded state for db overrides
const expandedOverrides = reactive(new Set<number>())

// ===== 列拖拽排序 =====
const dragColIdx = ref(-1)

function onColDragStart(e: DragEvent, idx: number) {
  e.stopPropagation()
  dragColIdx.value = idx
  isColumnDragging.value = true
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
  ;(e.currentTarget as HTMLElement).classList.add('col-dragging')
}

function onColDragOver(e: DragEvent) {
  // 仅在拖拽列时响应，避免污染外层索引行的拖拽
  if (dragColIdx.value < 0) return
  // 阻止冒泡，避免触发外层索引行的拖拽排序
  e.stopPropagation()
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  ;(e.currentTarget as HTMLElement).classList.add('col-drag-over')
}

function onColDragLeave(e: DragEvent) {
  // 仅在拖拽列时响应，避免污染外层索引行
  if (dragColIdx.value < 0) return
  // 阻止冒泡，避免联动外层索引行
  e.stopPropagation()
  ;(e.currentTarget as HTMLElement).classList.remove('col-drag-over')
}

function onColDrop(e: DragEvent, toIdx: number) {
  e.stopPropagation()
  e.preventDefault()
  ;(e.currentTarget as HTMLElement).classList.remove('col-drag-over')
  const fromIdx = dragColIdx.value
  dragColIdx.value = -1
  isColumnDragging.value = false
  moveColumn(fromIdx, toIdx)
}

function onColDragEnd(e: DragEvent) {
  e.stopPropagation()
  isColumnDragging.value = false
  document.querySelectorAll('.col-dragging, .col-drag-over, .col-drag-over-tail').forEach(el =>
    el.classList.remove('col-dragging', 'col-drag-over', 'col-drag-over-tail'),
  )
  dragColIdx.value = -1
}

// 末尾投放区：把某项拖到最后一列
function onColDragOverTail(e: DragEvent) {
  if (dragColIdx.value < 0) return
  e.stopPropagation()
  e.preventDefault()
  ;(e.currentTarget as HTMLElement).classList.add('col-drag-over-tail')
}

function onColDragLeaveTail(e: DragEvent) {
  if (dragColIdx.value < 0) return
  e.stopPropagation()
  ;(e.currentTarget as HTMLElement).classList.remove('col-drag-over-tail')
}

function onColDropTail(e: DragEvent) {
  e.stopPropagation()
  e.preventDefault()
  ;(e.currentTarget as HTMLElement).classList.remove('col-drag-over-tail')
  const fromIdx = dragColIdx.value
  dragColIdx.value = -1
  isColumnDragging.value = false
  moveColumn(fromIdx, props.modelValue.length)
}

function moveColumn(fromIdx: number, toIdx: number) {
  const arr = copyColumns()
  if (
    fromIdx < 0 ||
    fromIdx >= arr.length ||
    toIdx < 0 ||
    toIdx > arr.length ||
    fromIdx === toIdx
  ) {
    return
  }
  const moved = arr.splice(fromIdx, 1)[0]
  if (!moved) return
  toIdx = Math.min(toIdx, arr.length)
  arr.splice(toIdx, 0, moved)
  // 同步迁移每列的覆盖展开状态，避免展开错位
  const remapped = new Set<number>()
  for (const oldIdx of expandedOverrides) {
    if (oldIdx === fromIdx) remapped.add(toIdx)
    else if (oldIdx > fromIdx && oldIdx <= toIdx) remapped.add(oldIdx - 1)
    else if (oldIdx < fromIdx && oldIdx >= toIdx) remapped.add(oldIdx + 1)
    else remapped.add(oldIdx)
  }
  expandedOverrides.clear()
  remapped.forEach(i => expandedOverrides.add(i))
  emitColumns(arr)
}

function copyColumns(): IndexColumn[] {
  return props.modelValue.map(col => {
    const next = { ...col }
    for (const db of ['mysql', 'postgresql', 'sqlite'] as const) {
      if (col[db]) next[db] = { ...col[db] }
    }
    return next
  })
}

let ownUpdate = false
function emitColumns(columns: IndexColumn[]) {
  ownUpdate = true
  emit('update:modelValue', columns)
}

function toggleOverride(idx: number) {
  if (expandedOverrides.has(idx)) {
    const columns = copyColumns()
    const col = columns[idx]
    let changed = false
    for (const db of ['mysql', 'postgresql', 'sqlite'] as const) {
      if (col?.[db] && Object.keys(col[db]!).length === 0) {
        delete col[db]
        changed = true
      }
    }
    if (changed) emitColumns(columns)
    expandedOverrides.delete(idx)
  } else {
    // Expansion is UI state only; missing dialect overrides read as empty.
    expandedOverrides.add(idx)
  }
}

function addColumn() {
  emitColumns([...copyColumns(), { name: '' }])
}

function removeColumn(idx: number) {
  const newCols = copyColumns().filter((_, i) => i !== idx)
  if (newCols.length === 0) newCols.push({ name: '' })
  const remapped = [...expandedOverrides].filter(i => i !== idx).map(i => i > idx ? i - 1 : i)
  expandedOverrides.clear()
  remapped.forEach(i => expandedOverrides.add(i))
  emitColumns(newCols)
}

function updateColumn(idx: number, key: 'name' | 'sort_order', value: string) {
  const columns = copyColumns()
  const col = columns[idx]
  if (!col) return
  if (key === 'name') col.name = value
  else if (value) col.sort_order = value as 'ASC' | 'DESC'
  else delete col.sort_order
  emitColumns(columns)
}

function setDbSortOrder(idx: number, db: SqlDialect, val: string) {
  const columns = copyColumns()
  const col = columns[idx]
  if (!col) return
  if (val) {
    col[db] = { ...col[db], sort_order: val as 'ASC' | 'DESC' }
  } else if (col[db]) {
    delete col[db]!.sort_order
    if (Object.keys(col[db]!).length === 0) delete col[db]
  }
  emitColumns(columns)
}

// Preserve expansion for our own immutable patches; reset on external undo/table changes.
watch(() => props.modelValue, () => {
  if (!ownUpdate) expandedOverrides.clear()
  ownUpdate = false
})
</script>

<template>
  <div class="index-columns-editor">
    <div
      class="column-row"
      v-for="(col, idx) in modelValue"
      :key="idx"
      :draggable="modelValue.length > 1"
      @dragstart="onColDragStart($event, idx)"
      @dragover="onColDragOver"
      @dragleave="onColDragLeave"
      @drop="onColDrop($event, idx)"
      @dragend="onColDragEnd"
    >
      <div class="column-main">
        <span v-if="modelValue.length > 1" class="col-drag-handle" :title="t('commonConfig.dragToSort')">⋮⋮</span>
        <select
          class="form-input column-name-select"
          :value="col.name"
          @change="updateColumn(idx, 'name', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">{{ $t('indexColumnsEditor.selectColumn') }}</option>
          <option
            v-for="fieldName in availableFields"
            :key="fieldName"
            :value="fieldName"
          >
            {{ fieldName }}
          </option>
          <!-- 保留不在当前字段列表中的已选值 -->
          <option
            v-if="col.name && !availableFields.includes(col.name)"
            :value="col.name"
          >
            {{ col.name }}
          </option>
        </select>
        <select
          class="form-input sort-select"
          :value="col.sort_order ?? ''"
          @change="updateColumn(idx, 'sort_order', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">{{ $t('indexColumnsEditor.noDirection') }}</option>
          <option value="ASC">{{ $t('indexColumnsEditor.asc') }}</option>
          <option value="DESC">{{ $t('indexColumnsEditor.desc') }}</option>
        </select>
        <button
          class="btn btn-sm override-toggle"
          :class="{ active: expandedOverrides.has(idx) }"
          @click="toggleOverride(idx)"
          :title="$t('fieldTable.dbOverrides')"
        >▶</button>
        <button
          class="btn btn-sm btn-danger"
          @click="removeColumn(idx)"
        >×</button>
      </div>
      <!-- Per-db override section -->
      <div v-if="expandedOverrides.has(idx)" class="column-override">
        <div class="db-override-grid">
          <div class="db-override-group">
            <div class="db-label">MySQL</div>
            <select
              class="form-input"
              :value="col.mysql?.sort_order ?? ''"
              @change="setDbSortOrder(idx, 'mysql', ($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ $t('indexColumnsEditor.noDirection') }}</option>
              <option value="ASC">ASC</option>
              <option value="DESC">DESC</option>
            </select>
          </div>
          <div class="db-override-group">
            <div class="db-label">PostgreSQL</div>
            <select
              class="form-input"
              :value="col.postgresql?.sort_order ?? ''"
              @change="setDbSortOrder(idx, 'postgresql', ($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ $t('indexColumnsEditor.noDirection') }}</option>
              <option value="ASC">ASC</option>
              <option value="DESC">DESC</option>
            </select>
          </div>
          <div class="db-override-group">
            <div class="db-label">SQLite</div>
            <select
              class="form-input"
              :value="col.sqlite?.sort_order ?? ''"
              @change="setDbSortOrder(idx, 'sqlite', ($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ $t('indexColumnsEditor.noDirection') }}</option>
              <option value="ASC">ASC</option>
              <option value="DESC">DESC</option>
            </select>
          </div>
        </div>
      </div>
    </div>
    <!-- 末尾投放区：仅在拖拽列时显示，支持把某项拖到最后一列 -->
    <div
      v-if="modelValue.length > 1 && dragColIdx >= 0"
      class="col-drop-tail"
      @dragover="onColDragOverTail"
      @dragleave="onColDragLeaveTail"
      @drop="onColDropTail"
    ></div>
    <button class="btn btn-sm btn-add-col" @click="addColumn">
      + {{ $t('indexColumnsEditor.addColumn') }}
    </button>
  </div>
</template>

<style scoped src="@/assets/style/table.css"></style>
<style scoped src="@/assets/style/form.css"></style>
<style scoped src="@/assets/style/btn.css"></style>
<style scoped src="@/assets/style/expand.css"></style>
<style scoped>
.index-columns-editor {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.column-row {
  display: flex;
  flex-direction: column;
}

.column-main {
  display: flex;
  align-items: center;
  gap: 3px;
}

.col-drag-handle {
  flex: none;
  color: var(--border);
  font-size: 12px;
  letter-spacing: -2px;
  line-height: 1;
  cursor: grab;
  user-select: none;
  transition: color .15s;
}

.column-row:hover .col-drag-handle {
  color: var(--fg-subtle);
}

.col-dragging {
  opacity: 0.4;
}

.col-drag-over {
  border-top: 2px solid var(--accent);
}

.col-drop-tail {
  height: 6px;
}

.col-drag-over-tail {
  border-top: 2px solid var(--accent);
}

.column-name-select {
  flex: 1;
  min-width: 80px;
}

.sort-select {
  width: 65px;
  padding: 2px 3px;
  font-size: 11px;
}

.override-toggle {
  font-size: 8px;
  padding: 2px 4px;
  transition: transform .15s;
  line-height: 1;
}

.override-toggle.active {
  transform: rotate(90deg);
  background: var(--accent-subtle);
  border-color: var(--accent);
}

.column-override {
  padding: 4px 0 2px 0;
}

.db-override-grid {
  display: flex;
  gap: 12px;
}

.db-override-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.db-label {
  font-size: 9px;
  font-weight: 600;
  color: var(--fg-muted);
  text-transform: uppercase;
}

/* 复用 IndexTable 已有样式 */
.table-input {
  padding: 3px 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-family: inherit;
  box-sizing: border-box;
}

.table-input:focus {
  outline: none;
  border-color: var(--accent);
}

.form-input {
  padding: 2px 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-family: inherit;
  color: var(--fg);
}

.form-input:focus {
  outline: none;
  border-color: var(--accent);
}

.btn {
  padding: 2px 6px;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: var(--radius-sm);
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
  line-height: 1.4;
}

.btn:hover {
  background: var(--surface-2);
}

.btn-sm {
  padding: 1px 5px;
  font-size: 10px;
}

.btn-danger {
  color: var(--danger);
  border-color: var(--danger);
  padding: 1px 5px;
  font-size: 11px;
}

.btn-danger:hover {
  background: var(--danger-subtle);
}

.btn-add-col {
  align-self: flex-start;
  margin-top: 2px;
  color: var(--accent);
  border-color: var(--accent);
}

.btn-add-col:hover {
  background: var(--accent-subtle);
}
</style>
