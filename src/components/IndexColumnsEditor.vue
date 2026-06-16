<script setup lang="ts">
import { ref, watch, reactive } from 'vue'
import type { IndexColumn } from '@/types/schema'

const props = defineProps<{
  modelValue: IndexColumn[]
  availableFields: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: IndexColumn[]]
}>()

// Per-column expanded state for db overrides
const expandedOverrides = reactive(new Set<number>())

function toggleOverride(idx: number) {
  if (expandedOverrides.has(idx)) {
    // 收起时清理空的 override 对象
    const col = props.modelValue[idx]
    if (col) {
      if (col.mysql && Object.keys(col.mysql).length === 0) delete col.mysql
      if (col.pgsql && Object.keys(col.pgsql).length === 0) delete col.pgsql
    }
    expandedOverrides.delete(idx)
  } else {
    // 展开时确保 override 对象存在
    const col = props.modelValue[idx]
    if (col) {
      if (!col.mysql) col.mysql = {}
      if (!col.pgsql) col.pgsql = {}
    }
    expandedOverrides.add(idx)
  }
}

function addColumn() {
  const newCols = [...props.modelValue, { name: '' }]
  emit('update:modelValue', newCols)
}

function removeColumn(idx: number) {
  const newCols = props.modelValue.filter((_, i) => i !== idx)
  if (newCols.length === 0) {
    newCols.push({ name: '' })
  }
  expandedOverrides.delete(idx)
  emit('update:modelValue', newCols)
}

function emitChange() {
  // Trigger parent update when any column property changes
  emit('update:modelValue', [...props.modelValue])
}

function setDbSortOrder(col: IndexColumn, db: 'mysql' | 'pgsql', val: string) {
  if (val) {
    if (!col[db]) col[db] = {}
    col[db]!.sort_order = val as 'ASC' | 'DESC'
  } else {
    if (col[db]) {
      delete col[db]!.sort_order
      if (Object.keys(col[db]!).length === 0) delete col[db]
    }
  }
  emitChange()
}

// Watch for external prop changes (e.g. when table switches)
watch(() => props.modelValue, () => {
  expandedOverrides.clear()
})
</script>

<template>
  <div class="index-columns-editor">
    <div class="column-row" v-for="(col, idx) in modelValue" :key="idx">
      <div class="column-main">
        <select
          class="form-input column-name-select"
          v-model="col.name"
          @change="emitChange"
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
          @change="col.sort_order = (($event.target as HTMLSelectElement).value || undefined) as any; emitChange()"
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
              @change="setDbSortOrder(col, 'mysql', ($event.target as HTMLSelectElement).value)"
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
              :value="col.pgsql?.sort_order ?? ''"
              @change="setDbSortOrder(col, 'pgsql', ($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ $t('indexColumnsEditor.noDirection') }}</option>
              <option value="ASC">ASC</option>
              <option value="DESC">DESC</option>
            </select>
          </div>
        </div>
      </div>
    </div>
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
  background: #e8f0fe;
  border-color: #4a90d9;
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
  color: #888;
  text-transform: uppercase;
}

/* 复用 IndexTable 已有样式 */
.table-input {
  padding: 3px 5px;
  border: 1px solid #ddd;
  border-radius: 3px;
  font-size: 12px;
  font-family: inherit;
  box-sizing: border-box;
}

.table-input:focus {
  outline: none;
  border-color: #4a90d9;
}

.form-input {
  padding: 2px 4px;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-size: 12px;
  font-family: inherit;
  color: #333;
}

.form-input:focus {
  outline: none;
  border-color: #4a90d9;
}

.btn {
  padding: 2px 6px;
  border: 1px solid #ccc;
  background: #fff;
  border-radius: 3px;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
  line-height: 1.4;
}

.btn:hover {
  background: #f5f5f5;
}

.btn-sm {
  padding: 1px 5px;
  font-size: 10px;
}

.btn-danger {
  color: #d32f2f;
  border-color: #d32f2f;
  padding: 1px 5px;
  font-size: 11px;
}

.btn-danger:hover {
  background: #ffebee;
}

.btn-add-col {
  align-self: flex-start;
  margin-top: 2px;
  color: #4a90d9;
  border-color: #4a90d9;
}

.btn-add-col:hover {
  background: #e8f0fe;
}
</style>
