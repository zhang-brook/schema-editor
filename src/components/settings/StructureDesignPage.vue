<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import { useEditorStore } from '@/stores/editor'
import EditorSidebar from '@/components/structure/EditorSidebar.vue'
import SchemaConfigPanel from '@/components/structure/SchemaConfigPanel.vue'
import TableEditor from '@/components/structure/TableEditor.vue'

const store = useEditorStore()

// ===== 左侧菜单与右侧面板之间的可拖拽分隔 =====
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
  <!-- 库结构设计：左侧树形导航 + 可拖拽分隔 + 右侧编辑面板 -->
  <div class="ps-structure" :style="{ '--sidebar-width': sidebarWidth + 'px' }">
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
</template>

<style scoped>
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
