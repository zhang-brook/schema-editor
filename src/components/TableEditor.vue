<script setup lang="ts">
import { ref } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { getTablePreSql, getTablePostSql } from '@/utils/sql-generator/shared'
import TableBasicInfo from './TableBasicInfo.vue'
import FieldTable from './FieldTable.vue'
import IndexTable from './IndexTable.vue'
import SqlPreview from './SqlPreview.vue'
import InitialDataEditor from './InitialDataEditor.vue'
import PrePostSqlEditor from './PrePostSqlEditor.vue'

const store = useEditorStore()

const activeTab = ref<'structure' | 'initial-data'>('structure')

function tablePreSql(dialect: 'mysql' | 'postgresql'): string {
  if (!store.currentTable) return ''
  return getTablePreSql(store.currentTable, dialect)
}

function tablePostSql(dialect: 'mysql' | 'postgresql'): string {
  if (!store.currentTable) return ''
  return getTablePostSql(store.currentTable, dialect)
}

function setTablePreSql(dialect: 'mysql' | 'postgresql', val: string) {
  if (!store.currentTable) return
  store.setTablePreSql(store.currentTable, dialect, val)
}

function setTablePostSql(dialect: 'mysql' | 'postgresql', val: string) {
  if (!store.currentTable) return
  store.setTablePostSql(store.currentTable, dialect, val)
}
</script>

<template>
  <template v-if="store.currentTable">
    <!-- Table Basic Info -->
    <TableBasicInfo />

    <!-- Tab Navigation -->
    <div class="tab-bar">
      <button
        class="tab-item"
        :class="{ active: activeTab === 'structure' }"
        @click="activeTab = 'structure'"
      >
        {{ $t('tableEditor.tabStructure') }}
      </button>
      <button
        class="tab-item"
        :class="{ active: activeTab === 'initial-data' }"
        @click="activeTab = 'initial-data'"
      >
        {{ $t('tableEditor.tabInitialData') }}
      </button>
    </div>

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
        :rows="3"
        @update:mysql-pre="setTablePreSql('mysql', $event)"
        @update:mysql-post="setTablePostSql('mysql', $event)"
        @update:postgresql-pre="setTablePreSql('postgresql', $event)"
        @update:postgresql-post="setTablePostSql('postgresql', $event)"
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

<style scoped>
.tab-bar {
  display: flex;
  gap: 0;
  border-bottom: 2px solid #e0e0e0;
  margin-bottom: 16px;
}

.tab-item {
  padding: 8px 20px;
  font-size: 13px;
  font-weight: 500;
  color: #888;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  cursor: pointer;
  transition: color .15s, border-color .15s;
  font-family: inherit;
}

.tab-item:hover {
  color: #555;
}

.tab-item.active {
  color: #4a90d9;
  border-bottom-color: #4a90d9;
}
</style>
