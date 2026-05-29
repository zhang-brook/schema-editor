<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
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
              <td>
                <input class="table-input" :value="store.indexColumnsText(index)" @input="store.setIndexColumns(index, ($event.target as HTMLInputElement).value)" style="min-width:120px;">
              </td>
              <td>
                <input class="table-input" v-model="index.using" style="width:60px;">
              </td>
              <td>
                <button class="btn btn-sm btn-danger" @click="store.deleteIndex(store.currentTable!, iIdx)">×</button>
              </td>
            </tr>
            <!-- Expanded Index Detail -->
            <tr v-if="store.expandedIndexes.has(store.indexKey(store.currentSchema!, store.currentTable!, index, iIdx))">
              <td colspan="6">
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
                        <select class="form-input" :value="store.getIndexOverrideValue(index, 'pgsql', 'type')" @input="store.setIndexOverrideValue(index, 'pgsql', 'type', ($event.target as HTMLSelectElement).value)">
                          <option value="">{{ $t('indexTable.typeSelect') }}</option>
                          <option value="index">index</option>
                          <option value="unique">unique</option>
                        </select>
                        <input class="form-input" placeholder="name" :value="store.getIndexOverrideValue(index, 'pgsql', 'name')" @input="store.setIndexOverrideValue(index, 'pgsql', 'name', ($event.target as HTMLInputElement).value)">
                      </div>
                    </div>
                  </div>
                  <div class="expand-section">
                    <div class="expand-section-title">{{ $t('indexTable.preComment') }}</div>
                    <input class="form-input" v-model="index.pre_comment" :placeholder="$t('indexTable.commentPlaceholder')">
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

.expand-toggle {
  cursor: pointer;
  font-size: 10px;
  color: #888;
  user-select: none;
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
</style>
