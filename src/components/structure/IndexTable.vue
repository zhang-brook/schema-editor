<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Index } from '@/types/schema'
import { useEditorStore } from '@/stores/editor'
import IndexColumnsEditor from './IndexColumnsEditor.vue'
import type { SqlDialect } from '@/utils/sql-generator/shared'
import { getTableColumnNames } from '@/utils/sql-generator/shared'
import { resolveDialectOverride } from '@/utils/dialect-resolver'
import { buildMysqlActiveExpression, mergeLogicalDelete, resolveIndexLogicalDelete } from '@/utils/logical-delete'

const store = useEditorStore()
const { t } = useI18n()

const availableFieldNames = computed(() => {
  if (!store.currentTable) return []
  return store.currentTable.fields.map(f => f.field_name)
})

// ===== 逻辑删除感知 =====

/** 项目级逻辑删除字段（作为索引级覆盖的占位提示） */
const projectDeleteField = computed(() => store.getLogicalDelete().field ?? '')

function setActiveOnly(index: Index, val: boolean) {
  index.active_only = val ? true : undefined
}

/** 该索引在任一方言下是否为唯一索引（普通索引无唯一性冲突，不提供开关） */
function isUniqueIndex(index: Index): boolean {
  return (
    index.type === 'unique' ||
    index.mysql?.type === 'unique' ||
    index.postgresql?.type === 'unique' ||
    index.sqlite?.type === 'unique'
  )
}

/** 索引级覆盖值（空串表示继承项目级） */
function ldOverrideValue(index: Index, key: 'field' | 'predicate' | 'mysql_strategy'): string {
  return (index.logical_delete?.[key] as string) ?? ''
}

function setLdOverride(index: Index, key: 'field' | 'predicate' | 'mysql_strategy', val: string) {
  const trimmed = val.trim()
  if (!trimmed) {
    if (index.logical_delete) {
      delete index.logical_delete[key]
      if (Object.keys(index.logical_delete).length === 0) index.logical_delete = undefined
    }
    return
  }
  if (!index.logical_delete) index.logical_delete = {}
  ;(index.logical_delete as Record<string, unknown>)[key] = trimmed
}

/**
 * 解析后效果预览：MySQL 给出索引列形态，PostgreSQL / SQLite 给出 WHERE 条件。
 * 未生效时给出具体降级原因（静默降级最难排查，故逐条显式说明）。
 */
function ldEffect(index: Index, dialect: SqlDialect): string {
  const table = store.currentTable
  if (!table) return '-'
  const cfg = mergeLogicalDelete(index, store.commonConfig)
  if (cfg.enabled !== true) return t('indexTable.ldNotEnabled')
  const field = (cfg.field ?? '').trim()
  if (!field) return t('indexTable.ldNoField')
  if (!getTableColumnNames(table, store.commonConfig).includes(field)) {
    return t('indexTable.ldFieldMissing', { field })
  }
  if (index.active_only !== true) return t('indexTable.notApplied')
  if (resolveDialectOverride(index, dialect, 'type', index.type) !== 'unique') {
    return t('indexTable.ldNotUnique')
  }
  const resolved = resolveIndexLogicalDelete(index, table, dialect, store.commonConfig)
  if (!resolved) return t('indexTable.notApplied')
  if (dialect === 'mysql') {
    if (resolved.mysqlStrategy === 'functional') {
      return index.columns.map(c => `(${buildMysqlActiveExpression(c.name, resolved.field)})`).join(', ')
    }
    return [...index.columns.map(c => c.name), resolved.field].map(c => `\`${c}\``).join(', ')
  }
  return `WHERE ${resolved.predicate}`
}

// 索引名称采用「{pre} + 核心名 + {post}」三段式：用户只需填写中间核心部分，
// 前后缀占位符在生成 SQL 时按方言与索引类型自动展开；且前后缀均可点击徽标自由开关。
const PRE = '{pre}'
const POST = '{post}'

// 新建（未设置名称）时默认开启前后缀；已有名称则依据是否包含占位符判断
function hasPre(index: Index): boolean {
  const name = index.name
  if (name == null) return true
  return name.startsWith(PRE)
}

function hasPost(index: Index): boolean {
  const name = index.name
  if (name == null) return true
  return name.endsWith(POST)
}

// 从存储的完整名称中剥离首尾占位符，得到中间可编辑的核心名
function getIndexCore(index: Index): string {
  let name = index.name ?? ''
  if (name.startsWith(PRE)) name = name.slice(PRE.length)
  if (name.endsWith(POST)) name = name.slice(0, name.length - POST.length)
  return name
}

// 按前后缀开关状态重建完整名称
function composeIndexName(core: string, pre: boolean, post: boolean): string {
  return `${pre ? PRE : ''}${core}${post ? POST : ''}`
}

// 回写核心名时保留当前前后缀开关状态
function setIndexCore(index: Index, core: string) {
  index.name = composeIndexName(core, hasPre(index), hasPost(index))
}

// 点击徽标：切换是否自动添加前缀 / 后缀
function togglePre(index: Index) {
  index.name = composeIndexName(getIndexCore(index), !hasPre(index), hasPost(index))
}

function togglePost(index: Index) {
  index.name = composeIndexName(getIndexCore(index), hasPre(index), !hasPost(index))
}

/** 未勾选「自定义名称」即使用默认索引名（底层字段 use_default_name 语义相反，此处做翻转） */
function isDefaultName(index: Index): boolean {
  return index.use_default_name === true
}

function toggleCustomName(index: Index, custom: boolean) {
  index.use_default_name = custom ? undefined : true
}

// ===== Drag-and-drop for Indexes =====
const dragIndexIdx = ref(-1)

function onDragStart(e: DragEvent, idx: number) {
  dragIndexIdx.value = idx
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
  const tr = (e.currentTarget as HTMLElement).closest('tr')
  tr?.classList.add('row-dragging')
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  ;(e.currentTarget as HTMLElement)?.classList.add('drag-over-row')
}

function onDragLeave(e: DragEvent) {
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-row')
}

function onDrop(e: DragEvent, toIdx: number) {
  e.preventDefault()
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-row')
  const fromIdx = dragIndexIdx.value
  dragIndexIdx.value = -1
  if (fromIdx < 0 || fromIdx === toIdx || !store.currentTable) return
  store.moveIndex(store.currentTable, fromIdx, toIdx)
}

function onDragEnd(e: DragEvent) {
  const tr = (e.currentTarget as HTMLElement).closest('tr')
  tr?.classList.remove('row-dragging')
  document.querySelectorAll('.drag-over-row, .drag-over-tail').forEach(el => el.classList.remove('drag-over-row', 'drag-over-tail'))
  dragIndexIdx.value = -1
}

function onDropTailOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  ;(e.currentTarget as HTMLElement)?.classList.add('drag-over-tail')
}

function onDropTailLeave(e: DragEvent) {
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-tail')
}

function onDropTail(e: DragEvent) {
  e.preventDefault()
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-tail')
  const fromIdx = dragIndexIdx.value
  dragIndexIdx.value = -1
  if (fromIdx < 0 || !store.currentTable) return
  const arr = store.currentTable.indexes
  if (fromIdx === arr.length - 1) return
  store.moveIndex(store.currentTable, fromIdx, arr.length)
}
</script>

<template>
  <div class="section-card" v-if="store.currentTable">
    <div class="section-header">
      {{ $t('indexTable.indexes') }}
      <span class="badge">{{ store.currentTable.indexes.length }}</span>
      <button class="btn btn-sm btn-primary" style="margin-left:auto;" @click="store.addIndex(store.currentTable!)">{{ $t('indexTable.addIndex') }}</button>
    </div>
    <div class="section-body" style="padding: 0; overflow-x: auto;">
      <table class="indexes-table" v-if="store.currentTable.indexes.length > 0">
        <thead>
          <tr>
            <th style="width:24px;"></th>
            <th style="width:30px;"></th>
            <th>{{ $t('indexTable.name') }}</th>
            <th>{{ $t('indexTable.type') }}</th>
            <th>{{ $t('indexTable.columns') }}</th>
            <th>{{ $t('indexTable.using') }}</th>
            <th>{{ $t('indexTable.comment') }}</th>
            <th style="width:70px;" :title="$t('indexTable.activeOnlyTip')">{{ $t('indexTable.activeOnlyShort') }}</th>
            <th style="width:50px;">{{ $t('indexTable.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(index, iIdx) in store.currentTable.indexes" :key="iIdx">
            <tr
              @dragover="onDragOver"
              @dragleave="onDragLeave"
              @drop="onDrop($event, iIdx)"
            >
              <td
                class="drag-handle-cell"
                draggable="true"
                @dragstart="onDragStart($event, iIdx)"
                @dragend="onDragEnd"
              >
                <span class="drag-handle" :title="$t('commonConfig.dragToSort')">⋮⋮</span>
              </td>
              <td>
                <span class="expand-toggle" @click="store.toggleIndexExpand(store.indexKey(store.currentSchema!, store.currentTable!, index, iIdx))">
                  {{ store.expandedIndexes.has(store.indexKey(store.currentSchema!, store.currentTable!, index, iIdx)) ? '▼' : '▶' }}
                </span>
              </td>
              <td>
                <div class="index-name-group">
                  <label class="index-name-custom" :title="$t('indexTable.customNameTip')">
                    <input type="checkbox" :checked="!isDefaultName(index)" @change="toggleCustomName(index, ($event.target as HTMLInputElement).checked)">
                    <span>{{ $t('indexTable.customName') }}</span>
                    <span v-if="isDefaultName(index)">{{ $t('indexTable.autoGeneratedName') }}</span>
                  </label>
                  <button
                    type="button"
                    class="index-name-affix"
                    :class="{ 'is-active': hasPre(index) }"
                    :title="$t('indexTable.preAffixTip')"
                    v-if="!isDefaultName(index)"
                    @click="togglePre(index)"
                  >{pre}</button>
                  <input
                    class="table-input index-name-core"
                    :value="getIndexCore(index)"
                    @input="setIndexCore(index, ($event.target as HTMLInputElement).value)"
                    :placeholder="isDefaultName(index) ? '' : $t('indexTable.namePlaceholder')"
                    v-if="!isDefaultName(index)"
                  >
                  <button
                    type="button"
                    class="index-name-affix"
                    :class="{ 'is-active': hasPost(index) }"
                    :title="$t('indexTable.postAffixTip')"
                    v-if="!isDefaultName(index)"
                    @click="togglePost(index)"
                  >{post}</button>
                </div>
              </td>
              <td>
                <select class="form-input" v-model="index.type" style="width:80px;">
                  <option value="index">index</option>
                  <option value="unique">unique</option>
                </select>
              </td>
              <td style="min-width:240px;">
                <IndexColumnsEditor v-model="index.columns" :available-fields="availableFieldNames" />
              </td>
              <td>
                <input class="table-input" v-model="index.using" style="width:60px;">
              </td>
              <td>
                <input class="table-input" v-model="index.comment" :placeholder="$t('indexTable.commentPlaceholder')" style="min-width:100px;">
              </td>
              <td>
                <!-- 逻辑删除感知开关：仅 unique 索引可勾选，直接暴露在行内避免遗漏 -->
                <label v-if="isUniqueIndex(index)" class="ld-cell" :title="$t('indexTable.activeOnlyTip')">
                  <input type="checkbox" :checked="index.active_only === true" @change="setActiveOnly(index, ($event.target as HTMLInputElement).checked)">
                </label>
                <span v-else class="ld-na">-</span>
              </td>
              <td>
                <div class="move-btns">
                  <button class="move-btn" @click="store.moveIndexUp(store.currentTable!, iIdx)" :disabled="iIdx === 0" :title="$t('commonConfig.moveUp')">↑</button>
                  <button class="move-btn" @click="store.moveIndexDown(store.currentTable!, iIdx)" :disabled="iIdx === store.currentTable!.indexes.length - 1" :title="$t('commonConfig.moveDown')">↓</button>
                </div>
                <button class="btn btn-sm btn-danger" @click="store.deleteIndex(store.currentTable!, iIdx)">×</button>
              </td>
            </tr>
            <!-- Expanded Index Detail -->
            <tr v-if="store.expandedIndexes.has(store.indexKey(store.currentSchema!, store.currentTable!, index, iIdx))">
              <td colspan="9">
                <div class="field-expand-content">
                  <!-- 解析后名称预览 -->
                  <div class="expand-section">
                    <div class="expand-section-title">{{ $t('indexTable.resolvedName') }}</div>
                    <div class="resolved-type-row">
                      <span class="db-label">MySQL:</span>
                      <code>{{ store.getResolvedIndexNameForDb(index, store.currentTable!, 'mysql') }}</code>
                      <span class="db-label" style="margin-left:16px;">PostgreSQL:</span>
                      <code>{{ store.getResolvedIndexNameForDb(index, store.currentTable!, 'postgresql') }}</code>
                      <span class="db-label" style="margin-left:16px;">SQLite:</span>
                      <code>{{ store.getResolvedIndexNameForDb(index, store.currentTable!, 'sqlite') }}</code>
                    </div>
                  </div>
                  <div class="expand-section">
                    <div class="expand-section-title">{{ $t('indexTable.indexOverrides') }}</div>
                    <div class="db-override-grid">
                      <div class="db-override-group">
                        <div class="db-label">MySQL</div>
                        <select class="form-input" :value="store.getIndexOverrideValue(index, 'mysql', 'type')" @input="store.setIndexOverrideValue(index, 'mysql', 'type', ($event.target as HTMLSelectElement).value)">
                          <option value="">{{ $t('indexTable.typeSelect') }}</option>
                          <option value="index">index</option>
                          <option value="unique">unique</option>
                        </select>
                        <input class="form-input" placeholder="name" :disabled="isDefaultName(index)" :value="store.getIndexOverrideValue(index, 'mysql', 'name')" @input="store.setIndexOverrideValue(index, 'mysql', 'name', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="using" :value="store.getIndexOverrideValue(index, 'mysql', 'using')" @input="store.setIndexOverrideValue(index, 'mysql', 'using', ($event.target as HTMLInputElement).value)">
                      </div>
                      <div class="db-override-group">
                        <div class="db-label">PostgreSQL</div>
                        <select class="form-input" :value="store.getIndexOverrideValue(index, 'postgresql', 'type')" @input="store.setIndexOverrideValue(index, 'postgresql', 'type', ($event.target as HTMLSelectElement).value)">
                          <option value="">{{ $t('indexTable.typeSelect') }}</option>
                          <option value="index">index</option>
                          <option value="unique">unique</option>
                        </select>
                        <input class="form-input" placeholder="name" :disabled="isDefaultName(index)" :value="store.getIndexOverrideValue(index, 'postgresql', 'name')" @input="store.setIndexOverrideValue(index, 'postgresql', 'name', ($event.target as HTMLInputElement).value)">
                      </div>
                      <div class="db-override-group">
                        <div class="db-label">SQLite</div>
                        <select class="form-input" :value="store.getIndexOverrideValue(index, 'sqlite', 'type')" @input="store.setIndexOverrideValue(index, 'sqlite', 'type', ($event.target as HTMLSelectElement).value)">
                          <option value="">{{ $t('indexTable.typeSelect') }}</option>
                          <option value="index">index</option>
                          <option value="unique">unique</option>
                        </select>
                        <input class="form-input" placeholder="name" :disabled="isDefaultName(index)" :value="store.getIndexOverrideValue(index, 'sqlite', 'name')" @input="store.setIndexOverrideValue(index, 'sqlite', 'name', ($event.target as HTMLInputElement).value)">
                      </div>
                    </div>
                  </div>
                  <div class="expand-section">
                    <div class="expand-section-title">{{ $t('indexTable.logicalDelete') }}</div>
                    <label class="index-name-custom" :title="$t('indexTable.activeOnlyTip')">
                      <input type="checkbox" :checked="index.active_only === true" @change="setActiveOnly(index, ($event.target as HTMLInputElement).checked)">
                      <span>{{ $t('indexTable.activeOnly') }}</span>
                    </label>
                    <div class="ld-override-grid">
                      <input
                        class="form-input"
                        :placeholder="$t('indexTable.overrideField') + (projectDeleteField ? `：${projectDeleteField}` : '')"
                        :value="ldOverrideValue(index, 'field')"
                        @input="setLdOverride(index, 'field', ($event.target as HTMLInputElement).value)"
                      >
                      <select
                        class="form-input"
                        :value="ldOverrideValue(index, 'mysql_strategy')"
                        @change="setLdOverride(index, 'mysql_strategy', ($event.target as HTMLSelectElement).value)"
                      >
                        <option value="">{{ $t('indexTable.overrideStrategy') }}{{ $t('indexTable.inherit') }}</option>
                        <option value="functional">{{ $t('logicalDelete.functional') }}</option>
                        <option value="timestamp_union">{{ $t('logicalDelete.timestampUnion') }}</option>
                      </select>
                    </div>
                    <div class="resolved-type-row">
                      <span class="db-label">MySQL:</span>
                      <code>{{ ldEffect(index, 'mysql') }}</code>
                      <span class="db-label" style="margin-left:16px;">PostgreSQL:</span>
                      <code>{{ ldEffect(index, 'postgresql') }}</code>
                      <span class="db-label" style="margin-left:16px;">SQLite:</span>
                      <code>{{ ldEffect(index, 'sqlite') }}</code>
                    </div>
                  </div>
                  <div class="expand-section">
                    <div class="expand-section-title">{{ $t('indexTable.preComment') }}</div>
                    <input class="form-input" v-model="index.pre_comment" :placeholder="$t('indexTable.preCommentPlaceholder')">
                  </div>
                </div>
              </td>
            </tr>
          </template>
          <!-- 尾部 drop 区域 -->
          <tr
            v-if="store.currentTable.indexes.length > 0"
            class="drop-tail-row"
            @dragover="onDropTailOver"
            @dragleave="onDropTailLeave"
            @drop="onDropTail"
          >
            <td :colspan="9"></td>
          </tr>
        </tbody>
      </table>
      <div v-else style="padding: 14px; color: #aaa; font-size: 12px; text-align: center;">
        {{ $t('indexTable.empty') }}
      </div>
    </div>
  </div>
</template>

<style scoped src="@/assets/style/section.css"></style>
<style scoped src="@/assets/style/table.css"></style>
<style scoped src="@/assets/style/form.css"></style>
<style scoped src="@/assets/style/btn.css"></style>
<style scoped src="@/assets/style/expand.css"></style>
<style scoped src="@/assets/style/move-btn.css"></style>
<style scoped>
.indexes-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.indexes-table th,
.indexes-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-muted);
  text-align: left;
  vertical-align: middle;
}

.indexes-table th {
  background: var(--surface-2);
  font-weight: 600;
  color: var(--code-thumb);
  font-size: 11px;
  white-space: nowrap;
}

.indexes-table tbody tr:hover {
  background: var(--surface-2);
}

.table-input {
  padding: 3px 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-family: inherit;
  width: 100%;
  box-sizing: border-box;
}

.table-input:focus {
  outline: none;
  border-color: var(--accent);
}

/* 三段式索引名输入：「自定义名称」复选框 + {pre} 徽标 + 核心名 + {post} 徽标（始终单行） */
.index-name-group {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 220px;
}

/* 「自定义名称」复选框：不勾选即交给数据库 / 生成器默认命名 */
.index-name-custom {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--fg-subtle);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.index-name-custom input {
  margin: 0;
  cursor: pointer;
}

.index-name-affix {
  flex: none;
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--fg-subtle);
  border: 1px dashed var(--border);
  font-size: 11px;
  font-family: 'Consolas', 'Monaco', monospace;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
  opacity: 0.6;
}

.index-name-affix:hover {
  border-color: var(--accent);
  color: var(--accent);
  opacity: 1;
}

/* 启用态（蓝色实线）：会自动添加对应前/后缀；关闭态为灰色虚线 */
.index-name-affix.is-active {
  background: var(--accent-subtle);
  color: var(--accent);
  border-style: solid;
  border-color: var(--accent);
  opacity: 1;
}

/* 覆盖 .table-input 的 width:100%，避免在 flex 行内独占一行把 {post} 挤到下一行 */
.index-name-core {
  flex: 1 1 auto;
  width: auto;
  min-width: 90px;
}

/* 未勾选「自定义名称」时置灰，表示当前不参与名称解析 */
.index-name-affix:disabled,
.index-name-core:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.index-name-affix:disabled:hover {
  border-color: var(--border);
  color: var(--fg-subtle);
  opacity: 0.4;
}

/* 行内「仅约束未删除行」开关 */
.ld-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.ld-cell input {
  margin: 0;
  cursor: pointer;
}

.ld-na {
  display: block;
  text-align: center;
  color: var(--fg-subtle);
}

/* 逻辑删除覆盖行：字段名 + MySQL 策略 */
.ld-override-grid {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0;
}

.ld-override-grid .form-input {
  flex: 1 1 auto;
  min-width: 120px;
}

/* 解析后名称预览（与 FieldTable 的解析类型预览保持一致） */
.resolved-type-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.resolved-type-row code {
  background: var(--accent-subtle);
  color: var(--fg);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-family: 'Consolas', 'Monaco', monospace;
}

.btn {
  padding: 4px 10px;
  border: 1px solid var(--border);
  background: #fff;
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}

.btn:hover {
  background: var(--surface-2);
}

.btn-primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-danger {
  color: var(--danger);
  border-color: var(--danger);
}

.btn-danger:hover {
  background: var(--danger-subtle);
}

/* 拖拽排序样式 */
.drag-handle-cell {
  cursor: grab;
  text-align: center;
  padding: 4px 6px !important;
  user-select: none;
}

.drag-handle {
  color: var(--border);
  font-size: 18px;
  letter-spacing: -2px;
  line-height: 1;
  transition: color .15s;
}

.drag-handle-cell:hover .drag-handle {
  color: #999;
}

.row-dragging {
  opacity: 0.4;
}

.drag-over-row {
  border-top: 2px solid var(--accent) !important;
}

.drop-tail-row {
  height: 8px;
}

.drop-tail-row td {
  padding: 0 !important;
  border-bottom: none;
}

.drop-tail-row.drag-over-tail {
  border-top: 2px solid var(--accent);
}

.btn-sm {
  padding: 2px 6px;
  font-size: 11px;
}

</style>
