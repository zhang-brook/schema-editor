<script setup lang="ts" generic="T extends string">
/** 页面级 tab：下划线指示当前页，用于同层级的页内切换 */
defineProps<{
  modelValue: T
  options: { value: T; label: string }[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: T]
}>()
</script>

<template>
  <div class="page-tabs">
    <button
      v-for="opt in options"
      :key="opt.value"
      class="page-tab"
      :class="{ active: modelValue === opt.value }"
      type="button"
      @click="emit('update:modelValue', opt.value)"
    >{{ opt.label }}</button>
  </div>
</template>

<style scoped>
.page-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 18px;
}

.page-tab {
  padding: 9px 18px;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  background: none;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  color: var(--fg-muted);
  cursor: pointer;
  transition: color .15s ease, border-color .15s ease;
}

.page-tab:not(.active):hover {
  color: var(--fg);
}

.page-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}
</style>
