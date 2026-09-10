<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import { useEnabledDialect } from '@/composables/useEnabledDialect'
import SegmentedSwitch from '@/components/ui/SegmentedSwitch.vue'
import { getInitialDataPreSql, getInitialDataPostSql, fmtPrePostSql, filterInitialDataRows } from '@/utils/sql-generator/shared'
import { generateInitialDataMySQL } from '@/utils/sql-generator/mysql'
import { generateInitialDataPostgreSQL } from '@/utils/sql-generator/postgresql'
import { generateInitialDataSQLite } from '@/utils/sql-generator/sqlite'

const store = useEditorStore()
const { t } = useI18n()
const { dialectOptions, activeDialect } = useEnabledDialect()

const previewSql = computed(() => {
  const table = store.currentTable
  const schema = store.currentSchema
  const data = store.currentInitialData
  if (!table || !data) return ''

  const preSql = getInitialDataPreSql(data, activeDialect.value)
  const postSql = getInitialDataPostSql(data, activeDialect.value)

  // 先过滤掉「不生成」的行，得到有效数据行
  const filtered = filterInitialDataRows(data.rows)

  let sql = ''
  if (preSql) sql += fmtPrePostSql(preSql) + '\n'
  if (filtered.hasRows) {
    if (activeDialect.value === 'mysql') {
      sql += generateInitialDataMySQL(table, filtered.rows, filtered.rowComments)
    } else if (activeDialect.value === 'postgresql') {
      const schemaName = schema?.schema || 'public'
      sql += generateInitialDataPostgreSQL(table, schemaName, filtered.rows, filtered.rowComments, store.commonConfig)
    } else if (activeDialect.value === 'sqlite') {
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
        <SegmentedSwitch v-model="activeDialect" :options="dialectOptions" />
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
  align-items: center;
  gap: 0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
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
