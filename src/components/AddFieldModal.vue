<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
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
        <select class="form-input" v-model="store.newFieldSelectCommon">
          <option value="">{{ $t('addFieldModal.selectPlaceholder') }}</option>
          <option
            v-for="name in store.commonFieldNames"
            :key="name"
            :value="name"
          >
            {{ name }} - {{ store.commonConfig!.common_used_fields[name]?.comment || '' }}
          </option>
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn" @click="store.showAddFieldModal = false">{{ $t('addFieldModal.cancel') }}</button>
        <button class="btn btn-primary" @click="store.confirmAddField()">{{ $t('addFieldModal.add') }}</button>
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
  max-width: 500px;
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
</style>
