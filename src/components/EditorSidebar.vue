<script setup lang="ts">
import { ref } from 'vue'
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()

// 每个 schema 的展开/折叠状态（默认全部展开）
const expandedMap = ref<Record<number, boolean>>({})

function isExpanded(sIdx: number) {
  return expandedMap.value[sIdx] !== false // 默认展开
}

function toggleExpand(sIdx: number) {
  expandedMap.value[sIdx] = !isExpanded(sIdx)
}

// 拖拽状态
const dragSchemaIdx = ref(-1)
const dragTableIdx = ref(-1)

function onDragStart(e: DragEvent, sIdx: number, tIdx: number) {
  dragSchemaIdx.value = sIdx
  dragTableIdx.value = tIdx
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
  ;(e.target as HTMLElement)?.classList.add('dragging')
}

function onDragOver(e: DragEvent, sIdx: number) {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  // 仅同一 schema 内才允许拖放
  if (dragSchemaIdx.value !== sIdx) return
  ;(e.currentTarget as HTMLElement)?.classList.add('drag-over')
}

function onDragLeave(e: DragEvent) {
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over')
}

function onDrop(e: DragEvent, sIdx: number, tIdx: number) {
  e.preventDefault()
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over')
  if (dragSchemaIdx.value !== sIdx) return
  if (dragTableIdx.value === tIdx) return
  store.moveTable(sIdx, dragTableIdx.value, tIdx)
}

function onDragEnd(e: DragEvent) {
  ;(e.target as HTMLElement)?.classList.remove('dragging')
  // 清除所有 drag-over 状态
  const overEls = document.querySelectorAll('.sidebar-item.drag-over')
  overEls.forEach(el => el.classList.remove('drag-over'))
  dragSchemaIdx.value = -1
  dragTableIdx.value = -1
}

// ===== Schema CRUD handlers =====
function handleAddSchema() {
  const name = prompt('Schema name:')
  if (name && name.trim()) {
    store.addSchema(name.trim())
  }
}

function handleRenameSchema(sIdx: number) {
  const schema = store.schemas[sIdx]
  if (!schema) return
  const newName = prompt('New name:', schema.schema)
  if (newName && newName.trim() && newName.trim() !== schema.schema) {
    store.renameSchema(sIdx, newName.trim())
  }
}
</script>

<template>
  <!-- ===== Left Sidebar ===== -->
  <div class="sidebar">
    <div class="sidebar-header">
      <span>Navigation</span>
      <span v-if="store.projectOpened" class="add-schema-btn" @click="handleAddSchema" title="Add schema">+</span>
    </div>
    <div class="sidebar-tree">
      <!-- Common Config Entry -->
      <div
        v-if="store.commonConfig"
        class="sidebar-item common-item"
        :class="{ active: store.showCommonPanel }"
        @click="store.selectCommonConfig()"
      >
        <span class="sidebar-icon">&#9881;</span>
        Common Config
      </div>

      <!-- Schema Groups -->
      <template v-for="(schema, sIdx) in store.schemas" :key="schema.schema">
        <div
          class="sidebar-item schema-item"
          :class="{ collapsed: !isExpanded(sIdx) }"
          @click="toggleExpand(sIdx)"
        >
          <span class="sidebar-icon arrow-icon" :class="{ rotated: isExpanded(sIdx) }">&#9654;</span>
          <span class="schema-label">{{ schema.schema }}</span>
          <span class="schema-table-count">{{ schema.tables.length }}</span>
          <span class="schema-action-btn" @click.stop="handleRenameSchema(sIdx)" title="Rename schema">&#9998;</span>
          <span class="schema-action-btn schema-action-delete" @click.stop="store.deleteSchema(sIdx)" title="Delete schema">&times;</span>
          <span class="add-table-btn" @click.stop="store.addTable(sIdx)" title="Add table">+</span>
        </div>
        <div
          v-for="(table, tIdx) in schema.tables"
          v-show="isExpanded(sIdx)"
          :key="table.name + tIdx"
          class="sidebar-item table-item"
          :class="{ active: store.selectedSchemaIdx === sIdx && store.selectedTableIdx === tIdx && !store.showCommonPanel }"
          draggable="true"
          @click="store.selectTable(sIdx, tIdx)"
          @dragstart="onDragStart($event, sIdx, tIdx)"
          @dragover="onDragOver($event, sIdx, tIdx)"
          @dragleave="onDragLeave"
          @drop="onDrop($event, sIdx, tIdx)"
          @dragend="onDragEnd"
        >
          <span class="sidebar-icon">&#9679;</span>
          <span class="table-name">{{ table.name }}</span>
          <span v-if="table.comment" class="table-comment" :title="table.comment">{{ table.comment }}</span>
          <span class="delete-btn" @click.stop="store.deleteTable(sIdx, tIdx)" title="Delete table">&times;</span>
        </div>
      </template>

      <!-- Empty State -->
      <div v-if="!store.projectOpened && store.schemas.length === 0 && !store.commonConfig" class="empty-hint">
        Click "Open Folder" to start
      </div>
    </div>

    <!-- Sidebar Footer -->
    <div v-if="!store.projectOpened" class="sidebar-footer">
      <button class="btn-footer btn-footer-primary" @click="store.openProject()">
        <!-- &#128193; Open -->
        &#128193;&#xFE0E; Open
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ===== Left Sidebar ===== */
.sidebar {
  width: 250px;
  min-width: 250px;
  background: #fff;
  border-right: 1px solid #ddd;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  padding: 10px 12px;
  font-weight: 600;
  font-size: 12px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid #eee;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sidebar-tree {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.sidebar-item {
  padding: 6px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #555;
  transition: background .1s;
  user-select: none;
}

.sidebar-item:hover {
  background: #f0f0f0;
}

.sidebar-item.active {
  background: #e3edf7;
  color: #4a90d9;
  font-weight: 500;
}

.sidebar-item.schema-item {
  font-weight: 600;
  color: #333;
  padding-left: 8px;
  font-size: 13px;
  cursor: pointer;
}

.sidebar-item.schema-item.collapsed {
  cursor: pointer;
}

/* 箭头旋转动画 */
.arrow-icon {
  display: inline-block;
  transition: transform 0.2s ease;
  font-size: 10px;
}
.arrow-icon.rotated {
  transform: rotate(90deg);
}

.sidebar-item.table-item {
  padding-left: 24px;
}

.table-name {
  flex-shrink: 0;
}

.table-comment {
  color: #999;
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.sidebar-item.common-item {
  color: #4a90d9;
  font-weight: 500;
}

.sidebar-icon {
  font-size: 11px;
  opacity: 0.6;
  flex-shrink: 0;
}

.sidebar-item .delete-btn {
  margin-left: auto;
  opacity: 0;
  color: #d9534f;
  cursor: pointer;
  font-size: 11px;
}

.sidebar-item:hover .delete-btn {
  opacity: 0.6;
}

.sidebar-item .delete-btn:hover {
  opacity: 1;
}

.schema-label {
  display: inline-block;
  padding: 2px 8px;
  background: #e8f0fe;
  color: #4a90d9;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
}

.empty-hint {
  padding: 20px;
  text-align: center;
  color: #aaa;
  font-size: 12px;
}

/* ===== Sidebar Footer ===== */
.sidebar-footer {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-top: 1px solid #eee;
  background: #fafafa;
  flex-shrink: 0;
}

.btn-footer {
  padding: 4px 10px;
  border: 1px solid #ddd;
  border-radius: 3px;
  background: #fff;
  color: #555;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  transition: all .15s;
}

.btn-footer:hover {
  background: #e8e8e8;
  border-color: #aaa;
}

.btn-footer-primary {
  background: #4a90d9;
  color: #fff;
  border-color: #4a90d9;
  font-weight: 500;
}

.btn-footer-primary:hover {
  background: #3a7bc8;
  border-color: #3a7bc8;
}

/* ===== Scrollbar ===== */
.sidebar-tree::-webkit-scrollbar {
  width: 6px;
}

.sidebar-tree::-webkit-scrollbar-track {
  background: transparent;
}

.sidebar-tree::-webkit-scrollbar-thumb {
  background: #ccc;
  border-radius: 3px;
}

.sidebar-tree::-webkit-scrollbar-thumb:hover {
  background: #aaa;
}

/* ===== Schema Actions ===== */
.add-schema-btn {
  cursor: pointer;
  font-size: 16px;
  color: #4a90d9;
  font-weight: bold;
  padding: 0 4px;
  line-height: 1;
}
.add-schema-btn:hover {
  color: #3a7bc8;
}

.schema-table-count {
  margin-left: auto;
  font-size: 10px;
  color: #aaa;
}

.schema-item .schema-action-btn,
.schema-item .add-table-btn {
  opacity: 0;
  cursor: pointer;
  font-size: 11px;
  margin-left: 2px;
}
.schema-item:hover .schema-action-btn,
.schema-item:hover .add-table-btn {
  opacity: 0.6;
}
.schema-item .schema-action-btn:hover,
.schema-item .add-table-btn:hover {
  opacity: 1;
}

.schema-action-btn {
  color: #4a90d9;
}
.schema-action-delete {
  color: #d9534f;
}
.add-table-btn {
  color: #5cb85c;
}

/* ===== Drag-and-Drop ===== */
.sidebar-item.table-item.dragging {
  opacity: 0.4;
}

.sidebar-item.table-item.drag-over {
  border-top: 2px solid #4a90d9;
  padding-top: 4px;
}
</style>
