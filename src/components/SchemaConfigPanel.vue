<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
import { getSchemaPreSql, getSchemaPostSql } from '@/utils/sql-generator/shared'
import PrePostSqlEditor from './PrePostSqlEditor.vue'

const store = useEditorStore()

function schemaPreSql(dialect: 'mysql' | 'postgresql'): string {
  if (!store.currentSchema) return ''
  return getSchemaPreSql(store.currentSchema, dialect)
}

function schemaPostSql(dialect: 'mysql' | 'postgresql'): string {
  if (!store.currentSchema) return ''
  return getSchemaPostSql(store.currentSchema, dialect)
}

function setPreSql(dialect: 'mysql' | 'postgresql', val: string) {
  if (!store.currentSchema) return
  store.setSchemaPreSql(store.currentSchema, dialect, val)
}

function setPostSql(dialect: 'mysql' | 'postgresql', val: string) {
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
      :postgresql-pre="schemaPreSql('postgresql')"
      :postgresql-post="schemaPostSql('postgresql')"
      @update:mysql-pre="setPreSql('mysql', $event)"
      @update:mysql-post="setPostSql('mysql', $event)"
      @update:postgresql-pre="setPreSql('postgresql', $event)"
      @update:postgresql-post="setPostSql('postgresql', $event)"
    />
  </template>
</template>

<style scoped>
@import '../assets/style/section.css';
</style>
