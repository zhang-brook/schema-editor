<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore } from '@/stores/editor'
import IndexColumnsEditor from './IndexColumnsEditor.vue'

const store = useEditorStore()

const availableFieldNames = computed(() => {
  if (!store.currentTable) return []
  return store.currentTable.fields.map(f => f.field_name)
})
</script>

<template>
  <div class="section-card" v-if="store.currentTable">
    <div class="section-header">
      {{ $t('indexTable.indexes') }}
      <span class="badge">{{ store.currentTable.indexes.length }}</span>
      <button class="btn btn-sm btn-primary" style="margin-left:auto;" @click="store.addIndex(store.currentTable!)">{{ $t('indexTable.addIndex') }}</button>
    </div>
    <div class="section-body" style="padding: 0; overflow-x: auto;">
      <table class="indexes-table" v-if="store.currentTable.indexes.length > 0">
        <thead>
          <tr>
            <th style="width:30px;"></th>
            <th>{{ $t('indexTable.name') }}</th>
            <th>{{ $t('indexTable.type') }}</th>
            <th>{{ $t('indexTable.columns') }}</th>
            <th>{{ $t('indexTable.using') }}</th>
            <th>{{ $t('indexTable.comment') }}</th>
            <th style="width:50px;">{{ $t('indexTable.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(index, iIdx) in store.currentTable.indexes" :key="iIdx">
            <tr>
              <td>
                <span class="expand-toggle" @click="store.toggleIndexExpand(store.indexKey(store.currentSchema!, store.currentTable!, index, iIdx))">
                  {{ store.expandedIndexes.has(store.indexKey(store.currentSchema!, store.currentTable!, index, iIdx)) ? '▼' : '▶' }}
                </span>
              </td>
              <td>
                <input class="table-input" v-model="index.name" :placeholder="$t('indexTable.namePlaceholder', { pre: '{pre}', post: '{post}' })" style="min-width:120px;">
              </td>
              <td>
                <select class="form-input" v-model="index.type" style="width:80px;">
                  <option value="index">index</option>
                  <option value="unique">unique</option>
                </select>
              </td>
              <td style="min-width:240px;">
                <IndexColumnsEditor v-model="index.columns" :available-fields="availableFieldNames" />
              </td>
              <td>
                <input class="table-input" v-model="index.using" style="width:60px;">
              </td>
              <td>
                <input class="table-input" v-model="index.comment" :placeholder="$t('indexTable.commentPlaceholder')" style="min-width:100px;">
              </td>
              <td>
                <button class="btn btn-sm btn-danger" @click="store.deleteIndex(store.currentTable!, iIdx)">×</button>
              </td>
            </tr>
            <!-- Expanded Index Detail -->
            <tr v-if="store.expandedIndexes.has(store.indexKey(store.currentSchema!, store.currentTable!, index, iIdx))">
              <td colspan="7">
                <div class="field-expand-content">
                  <div class="expand-section">
                    <div class="expand-section-title">{{ $t('indexTable.indexOverrides') }}</div>
                    <div class="db-override-grid">
                      <div class="db-override-group">
                        <div class="db-label">MySQL</div>
                        <select class="form-input" :value="store.getIndexOverrideValue(index, 'mysql', 'type')" @input="store.setIndexOverrideValue(index, 'mysql', 'type', ($event.target as HTMLSelectElement).value)">
                          <option value="">{{ $t('indexTable.typeSelect') }}</option>
                          <option value="index">index</option>
                          <option value="unique">unique</option>
                        </select>
                        <input class="form-input" placeholder="name" :value="store.getIndexOverrideValue(index, 'mysql', 'name')" @input="store.setIndexOverrideValue(index, 'mysql', 'name', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="using" :value="store.getIndexOverrideValue(index, 'mysql', 'using')" @input="store.setIndexOverrideValue(index, 'mysql', 'using', ($event.target as HTMLInputElement).value)">
                      </div>
                      <div class="db-override-group">
                        <div class="db-label">PostgreSQL</div>
                        <select class="form-input" :value="store.getIndexOverrideValue(index, 'postgresql', 'type')" @input="store.setIndexOverrideValue(index, 'postgresql', 'type', ($event.target as HTMLSelectElement).value)">
                          <option value="">{{ $t('indexTable.typeSelect') }}</option>
                          <option value="index">index</option>
                          <option value="unique">unique</option>
                        </select>
                        <input class="form-input" placeholder="name" :value="store.getIndexOverrideValue(index, 'postgresql', 'name')" @input="store.setIndexOverrideValue(index, 'postgresql', 'name', ($event.target as HTMLInputElement).value)">
                      </div>
                    </div>
                  </div>
                  <div class="expand-section">
                    <div class="expand-section-title">{{ $t('indexTable.preComment') }}</div>
                    <input class="form-input" v-model="index.pre_comment" :placeholder="$t('indexTable.preCommentPlaceholder')">
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <div v-else style="padding: 14px; color: #aaa; font-size: 12px; text-align: center;">
        {{ $t('indexTable.empty') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.indexes-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.indexes-table th,
.indexes-table td {
  padding: 6px 8px;
  border-bottom: 1px solid #eee;
  text-align: left;
  vertical-align: middle;
}

.indexes-table th {
  background: #f8f8f8;
  font-weight: 600;
  color: #555;
  font-size: 11px;
  white-space: nowrap;
}

.indexes-table tbody tr:hover {
  background: #f5f5f5;
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

</style>
