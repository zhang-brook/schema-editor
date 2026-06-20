<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import { getInitialDataPreSql, getInitialDataPostSql, fmtPrePostSql } from '@/utils/sql-generator/shared'
import { generateInitialDataMySQL } from '@/utils/sql-generator/mysql'
import { generateInitialDataPostgreSQL } from '@/utils/sql-generator/postgresql'
import type { SqlDialect } from '@/utils/sql-generator/shared'

const store = useEditorStore()
const { t } = useI18n()

const dialect = ref<SqlDialect>('mysql')

const previewSql = computed(() => {
  const table = store.currentTable
  const schema = store.currentSchema
  const data = store.currentInitialData
  if (!table || !data) return ''

  const dbDialect = dialect.value === 'postgresql' ? 'pgsql' : 'mysql'
  const preSql = getInitialDataPreSql(data, dbDialect)
  const postSql = getInitialDataPostSql(data, dbDialect)
  const hasRows = (data.rows?.length ?? 0) > 0

  let sql = ''
  if (preSql) sql += fmtPrePostSql(preSql) + '\n'
  if (hasRows) {
    if (dialect.value === 'mysql') {
      sql += generateInitialDataMySQL(table, data.rows!, data.row_comments)
    } else {
      const schemaName = schema?.schema || 'public'
      sql += generateInitialDataPostgreSQL(table, schemaName, data.rows!, data.row_comments, store.commonConfig)
    }
  }
  if (postSql) sql += '\n' + fmtPrePostSql(postSql)

  return sql.trimEnd()
})

function copyToClipboard() {
  if (!previewSql.value) return
  navigator.clipboard.writeText(previewSql.value).then(() => {
    store.showToast(t('toast.sqlCopied'))
  })
}
</script>

<template>
  <div class="section-card">
    <div class="section-header">
      <div class="header-tabs">
        <div style="margin-right: 15px;">
          <span>{{ $t('initialData.sqlPreview') }}</span>
        </div>
        <div class="tab-group">
          <button class="tab-btn" :class="{ active: dialect === 'mysql' }" @click="dialect = 'mysql'">MySQL</button>
          <button class="tab-btn" :class="{ active: dialect === 'postgresql' }" @click="dialect = 'postgresql'">PostgreSQL</button>
        </div>
      </div>
      <div class="header-right">
        <button class="btn btn-sm" @click="copyToClipboard" :disabled="!previewSql" :title="$t('sqlPreview.copyTitle')">{{ $t('sqlPreview.copy') }}</button>
      </div>
    </div>
    <div class="section-body">
      <pre v-if="previewSql" class="sql-code"><code>{{ previewSql }}</code></pre>
      <div v-else class="empty-state">{{ $t('initialData.sqlPreviewEmpty') }}</div>
    </div>
  </div>
</template>

<style scoped>
.section-card {
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 6px;
  margin-bottom: 16px;
  overflow: hidden;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #fafafa;
  border-bottom: 1px solid #eee;
  font-weight: 600;
  font-size: 13px;
  color: #444;
}

.header-tabs {
  display: flex;
  gap: 0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tab-group {
  display: flex;
  gap: 0;
}

.tab-btn {
  padding: 3px 10px;
  border: 1px solid #ccc;
  background: #fff;
  color: #666;
  font-size: 11px;
  cursor: pointer;
  transition: all .15s;
  font-family: inherit;
}

.tab-btn:first-child {
  border-radius: 3px 0 0 3px;
}

.tab-btn:last-child {
  border-radius: 0 3px 3px 0;
  border-left: none;
}

.tab-btn.active {
  background: #4a90d9;
  color: #fff;
  border-color: #4a90d9;
}

.tab-btn.active + .tab-btn {
  border-left-color: #4a90d9;
}

.tab-btn:not(.active):hover {
  background: #e8e8e8;
}

.btn {
  padding: 4px 10px;
  border: 1px solid #ccc;
  background: #fff;
  border-radius: 3px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}

.btn:hover {
  background: #f5f5f5;
}

.btn-sm {
  padding: 2px 6px;
  font-size: 11px;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.section-body {
  padding: 0;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px;
  color: #aaa;
  font-size: 12px;
}

.sql-code {
  margin: 0;
  padding: 12px 14px;
  background: #1e1e2e;
  color: #cdd6f4;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre;
  max-height: 400px;
  overflow-y: auto;
}

.sql-code::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.sql-code::-webkit-scrollbar-track {
  background: #1e1e2e;
}

.sql-code::-webkit-scrollbar-thumb {
  background: #555;
  border-radius: 3px;
}

.sql-code::-webkit-scrollbar-thumb:hover {
  background: #777;
}
</style>
