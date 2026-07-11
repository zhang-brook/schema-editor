<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import ImportIcon from './icon/ImportIcon.vue'

const store = useEditorStore()
const { t } = useI18n()

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

// Schema 拖拽排序：dragTableIdx === -1 表示拖拽的是 schema 本身
function onSchemaDragStart(e: DragEvent, sIdx: number) {
  dragSchemaIdx.value = sIdx
  dragTableIdx.value = -1
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
  ;(e.currentTarget as HTMLElement)?.classList.add('dragging')
}

function onDragOver(e: DragEvent, sIdx: number) {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  // 拖拽 schema 时，表项不显示引导线
  if (dragTableIdx.value < 0) return
  ;(e.currentTarget as HTMLElement)?.classList.add('drag-over')
}

function onDragLeave(e: DragEvent) {
  const el = e.currentTarget as HTMLElement
  el?.classList.remove('drag-over')
  el?.classList.remove('drag-over-line')
}

function onDrop(e: DragEvent, sIdx: number, tIdx: number) {
  e.preventDefault()
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over')
  if (dragSchemaIdx.value === sIdx && dragTableIdx.value === tIdx) return
  // 拖拽的是 schema，不处理表项上的 drop
  if (dragTableIdx.value < 0) return
  // 跨 schema 移动
  if (dragSchemaIdx.value !== sIdx) {
    store.moveTableToSchema(dragSchemaIdx.value, dragTableIdx.value, sIdx, tIdx)
    // 自动展开目标 schema
    expandedMap.value[sIdx] = true
  } else {
    store.moveTable(sIdx, dragTableIdx.value, tIdx)
  }
}

// Schema header 上的 drop 处理：
//   - 拖拽表：将表追加到目标 schema 末尾（虚线框引导）
//   - 拖拽 schema：调整 schema 顺序（实线引导线）
function onSchemaDragOver(e: DragEvent, _sIdx: number) {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  if (dragSchemaIdx.value < 0) return
  const el = e.currentTarget as HTMLElement
  if (dragTableIdx.value < 0) {
    // 拖拽 schema：显示实线引导线
    el.classList.add('drag-over-line')
  } else {
    // 拖拽 table：显示虚线框
    el.classList.add('drag-over')
  }
}

function onSchemaDrop(e: DragEvent, sIdx: number) {
  e.preventDefault()
  const el = e.currentTarget as HTMLElement
  el?.classList.remove('drag-over')
  el?.classList.remove('drag-over-line')
  if (dragSchemaIdx.value < 0) return

  // 拖拽的是 schema（非 table），执行 schema 排序
  if (dragTableIdx.value < 0) {
    const fromIdx = dragSchemaIdx.value
    // 延迟到 nextTick：避免在 drop 事件中同步修改 DOM 导致浏览器撤销拖拽
    nextTick(() => {
      store.moveSchema(fromIdx, sIdx)
    })
    return
  }

  // 原有逻辑：将表追加到目标 schema 末尾
  const schema = store.schemas[sIdx]
  if (!schema) return
  store.moveTableToSchema(dragSchemaIdx.value, dragTableIdx.value, sIdx, schema.tables.length)
  // 自动展开目标 schema
  expandedMap.value[sIdx] = true
}

// 尾部 drop 区域：拖到当前 schema 最后一个表之后
function onDropTailOver(e: DragEvent, _sIdx: number) {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  if (dragSchemaIdx.value < 0) return
  // 拖拽 schema 时，表尾 drop 区域不显示引导线
  if (dragTableIdx.value < 0) return
  ;(e.currentTarget as HTMLElement)?.classList.add('drag-over')
}

function onDropTail(e: DragEvent, sIdx: number) {
  e.preventDefault()
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over')
  if (dragSchemaIdx.value < 0 || dragTableIdx.value < 0) return
  const schema = store.schemas[sIdx]
  if (!schema) return
  const targetIdx = schema.tables.length
  if (dragSchemaIdx.value !== sIdx) {
    store.moveTableToSchema(dragSchemaIdx.value, dragTableIdx.value, sIdx, targetIdx)
    expandedMap.value[sIdx] = true
  } else {
    // 同 schema 内移到末尾（toIdx = tables.length 表示追加到最后）
    store.moveTable(sIdx, dragTableIdx.value, schema.tables.length)
  }
}

function onDragEnd(e: DragEvent) {
  ;(e.target as HTMLElement)?.classList.remove('dragging')
  // 清除所有 drag-over 状态
  const overEls = document.querySelectorAll('.sidebar-item.drag-over, .sidebar-item.drag-over-line, .drop-tail.drag-over, .schema-drag-tail.drag-over')
  overEls.forEach(el => {
    el.classList.remove('drag-over')
    el.classList.remove('drag-over-line')
  })
  dragSchemaIdx.value = -1
  dragTableIdx.value = -1
}

// Schema 尾部 drop：将拖拽的 schema 移到列表末尾
function onSchemaTailOver(e: DragEvent) {
  if (dragSchemaIdx.value < 0 || dragTableIdx.value >= 0) return
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  ;(e.currentTarget as HTMLElement)?.classList.add('drag-over')
}

function onSchemaTailDrop(e: DragEvent) {
  e.preventDefault()
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over')
  if (dragSchemaIdx.value < 0 || dragTableIdx.value >= 0) return
  const fromIdx = dragSchemaIdx.value
  nextTick(() => {
    store.moveSchema(fromIdx, store.schemas.length - 1)
  })
}

// ===== Schema CRUD handlers =====
function handleAddSchema() {
  const name = prompt(t('sidebar.prompt.schemaName'))
  if (name && name.trim()) {
    store.addSchema(name.trim())
  }
}

function handleRenameSchema(sIdx: number) {
  const schema = store.schemas[sIdx]
  if (!schema) return
  const newName = prompt(t('sidebar.prompt.newName'), schema.schema)
  if (newName && newName.trim() && newName.trim() !== schema.schema) {
    store.renameSchema(sIdx, newName.trim())
  }
}
</script>

<template>
  <!-- ===== Left Sidebar ===== -->
  <div class="sidebar">
    <div class="sidebar-header">
      <span>{{ $t('sidebar.navigation') }}</span>
      <span v-if="store.projectOpened" class="sidebar-header-actions">
        <span class="sidebar-header-btn" @click="store.openImportSqlModal()" :title="$t('sidebar.importSqlTitle')">
          <ImportIcon style="transform: translateY(1.8px);" />
        </span>
        <span class="sidebar-header-btn add-schema-btn" @click="handleAddSchema" :title="$t('sidebar.addSchema')">
          <span style="transform: scale(1.1);">+</span>
        </span>
      </span>
    </div>
    <div class="sidebar-tree">
      <!-- Schema Groups -->
      <template v-for="(schema, sIdx) in store.schemas" :key="schema.schema">
        <div
          class="sidebar-item schema-item"
          :class="{ collapsed: !isExpanded(sIdx), active: store.selectedSchemaIdx === sIdx && store.selectedTableIdx === -1 && !store.showCommonPanel, 'dragging': dragSchemaIdx === sIdx && dragTableIdx < 0 }"
          draggable="true"
          @click="store.selectSchemaOnly(sIdx)"
          @dragstart="onSchemaDragStart($event, sIdx)"
          @dragover="onSchemaDragOver($event, sIdx)"
          @dragleave="onDragLeave"
          @drop="onSchemaDrop($event, sIdx)"
          @dragend="onDragEnd"
        >
          <span class="sidebar-icon arrow-icon" :class="{ rotated: isExpanded(sIdx) }" @click.stop="toggleExpand(sIdx)">&#9654;</span>
          <span class="schema-label">{{ schema.schema }}</span>

          <span style="margin-left: auto;"></span>
          <span class="schema-action-btn" @click.stop="handleRenameSchema(sIdx)" :title="$t('sidebar.renameSchema')">
            <span style="transform: scaleX(-1); display: inline-block;">&#9998;</span>
          </span>
          <span class="schema-action-btn schema-action-delete" @click.stop="store.deleteSchema(sIdx)" :title="$t('sidebar.deleteSchema')">&times;</span>
          <span class="add-table-btn" @click.stop="store.addTable(sIdx)" :title="$t('sidebar.addTable')">+</span>
          <span class="schema-table-count">{{ schema.tables.length }}</span>
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
          @dragover="onDragOver($event, sIdx)"
          @dragleave="onDragLeave"
          @drop="onDrop($event, sIdx, tIdx)"
          @dragend="onDragEnd"
        >
          <span class="sidebar-icon">&#9679;</span>
          <span class="table-name">{{ table.name }}</span>
          <span v-if="table.comment" class="table-comment" :title="table.comment">{{ table.comment }}</span>
          <span class="delete-btn" @click.stop="store.deleteTable(sIdx, tIdx)" :title="$t('sidebar.deleteTable')">&times;</span>
        </div>
        <!-- 尾部 drop 区域：拖到当前 schema 最后一个表之后 -->
        <!-- 始终占位，用 opacity 控制可见性，避免拖拽开始时布局变化 -->
        <div
          v-show="isExpanded(sIdx) && schema.tables.length > 0"
          class="drop-tail"
          :class="{ 'drag-active': dragSchemaIdx >= 0, 'drag-over': false }"
          @dragover="onDropTailOver($event, sIdx)"
          @dragleave="onDragLeave"
          @drop="onDropTail($event, sIdx)"
        ></div>
      </template>

      <!-- Schema 尾部 drop 区域：拖拽 schema 到列表末尾 -->
      <div
        v-if="store.schemas.length > 0"
        class="schema-drag-tail"
        :class="{ 'drag-active': dragSchemaIdx >= 0, 'drag-over': false }"
        @dragover="onSchemaTailOver"
        @dragleave="onDragLeave"
        @drop="onSchemaTailDrop"
      ></div>
    </div>
  </div>
</template>

<style scoped src="@/assets/style/btn.css"></style>
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
  overflow-x: hidden;
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

.sidebar-item.active,
.schema-item.active {
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
.sidebar-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.sidebar-header-btn {
  cursor: pointer;
  font-size: 16px;
  color: #4a90d9;
  font-weight: bold;
  padding: 0 4px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
}
.sidebar-header-btn:hover {
  color: #3a7bc8;
}

.schema-table-count {
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

.sidebar-item.schema-item.dragging {
  opacity: 0.4;
}

.sidebar-item.table-item.drag-over {
  border-top: 2px solid #4a90d9;
  padding-top: 4px;
}

.sidebar-item.schema-item.drag-over {
  border: 2px dashed #4a90d9;
  padding: 4px 10px;
}

.sidebar-item.schema-item.drag-over-line {
  border-top: 2px solid #4a90d9;
  padding-top: 4px;
}

.drop-tail {
  height: 8px;
  padding: 0 12px 0 24px;
}

.drop-tail.drag-over {
  height: 10px;
  border-top: 2px solid #4a90d9;
}

.schema-drag-tail {
  height: 8px;
  padding: 0 12px;
  opacity: 0;
}

.schema-drag-tail.drag-active {
  opacity: 1;
}

.schema-drag-tail.drag-over {
  height: 10px;
  border-top: 2px solid #4a90d9;
}
</style>
