<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
import { getTablePreSql, getTablePostSql } from '@/utils/sql-generator/shared'
import FieldTable from './FieldTable.vue'
import IndexTable from './IndexTable.vue'
import SqlPreview from './SqlPreview.vue'
import InitialDataEditor from './InitialDataEditor.vue'
import PrePostSqlEditor from './PrePostSqlEditor.vue'

const store = useEditorStore()

function tablePreSql(dialect: 'mysql' | 'pgsql'): string {
  if (!store.currentTable) return ''
  return getTablePreSql(store.currentTable, dialect)
}

function tablePostSql(dialect: 'mysql' | 'pgsql'): string {
  if (!store.currentTable) return ''
  return getTablePostSql(store.currentTable, dialect)
}

function setTablePreSql(dialect: 'mysql' | 'pgsql', val: string) {
  if (!store.currentTable) return
  store.setTablePreSql(store.currentTable, dialect, val)
}

function setTablePostSql(dialect: 'mysql' | 'pgsql', val: string) {
  if (!store.currentTable) return
  store.setTablePostSql(store.currentTable, dialect, val)
}
</script>

<template>
  <template v-if="store.currentTable">
    <!-- Table Basic Info -->
    <div class="section-card">
      <div class="section-header">
        {{ $t('tableEditor.table') }} {{ store.currentTable.name }}
        <span class="badge" v-if="store.currentSchema">{{ store.currentSchema.schema }}</span>
      </div>
      <div class="section-body">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">{{ $t('tableEditor.tableName') }}</label>
            <input class="form-input" v-model="store.currentTable.name">
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('tableEditor.comment') }}</label>
            <input class="form-input" v-model="store.currentTable.comment">
          </div>
        </div>
        <!-- Comment Before Table -->
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">{{ $t('tableEditor.commentBeforeTable') }}</label>
            <textarea class="comment-editor"
                      :value="store.commentBeforeTableText(store.currentTable)"
                      @input="store.setCommentBeforeTable(store.currentTable, ($event.target as HTMLTextAreaElement).value)"
                      rows="3"></textarea>
            <span class="comment-hint">{{ $t('tableEditor.commentHint') }}</span>
          </div>
        </div>
        <!-- MySQL Table Config Override -->
        <div class="form-row">
          <div class="form-group narrow">
            <label class="form-label">{{ $t('tableEditor.mysqlEngine') }}</label>
            <input class="form-input" :value="store.getTableMysqlEngine(store.currentTable)" @input="store.setTableMysqlEngine(store.currentTable, ($event.target as HTMLInputElement).value)" placeholder="InnoDB">
          </div>
          <div class="form-group narrow">
            <label class="form-label">{{ $t('tableEditor.mysqlCharset') }}</label>
            <input class="form-input" :value="store.getTableMysqlCharset(store.currentTable)" @input="store.setTableMysqlCharset(store.currentTable, ($event.target as HTMLInputElement).value)" placeholder="utf8mb4">
          </div>
          <div class="form-group narrow">
            <label class="form-label">{{ $t('tableEditor.mysqlCollation') }}</label>
            <input class="form-input" :value="store.getTableMysqlCollation(store.currentTable)" @input="store.setTableMysqlCollation(store.currentTable, ($event.target as HTMLInputElement).value)" placeholder="utf8mb4_0900_ai_ci">
          </div>
        </div>
      </div>
    </div>

    <!-- Fields -->
    <FieldTable />

    <!-- Indexes -->
    <IndexTable />

    <!-- SQL Preview -->
    <SqlPreview />

    <!-- Table Pre/Post SQL -->
    <PrePostSqlEditor
      :title="$t('tableEditor.prePostSql')"
      :pre-placeholder="$t('tableEditor.preSqlPlaceholder')"
      :post-placeholder="$t('tableEditor.postSqlPlaceholder')"
      :mysql-pre="tablePreSql('mysql')"
      :mysql-post="tablePostSql('mysql')"
      :pgsql-pre="tablePreSql('pgsql')"
      :pgsql-post="tablePostSql('pgsql')"
      :rows="3"
      @update:mysql-pre="setTablePreSql('mysql', $event)"
      @update:mysql-post="setTablePostSql('mysql', $event)"
      @update:pgsql-pre="setTablePreSql('pgsql', $event)"
      @update:pgsql-post="setTablePostSql('pgsql', $event)"
    />

    <!-- Initial Data -->
    <InitialDataEditor />
  </template>
</template>

<style scoped>
.form-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 10px;
}

.form-row:last-child {
  margin-bottom: 0;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}

.form-group.narrow {
  flex: 0 0 120px;
}

.form-group.medium {
  flex: 0 0 200px;
}

.form-label {
  font-size: 11px;
  color: #888;
  font-weight: 500;
}

.form-input {
  padding: 5px 8px;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-size: 12px;
  font-family: inherit;
  color: #333;
  transition: border-color .15s;
}

.form-input:focus {
  outline: none;
  border-color: #4a90d9;
}

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

.section-header .badge {
  font-weight: 400;
  font-size: 11px;
  color: #888;
  margin-left: 8px;
}

.section-body {
  padding: 14px;
}

.comment-editor {
  width: 100%;
  min-height: 40px;
  padding: 5px 8px;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-size: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  line-height: 1.5;
  resize: vertical;
}

.comment-editor:focus {
  outline: none;
  border-color: #4a90d9;
}

.comment-hint {
  font-size: 10px;
  color: #aaa;
  margin-top: 2px;
}
</style>
