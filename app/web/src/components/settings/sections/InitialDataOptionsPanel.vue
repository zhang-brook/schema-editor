<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
import AppSelect from '@/components/ui/AppSelect.vue'
import type { InitialDataInsertMode } from 'schema-editor-core/types/schema'

const store = useEditorStore()
</script>

<template>
  <!-- Initial data generation options -->
  <div class="section-card">
    <div class="section-header">{{ $t('commonConfig.initialDataOptionsTitle') }}</div>
    <div class="section-body">
      <div class="form-row">
        <div class="form-group medium">
          <label class="form-label">{{ $t('commonConfig.initialDataModeLabel') }}</label>
          <AppSelect
            :model-value="store.getGlobalInitialDataInsertMode()"
            :options="[
              { value: 'insert', label: $t('initialData.insertModeInsert') },
              { value: 'ignore', label: $t('initialData.insertModeIgnore') },
              { value: 'overwrite', label: $t('initialData.insertModeOverwrite') },
            ]"
            @update:model-value="store.setGlobalInitialDataInsertMode($event as InitialDataInsertMode)"
          />
          <div class="form-hint">{{ $t('commonConfig.initialDataModeHint') }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.form-hint {
  margin-top: 6px;
  font-size: 11px;
  color: var(--fg-subtle);
}
</style>
