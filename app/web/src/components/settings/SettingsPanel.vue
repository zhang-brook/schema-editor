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
    <!-- 最左侧：VSCode 风格的页面切换列 -->
    <SettingsRail />

    <!-- 右侧内容区：三个页面各自布局、各自持有样式 -->
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

/* 右侧内容：flex 纵向，子项默认 stretch 横向撑满 */
.ps-content {
  flex: 1;
  min-width: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
</style>
