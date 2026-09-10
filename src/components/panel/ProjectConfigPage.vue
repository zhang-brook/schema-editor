<script setup lang="ts">
import { ref } from 'vue'
import { useEditorStore } from '@/stores/editor'
import CommonUsedFieldsPanel from './CommonUsedFieldsPanel.vue'
import UnifiedTypesPanel from './UnifiedTypesPanel.vue'
import DialectConfigPanel from './DialectConfigPanel.vue'
import DatabaseDefaultsPanel from './DatabaseDefaultsPanel.vue'
import DdlOptionsPanel from './DdlOptionsPanel.vue'
import TypeCasePanel from './TypeCasePanel.vue'
import GlobalPrePostSqlPanel from './GlobalPrePostSqlPanel.vue'
import AiGuidePanel from './AiGuidePanel.vue'

const store = useEditorStore()

const subTabs = ['general', 'dialect', 'model'] as const
type SubTab = (typeof subTabs)[number]

const activeSubTab = ref<SubTab>('general')
</script>

<template>
  <!-- ===== 项目设置页：三个子 tab ===== -->
  <div v-if="store.settingsTab === 'project' && store.commonConfig" class="pcfg-page">
    <div class="pcfg-tabs">
      <button
        v-for="tab in subTabs"
        :key="tab"
        class="pcfg-tab"
        :class="{ active: activeSubTab === tab }"
        @click="activeSubTab = tab"
      >{{ $t(`settings.subTabs.${tab}`) }}</button>
    </div>

    <!-- 全局配置 -->
    <template v-if="activeSubTab === 'general'">
      <div class="pcfg-group">
        <div class="pcfg-group-title">{{ $t('settings.groups.commonFields') }}</div>
        <CommonUsedFieldsPanel />
      </div>
      <div class="pcfg-group">
        <div class="pcfg-group-title">{{ $t('settings.groups.unifiedTypes') }}</div>
        <UnifiedTypesPanel />
      </div>
    </template>

    <!-- 方言配置 -->
    <template v-else-if="activeSubTab === 'dialect'">
      <div class="pcfg-group">
        <div class="pcfg-group-title">{{ $t('settings.groups.dialect') }}</div>
        <DialectConfigPanel />
        <DatabaseDefaultsPanel />
      </div>
      <div class="pcfg-group">
        <div class="pcfg-group-title">{{ $t('settings.groups.generatePrefs') }}</div>
        <DdlOptionsPanel />
        <TypeCasePanel />
        <GlobalPrePostSqlPanel />
      </div>
    </template>

    <!-- 大模型 -->
    <template v-else>
      <div class="pcfg-group">
        <div class="pcfg-group-title">{{ $t('settings.groups.aiPrompt') }}</div>
        <AiGuidePanel />
      </div>
    </template>
  </div>
</template>

<style scoped>
.pcfg-page {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 20px 24px;
}

.pcfg-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 18px;
}

.pcfg-tab {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--fg-muted);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
  font-family: inherit;
  transition: color .15s ease, border-color .15s ease;
}

.pcfg-tab:hover:not(.active) {
  color: var(--fg);
}

.pcfg-tab.active {
  color: var(--accent-active);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

/* 分组小标题：仅作视觉分隔，不增加点击层级 */
.pcfg-group-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--fg-subtle);
  letter-spacing: .06em;
  margin: 0 0 10px;
}

.pcfg-group + .pcfg-group {
  margin-top: 4px;
}
</style>
