<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

const props = withDefaults(defineProps<{ modelValue?: string | null }>(), {
  modelValue: '',
})
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const editing = ref(false)
const taRef = ref<HTMLTextAreaElement | null>(null)

const value = computed(() => props.modelValue ?? '')

/** Whether it contains newlines: the collapsed state shows ↵ to hint at more lines */
const hasMoreLines = computed(() => value.value.includes('\n'))

/** The collapsed state shows only the first line to keep table rows from growing taller */
const previewText = computed(() => value.value.split('\n')[0] ?? '')

let closeTimer: ReturnType<typeof setTimeout> | undefined

async function openEditor() {
  clearTimer()
  editing.value = true
  await nextTick()
  const ta = taRef.value
  if (ta) {
    ta.focus()
    const len = ta.value.length
    ta.setSelectionRange(len, len)
    autoResize(ta)
  }
}

/** Collapse after a blur delay so row-height changes do not interrupt an in-progress click */
function onBlur() {
  clearTimer()
  closeTimer = setTimeout(() => {
    editing.value = false
  }, 150)
}

function onFocus() {
  clearTimer()
}

function onEsc() {
  clearTimer()
  editing.value = false
}

function clearTimer() {
  if (closeTimer !== undefined) {
    clearTimeout(closeTimer)
    closeTimer = undefined
  }
}

function onInput(e: Event) {
  const ta = e.target as HTMLTextAreaElement
  emit('update:modelValue', ta.value)
  autoResize(ta)
}

/** Auto-fit the height to the content (capped to avoid breaking the layout) */
function autoResize(ta: HTMLTextAreaElement) {
  ta.style.height = 'auto'
  ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`
}
</script>

<template>
  <div class="comment-cell">
    <!-- Collapsed state: click to expand into multi-line editing -->
    <div
      v-if="!editing"
      class="comment-cell-preview"
      tabindex="0"
      role="button"
      :title="value"
      @click="openEditor"
      @keydown.enter.prevent="openEditor"
      @keydown.space.prevent="openEditor"
    >
      <span class="preview-text">{{ previewText }}</span>
      <span v-if="hasMoreLines" class="preview-more">↵</span>
    </div>
    <!-- Editing state: multi-line input (newlines supported) -->
    <textarea
      v-else
      ref="taRef"
      class="comment-cell-editor"
      :value="value"
      spellcheck="false"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @keydown.esc="onEsc"
    ></textarea>
  </div>
</template>

<style scoped>
.comment-cell {
  min-width: 120px;
}

.comment-cell-preview {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 22px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  cursor: text;
  box-sizing: border-box;
  transition: border-color 0.12s;
}

.comment-cell-preview:hover,
.comment-cell-preview:focus {
  border-color: var(--accent);
}

.comment-cell-preview:focus {
  outline: none;
}

.preview-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.preview-more {
  flex-shrink: 0;
  color: var(--accent);
  font-size: 11px;
  line-height: 1;
  opacity: 0.85;
}

.comment-cell-editor {
  box-sizing: border-box;
  width: 100%;
  min-width: 140px;
  padding: 4px 6px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--fg);
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  max-height: 220px;
}

.comment-cell-editor:focus {
  outline: none;
}
</style>
