<script setup lang="ts">
import { watch, reactive, ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppSelect from '@/components/ui/AppSelect.vue'
import type { IndexColumn } from 'schema-editor-core/types/schema'
import type { SqlDialect } from 'schema-editor-core/utils/sql-generator/shared'
import { isColumnDragging } from '@/utils/column-drag-flag'

const props = defineProps<{
  modelValue: IndexColumn[]
  availableFields: string[]
}>()

const { t } = useI18n()

const sortOrderOptions = computed(() => [
  { value: '', label: t('indexColumnsEditor.noDirection') },
  { value: 'ASC', label: t('indexColumnsEditor.asc') },
  { value: 'DESC', label: t('indexColumnsEditor.desc') },
])

function columnNameOptions(col: IndexColumn) {
  const options = [
    { value: '', label: t('indexColumnsEditor.selectColumn') },
    ...props.availableFields.map(name => ({ value: name, label: name })),
  ]
  if (col.name && !props.availableFields.includes(col.name)) {
    options.push({ value: col.name, label: col.name })
  }
  return options
}

const emit = defineEmits<{
  'update:modelValue': [value: IndexColumn[]]
}>()

// Per-column expanded state for db overrides
const expandedOverrides = reactive(new Set<number>())

// ===== Column drag-and-drop reordering =====
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
  // Respond only while a column is being dragged, to avoid interfering with the outer index row drag
  if (dragColIdx.value < 0) return
  // Stop propagation so the outer index row drag reordering is not triggered
  e.stopPropagation()
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  ;(e.currentTarget as HTMLElement).classList.add('col-drag-over')
}

function onColDragLeave(e: DragEvent) {
  // Respond only while a column is being dragged, to avoid interfering with the outer index row
  if (dragColIdx.value < 0) return
  // Stop propagation to avoid involving the outer index row
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

// Tail drop zone: drop an item into the last column
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
  // Migrate each column's override expansion state along with the move to keep expansion in sync
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
        <AppSelect
          variant="table"
          class="column-name-select"
          :model-value="col.name"
          :options="columnNameOptions(col)"
          @update:model-value="updateColumn(idx, 'name', $event)"
        />
        <AppSelect
          variant="table"
          class="sort-select"
          :model-value="col.sort_order ?? ''"
          :options="sortOrderOptions"
          @update:model-value="updateColumn(idx, 'sort_order', $event)"
        />
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
            <AppSelect
              :model-value="col.mysql?.sort_order ?? ''"
              :options="sortOrderOptions"
              @update:model-value="setDbSortOrder(idx, 'mysql', $event)"
            />
          </div>
          <div class="db-override-group">
            <div class="db-label">PostgreSQL</div>
            <AppSelect
              :model-value="col.postgresql?.sort_order ?? ''"
              :options="sortOrderOptions"
              @update:model-value="setDbSortOrder(idx, 'postgresql', $event)"
            />
          </div>
          <div class="db-override-group">
            <div class="db-label">SQLite</div>
            <AppSelect
              :model-value="col.sqlite?.sort_order ?? ''"
              :options="sortOrderOptions"
              @update:model-value="setDbSortOrder(idx, 'sqlite', $event)"
            />
          </div>
        </div>
      </div>
    </div>
    <!-- Tail drop zone: shown only while dragging a column, supports dropping an item into the last column -->
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

/* Reuse the existing IndexTable styles */

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
