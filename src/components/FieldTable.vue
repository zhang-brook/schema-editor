<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
import { displayDefault, displayFieldLength, parseDefaultInput, parseFieldLengthInput } from '@/utils/file-helpers'

const store = useEditorStore()
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
            <th style="width:30px;"></th>
            <th>{{ $t('fieldTable.fieldName') }}</th>
            <th>{{ $t('fieldTable.type') }}</th>
            <th>{{ $t('fieldTable.length') }}</th>
            <th style="width:40px;">{{ $t('fieldTable.nn') }}</th>
            <th style="width:40px;">{{ $t('fieldTable.pk') }}</th>
            <th>{{ $t('fieldTable.default') }}</th>
            <th>{{ $t('fieldTable.comment') }}</th>
            <th style="width:40px;">{{ $t('fieldTable.removed') }}</th>
            <th style="width:90px;">{{ $t('fieldTable.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(field, fIdx) in store.currentTable.fields" :key="field.field_name + fIdx">
            <tr :class="{
              'common-field-row': store.isCommonField(field),
              'commented-out-row': store.getResolvedField(field).is_commented_out
            }">
              <td>
                <span class="expand-toggle" @click="store.toggleFieldExpand(store.fieldKey(store.currentSchema!, store.currentTable!, field))">
                  {{ store.expandedFields.has(store.fieldKey(store.currentSchema!, store.currentTable!, field)) ? '▼' : '▶' }}
                </span>
              </td>
              <td>
                <div class="field-name-cell">
                  <span v-if="store.isCommonField(field)" class="common-badge">C</span>
                  <span v-if="store.getResolvedField(field).is_commented_out" class="commented-badge">~</span>
                  <input v-if="!store.isCommonField(field)" class="table-input" v-model="field.field_name" style="min-width:80px;">
                  <span v-else style="font-weight:500;">{{ field.field_name }}</span>
                </div>
              </td>
              <td>
                <template v-if="store.isCommonField(field)">
                  {{ store.getResolvedField(field).field_type || '-' }}
                </template>
                <input v-else class="table-input" v-model="field.field_type" style="min-width:60px;">
              </td>
              <td>
                <template v-if="store.isCommonField(field)">
                  {{ displayFieldLength(store.getResolvedField(field).field_length) || '-' }}
                </template>
                <input v-else class="table-input" :value="displayFieldLength(field.field_length)" @input="field.field_length = parseFieldLengthInput(($event.target as HTMLInputElement).value)" style="width:50px;">
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
              <td colspan="10">
                <div class="field-expand-content">
                  <!-- MySQL/PGSQL Override -->
                  <div class="expand-section" v-if="!store.isCommonField(field)">
                    <div class="expand-section-title">{{ $t('fieldTable.dbOverrides') }}</div>
                    <div class="db-override-grid">
                      <div class="db-override-group">
                        <div class="db-label">{{ $t('fieldTable.mysql') }}</div>
                        <input class="form-input" placeholder="field_type" :value="store.getFieldOverrideValue(field, 'mysql', 'field_type')" @input="store.setFieldOverrideValue(field, 'mysql', 'field_type', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="field_length" :value="store.getFieldOverrideValue(field, 'mysql', 'field_length')" @input="store.setFieldOverrideValue(field, 'mysql', 'field_length', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="default" :value="store.getFieldOverrideValue(field, 'mysql', 'default')" @input="store.setFieldOverrideValue(field, 'mysql', 'default', ($event.target as HTMLInputElement).value)">
                      </div>
                      <div class="db-override-group">
                        <div class="db-label">{{ $t('fieldTable.postgresql') }}</div>
                        <input class="form-input" placeholder="field_type" :value="store.getFieldOverrideValue(field, 'pgsql', 'field_type')" @input="store.setFieldOverrideValue(field, 'pgsql', 'field_type', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="field_length" :value="store.getFieldOverrideValue(field, 'pgsql', 'field_length')" @input="store.setFieldOverrideValue(field, 'pgsql', 'field_length', ($event.target as HTMLInputElement).value)">
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
</style>
