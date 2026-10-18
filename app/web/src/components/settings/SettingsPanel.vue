<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
import SettingsRail from './SettingsRail.vue'
import ProjectConfigPage from './ProjectConfigPage.vue'
import StructureDesignPage from './StructureDesignPage.vue'
import VersionManagementPage from './VersionManagementPage.vue'

const store = useEditorStore()
</script>

<template>
  <div class="ps-root">
    <!-- Far left: VSCode-style page switch rail -->
    <SettingsRail />

    <!-- Right content area: three pages, each with its own layout and styles -->
    <div class="ps-content">
      <ProjectConfigPage v-if="store.settingsTab === 'project'" />
      <StructureDesignPage v-else-if="store.settingsTab === 'structure'" />
      <VersionManagementPage v-else />
    </div>
  </div>
</template>

<style scoped>
.ps-root {
  display: flex;
  flex: 1;
  min-width: 0;
  height: 100%;
  background: var(--canvas);
  overflow: hidden;
  user-select: none;
}

/* Right content: vertical flex; children stretch to full width by default */
.ps-content {
  flex: 1;
  min-width: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
</style>
