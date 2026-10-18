<script setup lang="ts">
/** Segmented switch option */
export interface SegmentedOption {
  value: string
  label: string
  /** Hover tooltip (optional) */
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
  <!-- Segmented switch: adjacent buttons share borders, active option highlighted -->
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
  color: var(--accent-fg);
  border-color: var(--accent);
}

/* The button right after the active one takes the left border color so the divider stays continuous */
.segmented-btn.active + .segmented-btn {
  border-left-color: var(--accent);
}

.segmented-btn:not(.active):hover {
  background: var(--surface-3);
  color: var(--fg);
}
</style>
