<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEscClose } from '@/composables/useEscClose'
import { useEnterConfirm } from '@/composables/useEnterConfirm'

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
// 有取消按钮＝需决策（疑问），无取消＝纯提示（信息）
const iconGlyph = computed(() => (showCancel.value ? '?' : 'i'))
const iconClass = computed(() => (showCancel.value ? 'confirm-icon--warn' : 'confirm-icon--info'))

// ===== 键盘快捷键：ESC 取消，ENTER 确认 =====
// 弹窗由队列驱动、组件始终挂载，两个 composable 仅在 visible 时拦截按键；
// 焦点落在确认按钮上（如表格里的删除 × 触发的弹窗），避免回车重复触发原按钮。
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
        <button class="btn" :class="{ 'btn-primary': primaryConfirm }" ref="confirmBtn" @click="emit('confirm')">{{ confirmText }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped src="@/assets/style/modal.css"></style>
<style scoped src="@/assets/style/btn.css"></style>

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
  color: #fff;
}

.confirm-icon--info {
  background: var(--accent);
}

.confirm-icon--warn {
  background: var(--warning);
}

/* 覆盖 modal.css 中 .modal-box h3 的默认下边距，交给 header 控制间距 */
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
