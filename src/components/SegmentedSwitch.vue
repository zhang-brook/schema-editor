<script setup lang="ts">
/** 分段切换项 */
export interface SegmentedOption {
  value: string
  label: string
  /** 悬停提示（可选） */
  title?: string
}

const props = defineProps<{
  modelValue: string
  options: SegmentedOption[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

function select(opt: SegmentedOption) {
  if (opt.value !== props.modelValue) emit('update:modelValue', opt.value)
}
</script>

<template>
  <!-- 分段切换：相邻按钮共享边框，选中项高亮 -->
  <div class="segmented">
    <button
      v-for="opt in options"
      :key="opt.value"
      class="segmented-btn"
      :class="{ active: modelValue === opt.value }"
      :title="opt.title"
      type="button"
      @click="select(opt)"
    >{{ opt.label }}</button>
  </div>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  flex-shrink: 0;
}

.segmented-btn {
  padding: 4px 12px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--fg-muted);
  font-size: 11px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: background .15s ease, color .15s ease, border-color .15s ease;
}

.segmented-btn:first-child {
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.segmented-btn:last-child {
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.segmented-btn + .segmented-btn {
  border-left: none;
}

.segmented-btn.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

/* 选中项右侧相邻按钮补齐左边框颜色，保持分隔线连续 */
.segmented-btn.active + .segmented-btn {
  border-left-color: var(--accent);
}

.segmented-btn:not(.active):hover {
  background: var(--surface-3);
  color: var(--fg);
}
</style>
