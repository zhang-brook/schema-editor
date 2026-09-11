<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { useEscClose } from '@/composables/useEscClose'
import { useEnterConfirm } from '@/composables/useEnterConfirm'
import { displayFieldLength, displayFieldScale } from '@/utils/file-helpers'

const store = useEditorStore()

const orderedCommonFields = computed(() => store.getOrderedCommonUsedFields())

// 普通模式聚焦字段名输入框（可直接输入后回车），公共字段模式聚焦确认按钮
const nameInput = ref<HTMLInputElement | null>(null)
const confirmBtn = ref<HTMLButtonElement | null>(null)
const initialFocus = computed<HTMLElement | null>(() => (store.addFieldMode === 'normal' ? nameInput.value : confirmBtn.value))

// ESC 关闭弹窗
useEscClose(computed(() => store.showAddFieldModal), () => { store.showAddFieldModal = false })

// ENTER 确认添加
useEnterConfirm(computed(() => store.showAddFieldModal), () => store.confirmAddField(), initialFocus)
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
          ref="nameInput"
          v-model="store.newFieldName"
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
        <button class="btn btn-primary" ref="confirmBtn" @click="store.confirmAddField()">{{ store.addFieldMode === 'common' ? $t('addFieldModal.confirm') : $t('addFieldModal.add') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped src="@/assets/style/modal.css"></style>
<style scoped src="@/assets/style/btn.css"></style>
<style scoped src="@/assets/style/form.css"></style>
<style scoped>
.modal-box {
  background: var(--surface);
  border-radius: var(--radius-lg);
  padding: 22px 26px;
  min-width: 360px;
  max-width: 560px;
  box-shadow: var(--shadow-lg);
}

.modal-box .form-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  margin-bottom: 12px;
}


/* ===== Common Field List ===== */
.common-field-list {
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.common-field-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-muted);
  cursor: pointer;
  user-select: none;
  transition: background .1s;
}

.common-field-item:last-child {
  border-bottom: none;
}

.common-field-item:hover {
  background: var(--accent-subtle);
}

.common-field-checkbox {
  width: 15px;
  height: 15px;
  cursor: pointer;
  flex-shrink: 0;
  accent-color: var(--accent);
}

.common-field-name {
  font-weight: 600;
  font-size: 12px;
  color: var(--fg);
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
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}
</style>
