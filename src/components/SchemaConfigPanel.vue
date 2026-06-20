<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
import { getSchemaPreSql, getSchemaPostSql } from '@/utils/sql-generator/shared'
import PrePostSqlEditor from './PrePostSqlEditor.vue'

const store = useEditorStore()

function schemaPreSql(dialect: 'mysql' | 'pgsql'): string {
  if (!store.currentSchema) return ''
  return getSchemaPreSql(store.currentSchema, dialect)
}

function schemaPostSql(dialect: 'mysql' | 'pgsql'): string {
  if (!store.currentSchema) return ''
  return getSchemaPostSql(store.currentSchema, dialect)
}

function setPreSql(dialect: 'mysql' | 'pgsql', val: string) {
  if (!store.currentSchema) return
  store.setSchemaPreSql(store.currentSchema, dialect, val)
}

function setPostSql(dialect: 'mysql' | 'pgsql', val: string) {
  if (!store.currentSchema) return
  store.setSchemaPostSql(store.currentSchema, dialect, val)
}
</script>

<template>
  <template v-if="store.currentSchema">
    <!-- Schema Info -->
    <div class="section-card">
      <div class="section-header">
        {{ $t('schemaConfig.title') }} {{ store.currentSchema.schema }}
        <span class="badge">{{ $t('schemaConfig.tableCount', { n: store.currentSchema.tables.length }) }}</span>
      </div>
    </div>

    <PrePostSqlEditor
      :title="$t('schemaConfig.prePostSql')"
      :pre-placeholder="$t('schemaConfig.preSqlPlaceholder')"
      :post-placeholder="$t('schemaConfig.postSqlPlaceholder')"
      :mysql-pre="schemaPreSql('mysql')"
      :mysql-post="schemaPostSql('mysql')"
      :pgsql-pre="schemaPreSql('pgsql')"
      :pgsql-post="schemaPostSql('pgsql')"
      @update:mysql-pre="setPreSql('mysql', $event)"
      @update:mysql-post="setPostSql('mysql', $event)"
      @update:pgsql-pre="setPreSql('pgsql', $event)"
      @update:pgsql-post="setPostSql('pgsql', $event)"
    />
  </template>
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

.section-header .badge {
  font-weight: 400;
  font-size: 11px;
  color: #888;
  margin-left: 8px;
}
</style>
