<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { useEscClose } from '@/composables/useEscClose'
import { displayFieldLength, displayFieldScale } from '@/utils/file-helpers'

const store = useEditorStore()

const orderedCommonFields = computed(() => store.getOrderedCommonUsedFields())

// ESC 关闭弹窗
useEscClose(computed(() => store.showAddFieldModal), () => { store.showAddFieldModal = false })
</script>

<template>
  <!-- ===== Add Field Modal ===== -->
  <div class="modal-overlay" v-if="store.showAddFieldModal" @click.self="store.showAddFieldModal = false">
    <div class="modal-box">
      <h3>{{ store.addFieldMode === 'common' ? $t('addFieldModal.addCommonRef') : $t('addFieldModal.addNewField') }}</h3>
      <div v-if="store.addFieldMode === 'normal'" class="form-group">
        <label class="form-label">{{ $t('addFieldModal.fieldName') }}</label>
        <input
          class="form-input"
          v-model="store.newFieldName"
          @keyup.enter="store.confirmAddField()"
          :placeholder="$t('addFieldModal.namePlaceholder')"
        />
      </div>
      <div v-if="store.addFieldMode === 'normal'" class="form-group">
        <label class="form-label">{{ $t('addFieldModal.fieldType') }}</label>
        <select class="form-input" v-model="store.newFieldUnifiedType">
          <option value="">{{ $t('addFieldModal.customType') }}</option>
          <option v-for="ut in store.unifiedTypeNames" :key="ut" :value="ut">{{ ut }}</option>
        </select>
      </div>
      <div v-else class="form-group">
        <label class="form-label">{{ $t('addFieldModal.selectCommonField') }}</label>
        <div class="common-field-list" v-if="orderedCommonFields.length > 0">
          <label
            v-for="field in orderedCommonFields"
            :key="field.field_name"
            class="common-field-item"
          >
            <input
              type="checkbox"
              :value="field.field_name"
              v-model="store.newFieldSelectCommons"
              class="common-field-checkbox"
            />
            <span class="common-field-name">{{ field.field_name }}</span>
            <span class="common-field-type">{{ field.unified_type || (field.field_type ? field.field_type + (field.field_length !== undefined ? '(' + displayFieldLength(field.field_length) + (field.field_scale !== undefined ? ',' + displayFieldScale(field.field_scale) : '') + ')' : '') : '') }}</span>
            <span class="common-field-comment" v-if="field.comment">{{ field.comment }}</span>
          </label>
        </div>
        <div v-else class="common-field-empty">{{ $t('addFieldModal.noCommonFields') }}</div>
      </div>
      <div class="modal-actions">
        <button class="btn" @click="store.showAddFieldModal = false">{{ $t('addFieldModal.cancel') }}</button>
        <button class="btn btn-primary" @click="store.confirmAddField()">{{ store.addFieldMode === 'common' ? $t('addFieldModal.confirm') : $t('addFieldModal.add') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ===== Modal Overlay ===== */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-box {
  background: #fff;
  border-radius: 8px;
  padding: 20px 24px;
  min-width: 360px;
  max-width: 560px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
}

.modal-box h3 {
  margin-bottom: 12px;
  font-size: 15px;
  color: #333;
}

.modal-box .form-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  margin-bottom: 12px;
}

.form-label {
  font-size: 11px;
  color: #888;
  font-weight: 500;
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

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  color: #333;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all .15s;
}

.btn:hover {
  background: #e8e8e8;
  border-color: #aaa;
}

.btn-primary {
  background: #4a90d9;
  color: #fff;
  border-color: #4a90d9;
}

.btn-primary:hover {
  background: #3a7bc8;
  border-color: #3a7bc8;
}

/* ===== Common Field List ===== */
.common-field-list {
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fafafa;
}

.common-field-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid #eee;
  cursor: pointer;
  user-select: none;
  transition: background .1s;
}

.common-field-item:last-child {
  border-bottom: none;
}

.common-field-item:hover {
  background: #e8f0fe;
}

.common-field-checkbox {
  width: 15px;
  height: 15px;
  cursor: pointer;
  flex-shrink: 0;
  accent-color: #4a90d9;
}

.common-field-name {
  font-weight: 600;
  font-size: 12px;
  color: #333;
  white-space: nowrap;
  min-width: 80px;
}

.common-field-type {
  font-size: 11px;
  color: #888;
  white-space: nowrap;
  font-family: 'Consolas', 'Monaco', monospace;
}

.common-field-comment {
  font-size: 11px;
  color: #aaa;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.common-field-empty {
  padding: 16px;
  text-align: center;
  color: #aaa;
  font-size: 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fafafa;
}
</style>
