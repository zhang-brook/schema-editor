<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
import DialectConfigPanel from './panel/DialectConfigPanel.vue'
import UnifiedTypesPanel from './panel/UnifiedTypesPanel.vue'
import DefaultMysqlConfigPanel from './panel/DefaultMysqlConfigPanel.vue'
import DefaultPostgresqlConfigPanel from './panel/DefaultPostgresqlConfigPanel.vue'
import DefaultSqliteConfigPanel from './panel/DefaultSqliteConfigPanel.vue'
import DdlOptionsPanel from './panel/DdlOptionsPanel.vue'
import GlobalPrePostSqlPanel from './panel/GlobalPrePostSqlPanel.vue'
import TypeCasePanel from './panel/TypeCasePanel.vue'
import CommonUsedFieldsPanel from './panel/CommonUsedFieldsPanel.vue'

const store = useEditorStore()
</script>

<template>
  <!-- ===== Common Config Panel ===== -->
  <template v-if="store.showCommonPanel && store.commonConfig">
    <!-- SQL 输出方言（项目级开关） -->
    <DialectConfigPanel />

    <UnifiedTypesPanel />

    <DefaultMysqlConfigPanel />

    <DefaultPostgresqlConfigPanel />

    <DefaultSqliteConfigPanel />

    <DdlOptionsPanel />

    <GlobalPrePostSqlPanel />

    <TypeCasePanel />

    <CommonUsedFieldsPanel />
  </template>
</template>
