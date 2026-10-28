<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Index } from 'schema-editor-core/types/schema'
import { useEditorStore } from '@/stores/editor'
import AppSelect from '@/components/ui/AppSelect.vue'
import { useColumnResize } from '@/composables/useColumnResize'
import IndexColumnsEditor from './IndexColumnsEditor.vue'
import type { SqlDialect } from 'schema-editor-core/utils/sql-generator/shared'
import { getTableColumnNames } from 'schema-editor-core/utils/sql-generator/shared'
import { resolveDialectOverride } from 'schema-editor-core/utils/dialect-resolver'
import { buildMysqlActiveExpression, mergeLogicalDelete, resolveIndexLogicalDelete } from 'schema-editor-core/utils/logical-delete'
import { isColumnDragging } from '@/utils/column-drag-flag'

const store = useEditorStore()
const { t } = useI18n()

function indexOverrideType(index: Index, db: SqlDialect): string {
  const value = store.getIndexOverrideValue(index, db, 'type')
  return typeof value === 'string' ? value : ''
}

// Resizable columns: widths reuse the last adjustment (default width if never adjusted)
const { widthStyle, onResizeStart } = useColumnResize('schema-editor.indexTableColWidths', [
  { key: 'name', min: 260, defaultWidth: 320 },
  { key: 'type', min: 96, defaultWidth: 100 },
  { key: 'columns', min: 250, defaultWidth: 270 },
  { key: 'comment', min: 120, defaultWidth: 150 },
])

const availableFieldNames = computed(() => {
  if (!store.currentTable) return []
  return store.currentTable.fields.map(f => f.field_name)
})

// ===== Logical delete awareness =====

/** Project-level logical delete field (used as a placeholder hint for index-level overrides) */
const projectDeleteField = computed(() => store.getLogicalDelete().field ?? '')

function updateIndex(index: Index, patch: Partial<Index>, key?: string) {
  if (store.currentTable) store.updateIndex(store.currentTable, index, patch, key)
}

function setActiveOnly(index: Index, val: boolean) {
  updateIndex(index, { active_only: val ? true : undefined })
}

/** Whether this index is unique under any dialect (plain indexes have no uniqueness conflict, so no toggle is provided) */
function isUniqueIndex(index: Index): boolean {
  return (
    index.type === 'unique' ||
    index.mysql?.type === 'unique' ||
    index.postgresql?.type === 'unique' ||
    index.sqlite?.type === 'unique'
  )
}

/** Index-level override value (an empty string means inheriting the project-level value) */
function ldOverrideValue(index: Index, key: 'field' | 'predicate' | 'mysql_strategy'): string {
  return (index.logical_delete?.[key] as string) ?? ''
}

function setLdOverride(index: Index, key: 'field' | 'predicate' | 'mysql_strategy', val: string) {
  const trimmed = val.trim()
  const next = { ...index.logical_delete }
  if (trimmed) (next as Record<string, unknown>)[key] = trimmed
  else delete next[key]
  updateIndex(index, { logical_delete: Object.keys(next).length ? next : undefined }, `logical-delete:${key}`)
}

/**
 * Resolved effect preview: MySQL shows the index column form, PostgreSQL / SQLite show the WHERE condition.
 * When not in effect, the specific fallback reason is given (silent fallback is the hardest to debug, so each case is stated explicitly).
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

// Index names use a three-part "{pre} + core name + {post}" scheme: users only fill in the middle core part,
// and the prefix/suffix placeholders are expanded automatically per dialect and index type when generating SQL; both can be toggled freely by clicking the badges.
const PRE = '{pre}'
const POST = '{post}'

// Pre/post affixes are enabled by default for new (unnamed) indexes; for existing names they are inferred from whether the placeholder is present
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

// Strip the leading/trailing placeholders from the stored full name to get the editable core name
function getIndexCore(index: Index): string {
  let name = index.name ?? ''
  if (name.startsWith(PRE)) name = name.slice(PRE.length)
  if (name.endsWith(POST)) name = name.slice(0, name.length - POST.length)
  return name
}

// Rebuild the full name from the pre/post toggle states
function composeIndexName(core: string, pre: boolean, post: boolean): string {
  return `${pre ? PRE : ''}${core}${post ? POST : ''}`
}

// Preserve the current pre/post toggle states when writing back the core name
function setIndexCore(index: Index, core: string) {
  updateIndex(index, { name: composeIndexName(core, hasPre(index), hasPost(index)) })
}

// Click badge: toggle whether the prefix / suffix is added automatically
function togglePre(index: Index) {
  updateIndex(index, { name: composeIndexName(getIndexCore(index), !hasPre(index), hasPost(index)) }, 'name-pre')
}

function togglePost(index: Index) {
  updateIndex(index, { name: composeIndexName(getIndexCore(index), hasPre(index), !hasPost(index)) }, 'name-post')
}

/** When "custom name" is unchecked, the default index name is used (the underlying field use_default_name has the opposite semantics, hence the inversion here) */
function isDefaultName(index: Index): boolean {
  return index.use_default_name === true
}

function toggleCustomName(index: Index, custom: boolean) {
  updateIndex(index, { use_default_name: custom ? undefined : true })
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
  // Ignore row-level drag highlight while dragging an index column item
  if (isColumnDragging.value) return
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  ;(e.currentTarget as HTMLElement)?.classList.add('drag-over-row')
}

function onDragLeave(e: DragEvent) {
  if (isColumnDragging.value) return
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-row')
}

function onDrop(e: DragEvent, toIdx: number) {
  if (isColumnDragging.value) return
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
  if (isColumnDragging.value) return
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  ;(e.currentTarget as HTMLElement)?.classList.add('drag-over-tail')
}

function onDropTailLeave(e: DragEvent) {
  if (isColumnDragging.value) return
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-tail')
}

function onDropTail(e: DragEvent) {
  if (isColumnDragging.value) return
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
            <th class="resizable-th" :style="widthStyle('name')">
              {{ $t('indexTable.name') }}
              <span class="col-resizer" @pointerdown="onResizeStart($event, 'name')"></span>
            </th>
            <th class="resizable-th" :style="widthStyle('type')">
              {{ $t('indexTable.type') }}
              <span class="col-resizer" @pointerdown="onResizeStart($event, 'type')"></span>
            </th>
            <th class="resizable-th" :style="widthStyle('columns')">
              {{ $t('indexTable.columns') }}
              <span class="col-resizer" @pointerdown="onResizeStart($event, 'columns')"></span>
            </th>
            <th style="width:96px;">{{ $t('indexTable.using') }}</th>
            <th class="resizable-th" :style="widthStyle('comment')">
              {{ $t('indexTable.comment') }}
              <span class="col-resizer" @pointerdown="onResizeStart($event, 'comment')"></span>
            </th>
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
                    <input type="checkbox" class="mini-checkbox" :checked="!isDefaultName(index)" @change="toggleCustomName(index, ($event.target as HTMLInputElement).checked)">
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
                <AppSelect
                  variant="table"
                  style="width:80px;"
                  :model-value="index.type"
                  :options="[
                    { value: 'index', label: 'index' },
                    { value: 'unique', label: 'unique' },
                  ]"
                  @update:model-value="updateIndex(index, { type: $event })"
                />
              </td>
              <td>
                <IndexColumnsEditor :model-value="index.columns" :available-fields="availableFieldNames" @update:model-value="updateIndex(index, { columns: $event })" />
              </td>
              <td>
                <input class="table-input" :value="index.using" @input="updateIndex(index, { using: ($event.target as HTMLInputElement).value })" style="width:60px;">
              </td>
              <td>
                <input class="table-input" :value="index.comment" @input="updateIndex(index, { comment: ($event.target as HTMLInputElement).value })" :placeholder="$t('indexTable.commentPlaceholder')" style="min-width:100px;">
              </td>
              <td>
                <!-- Logical delete awareness toggle: only unique indexes can be checked; exposed inline to avoid omissions -->
                <label v-if="isUniqueIndex(index)" class="ld-cell" :title="$t('indexTable.activeOnlyTip')">
                  <input type="checkbox" class="table-checkbox" :checked="index.active_only === true" @change="setActiveOnly(index, ($event.target as HTMLInputElement).checked)">
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
                  <!-- Resolved name preview -->
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
                        <AppSelect
                          :model-value="indexOverrideType(index, 'mysql')"
                          :options="[
                            { value: '', label: $t('indexTable.typeSelect') },
                            { value: 'index', label: 'index' },
                            { value: 'unique', label: 'unique' },
                          ]"
                          @update:model-value="store.setIndexOverrideValue(index, 'mysql', 'type', $event)"
                        />
                        <input class="form-input" placeholder="name" :disabled="isDefaultName(index)" :value="store.getIndexOverrideValue(index, 'mysql', 'name')" @input="store.setIndexOverrideValue(index, 'mysql', 'name', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="using" :value="store.getIndexOverrideValue(index, 'mysql', 'using')" @input="store.setIndexOverrideValue(index, 'mysql', 'using', ($event.target as HTMLInputElement).value)">
                      </div>
                      <div class="db-override-group">
                        <div class="db-label">PostgreSQL</div>
                        <AppSelect
                          :model-value="indexOverrideType(index, 'postgresql')"
                          :options="[
                            { value: '', label: $t('indexTable.typeSelect') },
                            { value: 'index', label: 'index' },
                            { value: 'unique', label: 'unique' },
                          ]"
                          @update:model-value="store.setIndexOverrideValue(index, 'postgresql', 'type', $event)"
                        />
                        <input class="form-input" placeholder="name" :disabled="isDefaultName(index)" :value="store.getIndexOverrideValue(index, 'postgresql', 'name')" @input="store.setIndexOverrideValue(index, 'postgresql', 'name', ($event.target as HTMLInputElement).value)">
                      </div>
                      <div class="db-override-group">
                        <div class="db-label">SQLite</div>
                        <AppSelect
                          :model-value="indexOverrideType(index, 'sqlite')"
                          :options="[
                            { value: '', label: $t('indexTable.typeSelect') },
                            { value: 'index', label: 'index' },
                            { value: 'unique', label: 'unique' },
                          ]"
                          @update:model-value="store.setIndexOverrideValue(index, 'sqlite', 'type', $event)"
                        />
                        <input class="form-input" placeholder="name" :disabled="isDefaultName(index)" :value="store.getIndexOverrideValue(index, 'sqlite', 'name')" @input="store.setIndexOverrideValue(index, 'sqlite', 'name', ($event.target as HTMLInputElement).value)">
                      </div>
                    </div>
                  </div>
                  <div class="expand-section">
                    <div class="expand-section-title">{{ $t('indexTable.logicalDelete') }}</div>
                    <label class="index-name-custom" :title="$t('indexTable.activeOnlyTip')">
                      <input type="checkbox" class="table-checkbox" :checked="index.active_only === true" @change="setActiveOnly(index, ($event.target as HTMLInputElement).checked)">
                      <span>{{ $t('indexTable.activeOnly') }}</span>
                    </label>
                    <div class="ld-override-grid">
                      <input
                        class="form-input"
                        :placeholder="$t('indexTable.overrideField') + (projectDeleteField ? `：${projectDeleteField}` : '')"
                        :value="ldOverrideValue(index, 'field')"
                        @input="setLdOverride(index, 'field', ($event.target as HTMLInputElement).value)"
                      >
                      <AppSelect
                        :model-value="ldOverrideValue(index, 'mysql_strategy')"
                        :options="[
                          { value: '', label: $t('indexTable.overrideStrategy') + $t('indexTable.inherit') },
                          { value: 'functional', label: $t('logicalDelete.functional') },
                          { value: 'timestamp_union', label: $t('logicalDelete.timestampUnion') },
                        ]"
                        @update:model-value="setLdOverride(index, 'mysql_strategy', $event)"
                      />
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
                    <input class="form-input" :value="index.pre_comment" @input="updateIndex(index, { pre_comment: ($event.target as HTMLInputElement).value })" :placeholder="$t('indexTable.preCommentPlaceholder')">
                  </div>
                </div>
              </td>
            </tr>
          </template>
          <!-- Tail drop zone -->
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
      <div v-else style="padding: 14px; color: var(--fg-subtle); font-size: 12px; text-align: center;">
        {{ $t('indexTable.empty') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.indexes-table {
  border-collapse: collapse;
  /* Fixed layout: column widths are fully determined by the header widths, so narrowing by dragging takes effect immediately */
  table-layout: fixed;
}

.indexes-table th,
.indexes-table td {
  overflow: hidden;
}

/* Three-part index name input: "custom name" checkbox + {pre} badge + core name + {post} badge (always a single line) */
.index-name-group {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 220px;
}

/* "Custom name" checkbox: when unchecked, naming is left to the database / generator defaults */
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

/* Enabled state (solid blue): the corresponding pre/post affix is added automatically; the disabled state is a gray dashed border */
.index-name-affix.is-active {
  background: var(--accent-subtle);
  color: var(--accent);
  border-style: solid;
  border-color: var(--accent);
  opacity: 1;
}

/* Overrides width:100% from .table-input so the input does not take a whole line in the flex row and push {post} onto the next line */
.index-name-core {
  flex: 1 1 auto;
  width: auto;
  min-width: 90px;
}

/* Dimmed when "custom name" is unchecked, indicating it does not participate in name resolution */
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

/* Inline "only constrain non-deleted rows" toggle */
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

/* Logical delete override row: field name + MySQL strategy */
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

/* Resolved name preview (kept consistent with the resolved type preview in FieldTable) */
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

/* Drag-and-drop sorting styles */
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
  color: var(--fg-subtle);
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

</style>
