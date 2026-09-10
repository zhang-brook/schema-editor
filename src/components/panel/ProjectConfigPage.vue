<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import PageTabs from '@/components/PageTabs.vue'
import CommonUsedFieldsPanel from './CommonUsedFieldsPanel.vue'
import UnifiedTypesPanel from './UnifiedTypesPanel.vue'
import DialectConfigPanel from './DialectConfigPanel.vue'
import DatabaseDefaultsPanel from './DatabaseDefaultsPanel.vue'
import DdlOptionsPanel from './DdlOptionsPanel.vue'
import TypeCasePanel from './TypeCasePanel.vue'
import GlobalPrePostSqlPanel from './GlobalPrePostSqlPanel.vue'
import AiGuidePanel from './AiGuidePanel.vue'

const store = useEditorStore()
const { t } = useI18n()

const subTabs = ['general', 'dialect', 'model'] as const
type SubTab = (typeof subTabs)[number]

const activeSubTab = ref<SubTab>('general')

const subTabOptions = computed(() =>
  subTabs.map(tab => ({ value: tab, label: t(`settings.subTabs.${tab}`) })),
)
</script>

<template>
  <!-- ===== 项目设置页：三个子 tab ===== -->
  <div v-if="store.settingsTab === 'project' && store.commonConfig" class="pcfg-page">
    <PageTabs v-model="activeSubTab" :options="subTabOptions" />

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
