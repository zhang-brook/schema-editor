<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import { useEditorStore } from '@/stores/editor'
import EditorSidebar from '@/components/structure/EditorSidebar.vue'
import TableTabs from '@/components/structure/TableTabs.vue'
import SchemaConfigPanel from '@/components/structure/SchemaConfigPanel.vue'
import TableEditor from '@/components/structure/TableEditor.vue'

const store = useEditorStore()

// ===== Draggable divider between the left menu and the right panel =====
const SIDEBAR_WIDTH_KEY = 'schema-editor.structureSidebarWidth'
const MIN_W = 180
const MAX_W = 480

function loadSidebarWidth(): number {
  const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
  return Number.isFinite(stored) && stored >= MIN_W && stored <= MAX_W ? stored : 250
}

const sidebarWidth = ref(loadSidebarWidth())
const resizing = ref(false)
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
  localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth.value))
}

onBeforeUnmount(stopResize)
</script>

<template>
  <!-- Schema structure design: left tree navigation + draggable divider + right edit panel -->
  <div class="ps-structure" :style="{ '--sidebar-width': sidebarWidth + 'px' }">
    <EditorSidebar />
    <div
      class="ps-resizer"
      :class="{ active: resizing }"
      @mousedown="startResize"
      :title="$t('settings.resizeHint')"
    ></div>
    <div class="ps-structure-content">
      <TableTabs />
      <div class="ps-structure-body">
        <SchemaConfigPanel v-if="store.currentSchema && store.selectedTableIdx === -1" />
        <TableEditor v-else-if="store.currentTable" />
        <div v-else class="ps-empty">
          <p>{{ $t('settings.structureEmpty') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ps-structure {
  display: flex;
  flex: 1;
  width: 100%;
  min-height: 0;
  overflow: hidden;
}

/* Draggable divider bar between the left menu and the right panel */
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
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Tab bar stays fixed at the top; only the content area scrolls */
.ps-structure-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
}

.ps-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-subtle);
  font-size: 13px;
}
</style>
