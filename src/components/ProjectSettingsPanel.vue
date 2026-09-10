<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import { useEditorStore } from '@/stores/editor'
import EditorSidebar from '@/components/EditorSidebar.vue'
import SchemaConfigPanel from '@/components/SchemaConfigPanel.vue'
import TableEditor from '@/components/TableEditor.vue'
import ProjectConfigPage from '@/components/panel/ProjectConfigPage.vue'
import VersionManagementPanel from '@/components/panel/VersionManagementPanel.vue'

const store = useEditorStore()

// ===== 库结构设计页：左侧菜单与右侧面板之间的可拖拽分隔 =====
const sidebarWidth = ref(250)
const resizing = ref(false)
const MIN_W = 180
const MAX_W = 480
let startX = 0
let startW = 0

function startResize(e: MouseEvent) {
  e.preventDefault()
  startX = e.clientX
  startW = sidebarWidth.value
  resizing.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', stopResize)
}

function onResizeMove(e: MouseEvent) {
  const delta = e.clientX - startX
  let w = startW + delta
  w = Math.max(MIN_W, Math.min(MAX_W, w))
  sidebarWidth.value = w
}

function stopResize() {
  resizing.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', stopResize)
}

onBeforeUnmount(stopResize)
</script>

<template>
  <div class="ps-root">
    <!-- 最左侧：VSCode 风格的页面切换列 -->
    <div class="ps-rail">
      <!-- <div class="ps-rail-title">{{ $t('settings.title') }}</div> -->
      <button class="ps-rail-item" :class="{ active: store.settingsTab === 'structure' }"
        @click="store.selectSettingsTab('structure')">{{ $t('settings.tabs.structure') }}</button>
      <button class="ps-rail-item" :class="{ active: store.settingsTab === 'version' }"
        @click="store.selectSettingsTab('version')">{{ $t('settings.tabs.version') }}</button>
      <button class="ps-rail-item" :class="{ active: store.settingsTab === 'project' }"
        @click="store.selectSettingsTab('project')">{{ $t('settings.tabs.project') }}</button>
    </div>

    <!-- 右侧内容区（每个页面自己布局自己） -->
    <div class="ps-content">
      <!-- 项目设置：全局配置 / 方言配置 / 大模型 三个子 tab -->
      <ProjectConfigPage />

      <!-- 库结构设计：沿用原布局 = EditorSidebar + SchemaConfigPanel/TableEditor -->
      <div
        v-if="store.settingsTab === 'structure'"
        class="ps-structure"
        :style="{ '--sidebar-width': sidebarWidth + 'px' }"
      >
        <EditorSidebar />
        <div
          class="ps-resizer"
          :class="{ active: resizing }"
          @mousedown="startResize"
          :title="$t('settings.resizeHint')"
        ></div>
        <div class="ps-structure-content">
          <SchemaConfigPanel v-if="store.currentSchema && store.selectedTableIdx === -1" />
          <TableEditor v-else-if="store.currentTable" />
          <div v-else class="ps-empty">
            <p>{{ $t('settings.structureEmpty') }}</p>
          </div>
        </div>
      </div>

      <VersionManagementPanel />
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

/* 最左侧：VSCode 风格页面切换列 */
.ps-rail {
  width: 200px;
  min-width: 200px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 14px 10px;
  gap: 4px;
}

.ps-rail-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--fg-subtle);
  text-transform: uppercase;
  letter-spacing: .06em;
  padding: 4px 10px 10px;
}

.ps-rail-item {
  text-align: left;
  padding: 9px 12px;
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--fg-muted);
  cursor: pointer;
  font-family: inherit;
  transition: background .12s ease, color .12s ease;
}

.ps-rail-item:hover {
  background: var(--surface-3);
  color: var(--fg);
}

.ps-rail-item.active {
  background: var(--accent-subtle);
  color: var(--accent-active);
  font-weight: 600;
  box-shadow: inset 3px 0 0 var(--accent);
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

/* 库结构设计：保留 EditorSidebar + 右侧内容（原布局不变） */
.ps-structure {
  display: flex;
  flex: 1;
  width: 100%;
  min-height: 100%;
}

/* 左侧菜单与右侧面板之间的可拖拽分隔条 */
.ps-resizer {
  flex-shrink: 0;
  width: 5px;
  cursor: col-resize;
  background: transparent;
  position: relative;
  transition: background .15s ease;
}

.ps-resizer:hover,
.ps-resizer.active {
  background: var(--accent-subtle);
}

.ps-resizer::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 2px;
  height: 32px;
  border-radius: var(--radius-pill);
  background: var(--border-strong);
  opacity: 0;
  transition: opacity .15s ease;
}

.ps-resizer:hover::after,
.ps-resizer.active::after {
  opacity: 1;
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
</style>
