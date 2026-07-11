<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
import { getGlobalPreSql, getGlobalPostSql } from '@/utils/sql-generator/shared'
import CommonUsedFieldsPanel from './panel/CommonUsedFieldsPanel.vue'
import UnifiedTypesPanel from './panel/UnifiedTypesPanel.vue'
import PrePostSqlEditor from './PrePostSqlEditor.vue'

const store = useEditorStore()
</script>

<template>
  <!-- ===== Common Config Panel ===== -->
  <template v-if="store.showCommonPanel && store.commonConfig">
    <UnifiedTypesPanel />

    <!-- Default MySQL Table Config -->
    <div class="section-card">
      <div class="section-header">{{ $t('commonConfig.defaultMysqlConfig') }}</div>
      <div class="section-body">
        <div class="form-row">
          <div class="form-group medium">
            <label class="form-label">{{ $t('commonConfig.engine') }}</label>
            <input
              class="form-input"
              :value="store.getCommonMysqlEngine()"
              @input="store.setCommonMysqlEngine(($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="form-group medium">
            <label class="form-label">{{ $t('commonConfig.charset') }}</label>
            <input
              class="form-input"
              :value="store.getCommonMysqlCharset()"
              @input="store.setCommonMysqlCharset(($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="form-group medium">
            <label class="form-label">{{ $t('commonConfig.collation') }}</label>
            <input
              class="form-input"
              :value="store.getCommonMysqlCollation()"
              @input="store.setCommonMysqlCollation(($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Default PostgreSQL Config -->
    <div class="section-card">
      <div class="section-header">{{ $t('commonConfig.defaultPostgresqlConfig') }}</div>
      <div class="section-body">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">{{ $t('commonConfig.quoteIdentifiers') }}</label>
            <div class="toggle-row">
              <label class="toggle-switch">
                <input
                  type="checkbox"
                  :checked="store.getCommonPostgresqlQuoteIdentifiers()"
                  @change="store.setCommonPostgresqlQuoteIdentifiers(($event.target as HTMLInputElement).checked)"
                />
                <span class="toggle-slider"></span>
              </label>
              <span class="toggle-hint">{{ $t('commonConfig.quoteIdentifiersHint') }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

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
                  @change="store.setTableDdlMode(opt.value as any)"
                />
                <span class="radio-label">{{ opt.label }}</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Pre/Post SQL -->
    <PrePostSqlEditor
      :title="$t('commonConfig.prePostSql')"
      :pre-placeholder="$t('commonConfig.preSqlPlaceholder')"
      :post-placeholder="$t('commonConfig.postSqlPlaceholder')"
      :mysql-pre="getGlobalPreSql(store.commonConfig, 'mysql')"
      :mysql-post="getGlobalPostSql(store.commonConfig, 'mysql')"
      :postgresql-pre="getGlobalPreSql(store.commonConfig, 'postgresql')"
      :postgresql-post="getGlobalPostSql(store.commonConfig, 'postgresql')"
      @update:mysql-pre="store.setGlobalPreSql('mysql', $event)"
      @update:mysql-post="store.setGlobalPostSql('mysql', $event)"
      @update:postgresql-pre="store.setGlobalPreSql('postgresql', $event)"
      @update:postgresql-post="store.setGlobalPostSql('postgresql', $event)"
    />

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
              @change="store.setCommonTypeCase(($event.target as HTMLSelectElement).value as any)"
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

    <CommonUsedFieldsPanel />
  </template>
</template>

<style scoped src="@/assets/style/section.css"></style>
<style scoped src="@/assets/style/form.css"></style>
<style scoped>
/* Toggle switch */
.toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  border-radius: 20px;
  transition: .2s;
}

.toggle-slider::before {
  content: "";
  position: absolute;
  height: 14px;
  width: 14px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  border-radius: 50%;
  transition: .2s;
}

.toggle-switch input:checked + .toggle-slider {
  background-color: #4a90d9;
}

.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(16px);
}

.toggle-hint {
  font-size: 11px;
  color: #888;
}

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
  color: #333;
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  transition: border-color .15s, background .15s;
}

.radio-option:hover {
  border-color: #4a90d9;
  background: #f5f9ff;
}

.radio-option input[type="radio"] {
  accent-color: #4a90d9;
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
