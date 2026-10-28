<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEscClose } from '@/composables/useEscClose'
import { useEnterConfirm } from '@/composables/useEnterConfirm'

const props = withDefaults(defineProps<{
  /** Whether the modal is visible */
  visible: boolean
  /** Title text (already translated string, displayed as is) */
  title: string
  /** Body message; supports \n line breaks */
  message: string
  /** Confirm button text */
  confirmText?: string
  /** Secondary button text; hidden when empty (e.g. "Don't Save") */
  secondaryText?: string
  /** Cancel button text; hides the cancel button when empty */
  cancelText?: string
  /** Whether the confirm button uses the primary color (default true) */
  primaryConfirm?: boolean
}>(), {
  confirmText: 'OK',
  secondaryText: '',
  cancelText: '',
  primaryConfirm: true,
})

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'secondary'): void
  (e: 'cancel'): void
}>()

const showCancel = computed(() => !!props.cancelText)
// With cancel button = decision required (question); without = plain notice (info)
const iconGlyph = computed(() => (showCancel.value ? '?' : 'i'))
const iconClass = computed(() => (showCancel.value ? 'confirm-icon--warn' : 'confirm-icon--info'))

// ===== Keyboard shortcuts: ESC cancels, ENTER confirms =====
// The modal is queue-driven and the component stays mounted, so both composables only intercept keys when visible;
// focus lands on the confirm button (e.g. a modal triggered by a delete × in a table) to avoid Enter re-triggering the original button.
const confirmBtn = ref<HTMLButtonElement | null>(null)
const visibleFlag = computed(() => props.visible)

useEscClose(visibleFlag, () => emit('cancel'))
useEnterConfirm(visibleFlag, () => emit('confirm'), confirmBtn)
</script>

<template>
  <!-- ===== Generic Confirm / Alert Modal ===== -->
  <div class="modal-overlay" v-if="visible" @click.self="emit('cancel')">
    <div class="modal-box confirm-box" role="dialog" aria-modal="true">
      <div class="confirm-header">
        <span class="confirm-icon" :class="iconClass" aria-hidden="true">{{ iconGlyph }}</span>
        <h3 class="confirm-title">{{ title }}</h3>
      </div>
      <p class="confirm-message">{{ message }}</p>
      <div class="modal-actions">
        <button v-if="showCancel" class="btn" @click="emit('cancel')">{{ cancelText }}</button>
        <button v-if="secondaryText" class="btn" @click="emit('secondary')">{{ secondaryText }}</button>
        <button class="btn" :class="{ 'btn-primary': primaryConfirm }" ref="confirmBtn" @click="emit('confirm')">{{ confirmText }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm-box {
  max-width: 440px;
}

.confirm-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
}

.confirm-icon {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
  color: var(--accent-fg);
}

.confirm-icon--info {
  background: var(--accent);
}

.confirm-icon--warn {
  background: var(--warning);
  color: var(--warning-fg);
}

/* Override the default bottom margin of .modal-box h3 in modal.css; spacing is controlled by the header */
.modal-box .confirm-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--fg);
}

.confirm-message {
  white-space: pre-line;
  line-height: 1.6;
  color: var(--fg-muted);
  font-size: 14px;
  margin: 0 0 20px;
  padding-left: 46px;
}
</style>
