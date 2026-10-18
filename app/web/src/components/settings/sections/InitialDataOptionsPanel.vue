<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
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
          <select
            class="form-input"
            :value="store.getGlobalInitialDataInsertMode()"
            @change="store.setGlobalInitialDataInsertMode(($event.target as HTMLSelectElement).value as InitialDataInsertMode)"
          >
            <option value="insert">{{ $t('initialData.insertModeInsert') }}</option>
            <option value="ignore">{{ $t('initialData.insertModeIgnore') }}</option>
            <option value="overwrite">{{ $t('initialData.insertModeOverwrite') }}</option>
          </select>
          <div class="form-hint">{{ $t('commonConfig.initialDataModeHint') }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="@/assets/style/section.css"></style>
<style scoped src="@/assets/style/form.css"></style>
<style scoped>
.form-hint {
  margin-top: 6px;
  font-size: 11px;
  color: var(--fg-subtle);
}
</style>
