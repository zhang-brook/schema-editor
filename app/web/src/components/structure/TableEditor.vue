<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import { getTablePreSql, getTablePostSql, type SqlDialect } from '@/utils/sql-generator/shared'
import PageTabs from '@/components/ui/PageTabs.vue'
import TableBasicInfo from './TableBasicInfo.vue'
import FieldTable from './FieldTable.vue'
import IndexTable from './IndexTable.vue'
import SqlPreview from './SqlPreview.vue'
import InitialDataEditor from './InitialDataEditor.vue'
import PrePostSqlEditor from '@/components/common/PrePostSqlEditor.vue'

const store = useEditorStore()
const { t } = useI18n()

const activeTab = ref<'structure' | 'initial-data'>('structure')

const tabOptions = computed(() => [
  { value: 'structure' as const, label: t('tableEditor.tabStructure') },
  { value: 'initial-data' as const, label: t('tableEditor.tabInitialData') },
])

function tablePreSql(dialect: SqlDialect): string {
  if (!store.currentTable) return ''
  return getTablePreSql(store.currentTable, dialect)
}

function tablePostSql(dialect: SqlDialect): string {
  if (!store.currentTable) return ''
  return getTablePostSql(store.currentTable, dialect)
}

function setTablePreSql(dialect: SqlDialect, val: string) {
  if (!store.currentTable) return
  store.setTablePreSql(store.currentTable, dialect, val)
}

function setTablePostSql(dialect: SqlDialect, val: string) {
  if (!store.currentTable) return
  store.setTablePostSql(store.currentTable, dialect, val)
}
</script>

<template>
  <template v-if="store.currentTable">
    <!-- Table Basic Info -->
    <TableBasicInfo />

    <!-- Tab Navigation -->
    <PageTabs v-model="activeTab" :options="tabOptions" />

    <!-- Tab: Structure -->
    <template v-if="activeTab === 'structure'">
      <!-- Fields -->
      <FieldTable />

      <!-- Indexes -->
      <IndexTable />

      <!-- Table Pre/Post SQL -->
      <PrePostSqlEditor
        :title="$t('tableEditor.prePostSql')"
        :pre-placeholder="$t('tableEditor.preSqlPlaceholder')"
        :post-placeholder="$t('tableEditor.postSqlPlaceholder')"
        :mysql-pre="tablePreSql('mysql')"
        :mysql-post="tablePostSql('mysql')"
        :postgresql-pre="tablePreSql('postgresql')"
        :postgresql-post="tablePostSql('postgresql')"
        :sqlite-pre="tablePreSql('sqlite')"
        :sqlite-post="tablePostSql('sqlite')"
        :rows="3"
        @update:mysql-pre="setTablePreSql('mysql', $event)"
        @update:mysql-post="setTablePostSql('mysql', $event)"
        @update:postgresql-pre="setTablePreSql('postgresql', $event)"
        @update:postgresql-post="setTablePostSql('postgresql', $event)"
        @update:sqlite-pre="setTablePreSql('sqlite', $event)"
        @update:sqlite-post="setTablePostSql('sqlite', $event)"
      />

      <!-- SQL Preview -->
      <SqlPreview />
    </template>

    <!-- Tab: Initial Data -->
    <template v-if="activeTab === 'initial-data'">
      <InitialDataEditor />
    </template>
  </template>
</template>
