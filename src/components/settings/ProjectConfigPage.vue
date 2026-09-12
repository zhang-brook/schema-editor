<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import PageTabs from '@/components/ui/PageTabs.vue'
import ProjectInfoPanel from './sections/ProjectInfoPanel.vue'
import CommonUsedFieldsPanel from './sections/CommonUsedFieldsPanel.vue'
import UnifiedTypesPanel from './sections/UnifiedTypesPanel.vue'
import DialectConfigPanel from './sections/DialectConfigPanel.vue'
import DatabaseDefaultsPanel from './sections/database-defaults/DatabaseDefaultsPanel.vue'
import DdlOptionsPanel from './sections/DdlOptionsPanel.vue'
import TypeCasePanel from './sections/TypeCasePanel.vue'
import GlobalPrePostSqlPanel from './sections/GlobalPrePostSqlPanel.vue'
import AiGuidePanel from './sections/AiGuidePanel.vue'

const store = useEditorStore()
const { t } = useI18n()

const subTabs = ['project', 'general', 'dialect', 'model'] as const
type SubTab = (typeof subTabs)[number]

const activeSubTab = ref<SubTab>('general')

// 由菜单栏标题点击进入时切到「项目信息」；immediate 同时覆盖首次挂载与已挂载后再次点击
watch(() => store.projectInfoTabRequest, (pending) => {
  if (!pending) return
  activeSubTab.value = 'project'
  store.consumeProjectInfoTabRequest()
}, { immediate: true })

const subTabOptions = computed(() =>
  subTabs.map(tab => ({ value: tab, label: t(`settings.subTabs.${tab}`) })),
)
</script>

<template>
  <!-- ===== 项目设置页：四个子 tab ===== -->
  <div v-if="store.commonConfig" class="pcfg-page">
    <PageTabs v-model="activeSubTab" :options="subTabOptions" />

    <!-- 项目信息 -->
    <template v-if="activeSubTab === 'project'">
      <ProjectInfoPanel />
    </template>

    <!-- 全局配置 -->
    <template v-else-if="activeSubTab === 'general'">
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
  padding: 16px;
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
