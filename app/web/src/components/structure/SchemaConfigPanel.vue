<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
import { getSchemaPreSql, getSchemaPostSql, type SqlDialect } from '@/utils/sql-generator/shared'
import PrePostSqlEditor from '@/components/common/PrePostSqlEditor.vue'

const store = useEditorStore()

function schemaPreSql(dialect: SqlDialect): string {
  if (!store.currentSchema) return ''
  return getSchemaPreSql(store.currentSchema, dialect)
}

function schemaPostSql(dialect: SqlDialect): string {
  if (!store.currentSchema) return ''
  return getSchemaPostSql(store.currentSchema, dialect)
}

function setPreSql(dialect: SqlDialect, val: string) {
  if (!store.currentSchema) return
  store.setSchemaPreSql(store.currentSchema, dialect, val)
}

function setPostSql(dialect: SqlDialect, val: string) {
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
      :sqlite-pre="schemaPreSql('sqlite')"
      :sqlite-post="schemaPostSql('sqlite')"
      @update:mysql-pre="setPreSql('mysql', $event)"
      @update:mysql-post="setPostSql('mysql', $event)"
      @update:postgresql-pre="setPreSql('postgresql', $event)"
      @update:postgresql-post="setPostSql('postgresql', $event)"
      @update:sqlite-pre="setPreSql('sqlite', $event)"
      @update:sqlite-post="setPostSql('sqlite', $event)"
    />
  </template>
</template>

<style scoped src="@/assets/style/section.css"></style>
<style scoped></style>
