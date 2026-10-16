<script setup lang="ts">
import { useEnabledDialect } from '@/composables/useEnabledDialect'
import SegmentedSwitch from '@/components/ui/SegmentedSwitch.vue'
import DefaultMysqlConfigPanel from './DefaultMysqlConfigPanel.vue'
import DefaultPostgresqlConfigPanel from './DefaultPostgresqlConfigPanel.vue'
import DefaultSqliteConfigPanel from './DefaultSqliteConfigPanel.vue'

// 各方言默认配置合并为一张卡片，用切换按钮选择方言
const { dialectOptions, activeDialect } = useEnabledDialect()
</script>

<template>
  <div class="section-card">
    <div class="section-header">
      <!-- 标题与切换按钮同组，避免被 section-header 的 space-between 推到最右 -->
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

<style scoped src="@/assets/style/section.css"></style>
<style scoped>
.header-tabs {
  display: flex;
  align-items: center;
  gap: 15px;
}
</style>
