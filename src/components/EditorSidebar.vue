<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import ImportIcon from './icon/ImportIcon.vue'
import CopyIcon from './icon/CopyIcon.vue'

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

// ===== Schema 原地重命名 =====
const editingSchemaIdx = ref(-1)
const editingSchemaName = ref('')

// 输入框挂载时立即聚焦并全选（函数 ref：v-if 内元素挂载即触发）
function focusRenameInput(el: unknown) {
  if (el instanceof HTMLInputElement) {
    el.focus()
    el.select()
  }
}

function startRenameSchema(sIdx: number) {
  const schema = store.schemas[sIdx]
  if (!schema) return
  editingSchemaIdx.value = sIdx
  editingSchemaName.value = schema.schema
}

function finishRenameSchema() {
  const sIdx = editingSchemaIdx.value
  if (sIdx < 0) return
  const schema = store.schemas[sIdx]
  editingSchemaIdx.value = -1
  if (!schema) return
  const newName = editingSchemaName.value.trim()
  if (newName && newName !== schema.schema) {
    store.renameSchema(sIdx, newName)
  }
}

function cancelRenameSchema() {
  editingSchemaIdx.value = -1
  editingSchemaName.value = ''
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
          :class="{ collapsed: !isExpanded(sIdx), active: store.selectedSchemaIdx === sIdx && store.selectedTableIdx === -1, 'dragging': dragSchemaIdx === sIdx && dragTableIdx < 0 }"
          draggable="true"
          @click="store.selectSchemaOnly(sIdx)"
          @dragstart="onSchemaDragStart($event, sIdx)"
          @dragover="onSchemaDragOver($event, sIdx)"
          @dragleave="onDragLeave"
          @drop="onSchemaDrop($event, sIdx)"
          @dragend="onDragEnd"
        >
          <span class="sidebar-icon arrow-icon" :class="{ rotated: isExpanded(sIdx) }" @click.stop="toggleExpand(sIdx)">&#9654;</span>
          <input
            v-if="editingSchemaIdx === sIdx"
            :ref="focusRenameInput"
            class="schema-rename-input"
            v-model="editingSchemaName"
            @click.stop
            @blur="finishRenameSchema"
            @keyup.enter="($event.target as HTMLInputElement).blur()"
            @keyup.escape="cancelRenameSchema"
          />
          <span v-else class="schema-label" :title="schema.schema">{{ schema.schema }}</span>

          <span class="item-actions">
            <span class="item-action rename-action" @click.stop="startRenameSchema(sIdx)" :title="$t('sidebar.renameSchema')">
              <span style="transform: scaleX(-1); display: inline-block;">&#9998;</span>
            </span>
            <span class="item-action copy-action" @click.stop="store.copySchema(sIdx)" :title="$t('sidebar.copySchema')">
              <CopyIcon />
            </span>
            <span class="item-action delete-action" @click.stop="store.deleteSchema(sIdx)" :title="$t('sidebar.deleteSchema')">&times;</span>
            <span class="item-action add-table-action" @click.stop="store.addTable(sIdx)" :title="$t('sidebar.addTable')">+</span>
            <span class="item-count">{{ schema.tables.length }}</span>
          </span>
        </div>
        <div
          v-for="(table, tIdx) in schema.tables"
          v-show="isExpanded(sIdx)"
          :key="table.name + tIdx"
          class="sidebar-item table-item"
          :class="{ active: store.selectedSchemaIdx === sIdx && store.selectedTableIdx === tIdx }"
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
          <span class="item-actions">
            <span class="item-action copy-action" @click.stop="store.copyTable(sIdx, tIdx)" :title="$t('sidebar.copyTable')">
              <CopyIcon />
            </span>
            <span class="item-action delete-action" @click.stop="store.deleteTable(sIdx, tIdx)" :title="$t('sidebar.deleteTable')">&times;</span>
          </span>
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
  width: var(--sidebar-width, 250px);
  min-width: var(--sidebar-width, 250px);
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  padding: 12px 14px;
  font-weight: 600;
  font-size: 11px;
  color: var(--fg-subtle);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sidebar-tree {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 8px;
}

.sidebar-item {
  padding: 7px 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--fg);
  border-radius: var(--radius-sm);
  transition: background .12s ease, color .12s ease;
  user-select: none;
  position: relative;
  --row-hover-bg: var(--surface-3);
}

.sidebar-item:hover {
  background: var(--surface-3);
}

.sidebar-item.active,
.schema-item.active {
  --row-hover-bg: var(--accent-subtle);
  background: var(--accent-subtle);
  color: var(--accent-active);
  font-weight: 600;
  box-shadow: inset 3px 0 0 var(--accent);
}

.sidebar-item.schema-item {
  font-weight: 600;
  color: var(--fg);
  padding-left: 10px;
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
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  color: var(--accent);
  font-weight: 500;
}

.sidebar-icon {
  font-size: 11px;
  opacity: 0.6;
  flex-shrink: 0;
}

/* 行内操作按钮组：绝对定位于行右侧，不占布局空间（不悬浮时不会留白）。
   悬浮时按钮淡入，并用渐变遮罩其下的文字；渐变从第一个按钮的左边缘开始变实。 */
.item-actions {
  --actions-fade: 28px;
  position: absolute;
  top: 0;
  bottom: 0;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  z-index: 1;
  pointer-events: none;       /* 容器本身不拦截点击，保证行可选中 */
}

/* 渐变遮罩：左侧透明（露出文字）→ 到第一个按钮左缘变为行背景色（遮住文字） */
.item-actions::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(-1 * var(--actions-fade));
  right: 0;
  z-index: -1;
  pointer-events: none;
  opacity: 0;
  background: linear-gradient(to right, transparent, var(--row-hover-bg) var(--actions-fade));
  transition: opacity .12s ease;
}

.sidebar-item:hover .item-actions::before {
  opacity: 1;
}

.item-action {
  opacity: 0;
  pointer-events: none;
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  color: var(--accent);
  transition: opacity .12s ease, color .12s ease;
}

.sidebar-item:hover .item-action {
  opacity: 0.6;
  pointer-events: auto;
}

.item-action:hover {
  opacity: 1;
}

.item-action.delete-action {
  color: var(--danger);
}

.item-action.add-table-action {
  color: var(--success);
}

.item-count {
  font-size: 10px;
  color: #aaa;
  min-width: 14px;
  text-align: center;
}

.schema-label {
  display: inline-block;
  padding: 2px 8px;
  background: var(--accent-subtle);
  color: var(--accent);
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 500;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
  flex-shrink: 1;
}

.schema-rename-input {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 150px;
  padding: 2px 6px;
  font-size: 12px;
  color: var(--fg);
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  outline: none;
}

/* ===== Scrollbar ===== */
.sidebar-tree::-webkit-scrollbar {
  width: 6px;
}

.sidebar-tree::-webkit-scrollbar-track {
  background: transparent;
}

.sidebar-tree::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: var(--radius-sm);
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
  color: var(--accent);
  font-weight: bold;
  padding: 0 4px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
}
.sidebar-header-btn:hover {
  color: var(--accent-hover);
}

/* Schema / 表项的操作按钮样式统一由上方 .item-actions / .item-action / .item-count 处理 */

/* ===== Drag-and-Drop ===== */
.sidebar-item.table-item.dragging {
  opacity: 0.4;
}

.sidebar-item.schema-item.dragging {
  opacity: 0.4;
}

.sidebar-item.table-item.drag-over {
  border-top: 2px solid var(--accent);
  padding-top: 4px;
}

.sidebar-item.schema-item.drag-over {
  border: 2px dashed var(--accent);
  padding: 4px 10px;
}

.sidebar-item.schema-item.drag-over-line {
  border-top: 2px solid var(--accent);
  padding-top: 4px;
}

.drop-tail {
  height: 8px;
  padding: 0 12px 0 24px;
}

.drop-tail.drag-over {
  height: 10px;
  border-top: 2px solid var(--accent);
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
  border-top: 2px solid var(--accent);
}
</style>
