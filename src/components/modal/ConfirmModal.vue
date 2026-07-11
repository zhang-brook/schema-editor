<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  /** 是否显示弹窗 */
  visible: boolean
  /** 标题文本（已翻译后的字符串，直接显示） */
  title: string
  /** 正文消息，支持 \n 换行 */
  message: string
  /** 确认按钮文本 */
  confirmText?: string
  /** 取消按钮文本；为空则不显示取消按钮 */
  cancelText?: string
  /** 确认按钮是否使用主色调（默认 true） */
  primaryConfirm?: boolean
}>(), {
  confirmText: 'OK',
  cancelText: '',
  primaryConfirm: true,
})

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

const showCancel = computed(() => !!props.cancelText)
</script>

<template>
  <!-- ===== Generic Confirm Modal ===== -->
  <div class="modal-overlay" v-if="visible" @click.self="emit('cancel')">
    <div class="modal-box confirm-box">
      <h3>{{ title }}</h3>
      <p class="confirm-message">{{ message }}</p>
      <div class="modal-actions">
        <button v-if="showCancel" class="btn" @click="emit('cancel')">{{ cancelText }}</button>
        <button class="btn" :class="{ 'btn-primary': primaryConfirm }" @click="emit('confirm')">{{ confirmText }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm-box {
  max-width: 480px;
}

.confirm-message {
  white-space: pre-line;
  line-height: 1.6;
  color: #475569;
  font-size: 14px;
  margin: 8px 0 20px;
}
</style>
