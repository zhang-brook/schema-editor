<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
import type { TableDdlMode } from '@/types/schema'

const store = useEditorStore()
</script>

<template>
  <!-- DDL 生成选项 -->
  <div class="section-card">
    <div class="section-header">{{ $t('commonConfig.ddlOptionsTitle') }}</div>
    <div class="section-body">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">{{ $t('commonConfig.ddlModeLabel') }}</label>
          <div class="radio-group">
            <label class="radio-option" v-for="opt in [
              { value: 'create', label: $t('commonConfig.ddlModeCreate') },
              { value: 'drop_and_create', label: $t('commonConfig.ddlModeDropAndCreate') },
              { value: 'create_if_not_exists', label: $t('commonConfig.ddlModeCreateIfNotExists') },
            ]" :key="opt.value">
              <input
                type="radio"
                name="tableDdlMode"
                :value="opt.value"
                :checked="store.getTableDdlMode() === opt.value"
                @change="store.setTableDdlMode(opt.value as TableDdlMode)"
              />
              <span class="radio-label">{{ opt.label }}</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="@/assets/style/section.css"></style>
<style scoped src="@/assets/style/form.css"></style>
<style scoped>
/* Radio group (DDL mode) */
.radio-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.radio-option {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 12px;
  color: var(--fg);
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  transition: border-color .15s, background .15s;
}

.radio-option:hover {
  border-color: var(--accent);
  background: #f5f9ff;
}

.radio-option input[type="radio"] {
  accent-color: var(--accent);
  width: 16px;
  height: 16px;
  cursor: pointer;
  flex-shrink: 0;
}

.radio-label {
  font-size: 12px;
  color: #444;
  font-family: 'Consolas', 'Monaco', monospace;
}
</style>
