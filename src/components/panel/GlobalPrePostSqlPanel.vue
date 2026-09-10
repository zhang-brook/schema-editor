<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
import { getGlobalPreSql, getGlobalPostSql } from '@/utils/sql-generator/shared'
import PrePostSqlEditor from '@/components/PrePostSqlEditor.vue'

const store = useEditorStore()
</script>

<template>
  <!-- Pre/Post SQL -->
  <PrePostSqlEditor
    :title="$t('commonConfig.prePostSql')"
    :pre-placeholder="$t('commonConfig.preSqlPlaceholder')"
    :post-placeholder="$t('commonConfig.postSqlPlaceholder')"
    :mysql-pre="getGlobalPreSql(store.commonConfig, 'mysql')"
    :mysql-post="getGlobalPostSql(store.commonConfig, 'mysql')"
    :postgresql-pre="getGlobalPreSql(store.commonConfig, 'postgresql')"
    :postgresql-post="getGlobalPostSql(store.commonConfig, 'postgresql')"
    :sqlite-pre="getGlobalPreSql(store.commonConfig, 'sqlite')"
    :sqlite-post="getGlobalPostSql(store.commonConfig, 'sqlite')"
    @update:mysql-pre="store.setGlobalPreSql('mysql', $event)"
    @update:mysql-post="store.setGlobalPostSql('mysql', $event)"
    @update:postgresql-pre="store.setGlobalPreSql('postgresql', $event)"
    @update:postgresql-post="store.setGlobalPostSql('postgresql', $event)"
    @update:sqlite-pre="store.setGlobalPreSql('sqlite', $event)"
    @update:sqlite-post="store.setGlobalPostSql('sqlite', $event)"
  />
</template>
