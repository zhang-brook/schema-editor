<script setup lang="ts" generic="T extends string | number">
import { computed } from 'vue'
import {
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui'
import type { SelectOption } from './select-types'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  modelValue?: T | null
  options: SelectOption<T>[]
  placeholder?: string
  disabled?: boolean
  size?: 'md' | 'sm'
  variant?: 'form' | 'table' | 'plain'
  title?: string
  ariaLabel?: string
}>(), {
  placeholder: '',
  size: 'md',
  variant: 'form',
})

const emit = defineEmits<{
  'update:modelValue': [value: T]
}>()

// reka-ui forbids an empty string as an item value, so an explicit "empty" choice
// (e.g. custom type / no direction) is carried internally under a sentinel.
const EMPTY_VALUE = '__se_select_empty__'

const hasEmptyOption = computed(() => props.options.some(opt => opt.value === ''))

const internalValue = computed(() => {
  const value = props.modelValue
  if (value === '' || value === null || value === undefined) {
    return hasEmptyOption.value ? EMPTY_VALUE : undefined
  }
  return value
})

const items = computed(() =>
  props.options.map(opt => ({
    ...opt,
    key: opt.value === '' ? EMPTY_VALUE : opt.value,
  })),
)

// The popup content (and therefore SelectItem registration) only mounts when opened, so the
// selected label is resolved from the options instead of waiting for SelectValue's internal text.
const selectedLabel = computed(() => props.options.find(opt => opt.value === props.modelValue)?.label ?? '')

const triggerClass = computed(() => [
  'se-select-trigger',
  `se-select-trigger--${props.variant}`,
  props.size === 'sm' ? 'se-select-trigger--sm' : '',
])

function handleValueChange(value: unknown) {
  emit('update:modelValue', (value === EMPTY_VALUE ? '' : value) as T)
}
</script>

<template>
  <SelectRoot
    :model-value="internalValue"
    :disabled="disabled"
    @update:model-value="handleValueChange"
  >
    <SelectTrigger
      v-bind="$attrs"
      :class="triggerClass"
      :disabled="disabled"
      :title="title"
      :aria-label="ariaLabel"
    >
      <SelectValue
        class="se-select-value"
        :class="{ 'se-select-value--placeholder': !selectedLabel }"
      >{{ selectedLabel || placeholder }}</SelectValue>
      <svg class="se-select-chevron" viewBox="0 0 10 10" aria-hidden="true">
        <path
          d="M2 3.5 5 6.5 8 3.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </SelectTrigger>
    <SelectPortal>
      <SelectContent class="se-select-content" position="popper" :side-offset="4">
        <SelectViewport class="se-select-viewport">
          <SelectItem
            v-for="opt in items"
            :key="String(opt.key)"
            class="se-select-item"
            :value="opt.key"
            :disabled="opt.disabled"
            :text-value="opt.label"
          >
            {{ opt.label }}
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
