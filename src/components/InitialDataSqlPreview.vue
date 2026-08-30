<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import { getInitialDataPreSql, getInitialDataPostSql, fmtPrePostSql, filterInitialDataRows } from '@/utils/sql-generator/shared'
import { generateInitialDataMySQL } from '@/utils/sql-generator/mysql'
import { generateInitialDataPostgreSQL } from '@/utils/sql-generator/postgresql'
import { generateInitialDataSQLite } from '@/utils/sql-generator/sqlite'
import type { SqlDialect } from '@/utils/sql-generator/shared'

const store = useEditorStore()
const { t } = useI18n()

const dialect = ref<SqlDialect>('mysql')

const previewSql = computed(() => {
  const table = store.currentTable
  const schema = store.currentSchema
  const data = store.currentInitialData
  if (!table || !data) return ''

  const preSql = getInitialDataPreSql(data, dialect.value)
  const postSql = getInitialDataPostSql(data, dialect.value)

  // 先过滤掉「不生成」的行，得到有效数据行
  const filtered = filterInitialDataRows(data.rows)

  let sql = ''
  if (preSql) sql += fmtPrePostSql(preSql) + '\n'
  if (filtered.hasRows) {
    if (dialect.value === 'mysql') {
      sql += generateInitialDataMySQL(table, filtered.rows, filtered.rowComments)
    } else if (dialect.value === 'postgresql') {
      const schemaName = schema?.schema || 'public'
      sql += generateInitialDataPostgreSQL(table, schemaName, filtered.rows, filtered.rowComments, store.commonConfig)
    } else if (dialect.value === 'sqlite') {
      sql += generateInitialDataSQLite(table, filtered.rows, filtered.rowComments, store.commonConfig)
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
          <button class="tab-btn" :class="{ active: dialect === 'postgresql' }"
            @click="dialect = 'postgresql'">PostgreSQL</button>
          <button class="tab-btn" :class="{ active: dialect === 'sqlite' }" @click="dialect = 'sqlite'">SQLite</button>
        </div>
      </div>
      <div class="header-right">
        <button class="btn btn-sm" @click="copyToClipboard" :disabled="!previewSql"
          :title="$t('sqlPreview.copyTitle')">{{ $t('sqlPreview.copy') }}</button>
      </div>
    </div>
    <div class="section-body">
      <pre v-if="previewSql" class="sql-code"><code>{{ previewSql }}</code></pre>
      <div v-else class="empty-state">{{ $t('initialData.sqlPreviewEmpty') }}</div>
    </div>
  </div>
</template>

<style scoped src="@/assets/style/section.css"></style>
<style scoped src="@/assets/style/btn.css"></style>
<style scoped>
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
  padding: 4px 12px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--fg-muted);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background .15s ease, color .15s ease, border-color .15s ease;
  font-family: inherit;
}

.tab-btn:first-child {
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.tab-btn:last-child {
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  border-left: none;
}

.tab-btn.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.tab-btn.active+.tab-btn {
  border-left-color: var(--accent);
}

.tab-btn:not(.active):hover {
  background: var(--surface-3);
  color: var(--fg);
}

.btn {
  padding: 4px 10px;
  border: 1px solid var(--border);
  background: #fff;
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}

.btn:hover {
  background: var(--surface-2);
}

.btn-sm {
  padding: 2px 6px;
  font-size: 11px;
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
  padding: 14px 16px;
  background: var(--code-bg);
  color: var(--code-fg);
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.65;
  overflow-x: auto;
  white-space: pre;
  max-height: 400px;
  overflow-y: auto;
}

.sql-code::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

.sql-code::-webkit-scrollbar-track {
  background: var(--code-bg);
}

.sql-code::-webkit-scrollbar-thumb {
  background: var(--code-thumb);
  border-radius: var(--radius-pill);
  border: 2px solid var(--code-bg);
  background-clip: padding-box;
}

.sql-code::-webkit-scrollbar-thumb:hover {
  background: var(--fg-subtle);
}
</style>
