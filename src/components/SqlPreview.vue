<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import { generateTableMySQL } from '@/utils/sql-generator/mysql'
import { generateTablePostgreSQL } from '@/utils/sql-generator/postgresql'
import { generateTableSQLite } from '@/utils/sql-generator/sqlite'
import type { SqlDialect } from '@/utils/sql-generator/shared'

const store = useEditorStore()
const { t } = useI18n()
const dialect = ref<SqlDialect>('mysql')

const previewSql = computed(() => {
  const table = store.currentTable
  if (!table) return ''
  const schema = store.currentSchema

  if (dialect.value === 'mysql') {
    return generateTableMySQL(table, store.commonConfig)
  }
  else if (dialect.value === 'postgresql') {
    const schemaName = schema?.schema || 'public'
    return generateTablePostgreSQL(table, schemaName, store.commonConfig)
  }
  else if (dialect.value === 'sqlite') {
    return generateTableSQLite(table, store.commonConfig)
  }
  return ''
})

function copyToClipboard() {
  navigator.clipboard.writeText(previewSql.value).then(() => {
    store.showToast(t('toast.sqlCopied'))
  })
}
</script>

<template>
  <div class="section-card" v-if="store.currentTable">
    <div class="section-header">
      <div class="header-tabs">
        <div style="margin-right: 15px;">
          <span>{{ $t('sqlPreview.title') }}</span>
        </div>
        <button class="tab-btn" :class="{ active: dialect === 'mysql' }" @click="dialect = 'mysql'">{{ $t('sqlPreview.mysql') }}</button>
        <button class="tab-btn" :class="{ active: dialect === 'postgresql' }"
          @click="dialect = 'postgresql'">{{ $t('sqlPreview.postgresql') }}</button>
        <button class="tab-btn" :class="{ active: dialect === 'sqlite' }"
          @click="dialect = 'sqlite'">{{ $t('sqlPreview.sqlite') }}</button>
      </div>
      <div class="header-actions">
        <button class="btn-copy" @click="copyToClipboard" :title="$t('sqlPreview.copyTitle')">{{ $t('sqlPreview.copy') }}</button>
      </div>
    </div>
    <div class="section-body">
      <pre class="sql-code"><code>{{ previewSql }}</code></pre>
    </div>
  </div>
</template>

<style scoped src="@/assets/style/section.css"></style>
<style scoped src="@/assets/style/btn.css"></style>
<style scoped>
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-tabs {
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

.btn-copy {
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--code-thumb);
  font-size: 11px;
  cursor: pointer;
  transition: all .15s;
}

.btn-copy:hover {
  background: var(--surface-3);
  border-color: #aaa;
}

.section-body {
  padding: 0;
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
  max-height: 500px;
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
