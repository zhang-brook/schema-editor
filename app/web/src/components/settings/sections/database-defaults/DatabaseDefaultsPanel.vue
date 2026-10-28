<script setup lang="ts">
import { useEnabledDialect } from '@/composables/useEnabledDialect'
import SegmentedSwitch from '@/components/ui/SegmentedSwitch.vue'
import DefaultMysqlConfigPanel from './DefaultMysqlConfigPanel.vue'
import DefaultPostgresqlConfigPanel from './DefaultPostgresqlConfigPanel.vue'
import DefaultSqliteConfigPanel from './DefaultSqliteConfigPanel.vue'

// Dialect default configs are merged into one card, with a switch to select the dialect
const { dialectOptions, activeDialect } = useEnabledDialect()
</script>

<template>
  <div class="section-card">
    <div class="section-header">
      <!-- Keep the title and switch in one group so section-header's space-between does not push them to the far right -->
      <div class="header-tabs">
        <span>{{ $t('commonConfig.databaseDefaults') }}</span>
        <SegmentedSwitch v-model="activeDialect" :options="dialectOptions" />
      </div>
    </div>
    <div class="section-body">
      <DefaultMysqlConfigPanel v-if="activeDialect === 'mysql'" />
      <DefaultPostgresqlConfigPanel v-else-if="activeDialect === 'postgresql'" />
      <DefaultSqliteConfigPanel v-else-if="activeDialect === 'sqlite'" />
    </div>
  </div>
</template>

<style scoped>
.header-tabs {
  display: flex;
  align-items: center;
  gap: 15px;
}
</style>
