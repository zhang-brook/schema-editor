<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import PageTabs from '@/components/ui/PageTabs.vue'
import ProjectInfoPanel from './sections/ProjectInfoPanel.vue'
import CommonUsedFieldsPanel from './sections/CommonUsedFieldsPanel.vue'
import UnifiedTypesPanel from './sections/UnifiedTypesPanel.vue'
import LogicalDeletePanel from './sections/LogicalDeletePanel.vue'
import DialectConfigPanel from './sections/DialectConfigPanel.vue'
import DatabaseDefaultsPanel from './sections/database-defaults/DatabaseDefaultsPanel.vue'
import DdlOptionsPanel from './sections/DdlOptionsPanel.vue'
import InitialDataOptionsPanel from './sections/InitialDataOptionsPanel.vue'
import TypeCasePanel from './sections/TypeCasePanel.vue'
import GlobalPrePostSqlPanel from './sections/GlobalPrePostSqlPanel.vue'
import AiGuidePanel from './sections/AiGuidePanel.vue'

const store = useEditorStore()
const { t } = useI18n()

const subTabs = ['project', 'general', 'dialect', 'model'] as const
type SubTab = (typeof subTabs)[number]

const activeSubTab = ref<SubTab>('general')

// Switch to “Project Info” when entered by clicking the menu bar title; immediate also covers the first mount and repeated clicks after mounting
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
  <!-- ===== Project settings page: four sub-tabs ===== -->
  <div v-if="store.commonConfig" class="pcfg-page">
    <PageTabs v-model="activeSubTab" :options="subTabOptions" />

    <!-- Project info -->
    <template v-if="activeSubTab === 'project'">
      <ProjectInfoPanel />
    </template>

    <!-- General configuration -->
    <template v-else-if="activeSubTab === 'general'">
      <div class="pcfg-group">
        <div class="pcfg-group-title">{{ $t('settings.groups.commonFields') }}</div>
        <CommonUsedFieldsPanel />
      </div>
      <div class="pcfg-group">
        <div class="pcfg-group-title">{{ $t('settings.groups.unifiedTypes') }}</div>
        <UnifiedTypesPanel />
      </div>
      <div class="pcfg-group">
        <div class="pcfg-group-title">{{ $t('settings.groups.logicalDelete') }}</div>
        <LogicalDeletePanel />
      </div>
    </template>

    <!-- Dialect configuration -->
    <template v-else-if="activeSubTab === 'dialect'">
      <div class="pcfg-group">
        <div class="pcfg-group-title">{{ $t('settings.groups.dialect') }}</div>
        <DialectConfigPanel />
        <DatabaseDefaultsPanel />
      </div>
      <div class="pcfg-group">
        <div class="pcfg-group-title">{{ $t('settings.groups.generatePrefs') }}</div>
        <DdlOptionsPanel />
        <InitialDataOptionsPanel />
        <TypeCasePanel />
        <GlobalPrePostSqlPanel />
      </div>
    </template>

    <!-- LLM -->
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

/* Group subheadings: purely visual separation, adds no click level */
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
