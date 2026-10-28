<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
import AppSelect from '@/components/ui/AppSelect.vue'
import type { TypeCaseMode } from 'schema-editor-core/types/schema'

const store = useEditorStore()
</script>

<template>
  <!-- Field Type Case -->
  <div class="section-card">
    <div class="section-header">{{ $t('commonConfig.typeCaseTitle') }}</div>
    <div class="section-body">
      <div class="form-row">
        <div class="form-group medium">
          <label class="form-label">{{ $t('commonConfig.typeCaseLabel') }}</label>
          <AppSelect
            :model-value="store.getCommonTypeCase()"
            :options="[
              { value: 'keep', label: $t('commonConfig.typeCaseOptions.keep') },
              { value: 'lowercase', label: $t('commonConfig.typeCaseOptions.lowercase') },
              { value: 'uppercase', label: $t('commonConfig.typeCaseOptions.uppercase') },
              { value: 'pascal', label: $t('commonConfig.typeCaseOptions.pascal') },
            ]"
            @update:model-value="store.setCommonTypeCase($event as TypeCaseMode)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

