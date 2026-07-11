<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
import CommonConfigPanel from '@/components/CommonConfigPanel.vue'
import EditorSidebar from '@/components/EditorSidebar.vue'
import SchemaConfigPanel from '@/components/SchemaConfigPanel.vue'
import TableEditor from '@/components/TableEditor.vue'
import VersionManagementPanel from '@/components/panel/VersionManagementPanel.vue'

const store = useEditorStore()
</script>

<template>
  <div class="ps-root">
    <!-- 最左侧：VSCode 风格的页面切换列 -->
    <div class="ps-rail">
      <!-- <div class="ps-rail-title">{{ $t('settings.title') }}</div> -->
      <button class="ps-rail-item" :class="{ active: store.settingsTab === 'global' }"
        @click="store.selectSettingsTab('global')">{{ $t('settings.tabs.global') }}</button>
      <button class="ps-rail-item" :class="{ active: store.settingsTab === 'structure' }"
        @click="store.selectSettingsTab('structure')">{{ $t('settings.tabs.structure') }}</button>
      <button class="ps-rail-item" :class="{ active: store.settingsTab === 'version' }"
        @click="store.selectSettingsTab('version')">{{ $t('settings.tabs.version') }}</button>
      <button class="ps-rail-item" :class="{ active: store.settingsTab === 'project' }"
        @click="store.selectSettingsTab('project')">{{ $t('settings.tabs.project') }}</button>
    </div>

    <!-- 右侧内容区（每个页面自己布局自己） -->
    <div class="ps-content">
      <!-- 全局配置：无 schema 侧边树 -->
      <div v-if="store.settingsTab === 'global' && store.commonConfig" class="ps-global">
        <CommonConfigPanel />
      </div>

      <!-- 库结构设计：沿用原布局 = EditorSidebar + SchemaConfigPanel/TableEditor -->
      <div v-else-if="store.settingsTab === 'structure'" class="ps-structure">
        <EditorSidebar />
        <div class="ps-structure-content">
          <SchemaConfigPanel v-if="store.currentSchema && store.selectedTableIdx === -1" />
          <TableEditor v-else-if="store.currentTable" />
          <div v-else class="ps-empty">
            <p>{{ $t('settings.structureEmpty') }}</p>
          </div>
        </div>
      </div>

      <VersionManagementPanel />

      <!-- 项目设置 -->
      <div v-if="store.settingsTab === 'project'" class="ps-project">
        <div class="ps-setting-row">
          <label class="ps-switch">
            <input
              type="checkbox"
              :checked="store.generateAiGuide"
              @change="store.setGenerateAiGuide(($event.target as HTMLInputElement).checked)"
            />
            <span class="ps-switch-label">{{ $t('settings.aiGuide') }}</span>
          </label>
          <p class="ps-setting-hint">{{ $t('settings.aiGuideHint') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ps-root {
  display: flex;
  flex: 1;
  min-width: 0;
  height: 100%;
  background: #fff;
  overflow: hidden;
  user-select: none;
}

/* 最左侧：VSCode 风格页面切换列 */
.ps-rail {
  width: calc(200px * 0.618);
  min-width: calc(200px * 0.618);
  background: #f3f3f3;
  border-right: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
  padding: 12px 8px;
  gap: 2px;
}

.ps-rail-title {
  font-size: 11px;
  font-weight: 600;
  color: #999;
  text-transform: uppercase;
  letter-spacing: .5px;
  padding: 4px 8px 10px;
}

.ps-rail-item {
  text-align: left;
  padding: 8px 12px;
  border: none;
  background: none;
  border-radius: 5px;
  font-size: 13px;
  color: #444;
  cursor: pointer;
  font-family: inherit;
  transition: background .1s;
}

.ps-rail-item:hover {
  background: #e6e6e6;
}

.ps-rail-item.active {
  background: #4a90d9;
  color: #fff;
  font-weight: 500;
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

/* 全局配置页容器：独立内边距与滚动，不影响库结构设计页 */
.ps-global {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 20px 24px;
}

/* 库结构设计：保留 EditorSidebar + 右侧内容（原布局不变） */
.ps-structure {
  display: flex;
  flex: 1;
  width: 100%;
  min-height: 100%;
}

.ps-structure-content {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 16px;
}

.ps-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #aaa;
  font-size: 13px;
}

/* 项目设置页 */
.ps-project {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 20px 24px;
}

.ps-setting-row {
  padding: 12px 16px;
  border: 1px solid #e6e6e6;
  border-radius: 8px;
  background: #fafafa;
  max-width: 560px;
}

.ps-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: #333;
}

.ps-switch input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.ps-setting-hint {
  margin: 8px 0 0 24px;
  font-size: 12px;
  color: #888;
  line-height: 1.5;
}

</style>
