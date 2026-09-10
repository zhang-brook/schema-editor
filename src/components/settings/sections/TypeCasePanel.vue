<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
import type { TypeCaseMode } from '@/types/schema'

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
          <select
            class="form-input"
            :value="store.getCommonTypeCase()"
            @change="store.setCommonTypeCase(($event.target as HTMLSelectElement).value as TypeCaseMode)"
          >
            <option value="keep">{{ $t('commonConfig.typeCaseOptions.keep') }}</option>
            <option value="lowercase">{{ $t('commonConfig.typeCaseOptions.lowercase') }}</option>
            <option value="uppercase">{{ $t('commonConfig.typeCaseOptions.uppercase') }}</option>
            <option value="pascal">{{ $t('commonConfig.typeCaseOptions.pascal') }}</option>
          </select>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="@/assets/style/section.css"></style>
<style scoped src="@/assets/style/form.css"></style>
