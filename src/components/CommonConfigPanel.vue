<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import type { UnifiedTypeDefinition } from '@/types/schema'
import { displayFieldLength, displayFieldScale, parseFieldLengthInput, parseFieldScaleInput } from '@/utils/file-helpers'
import { getGlobalPreSql, getGlobalPostSql } from '@/utils/sql-generator/shared'
import CommonUsedFieldsPanel from './panel/CommonUsedFieldsPanel.vue'
import PrePostSqlEditor from './PrePostSqlEditor.vue'

const store = useEditorStore()
const { t } = useI18n()

// ===== Unified Types sort (move up/down) =====
function moveUnifiedTypeUp(idx: number) {
  if (idx <= 0) return
  const arr = localUnifiedTypes.value;
  [arr[idx - 1], arr[idx]] = [arr[idx]!, arr[idx - 1]!]
  syncUnifiedTypes()
}

function moveUnifiedTypeDown(idx: number) {
  if (idx >= localUnifiedTypes.value.length - 1) return
  const arr = localUnifiedTypes.value;
  [arr[idx], arr[idx + 1]] = [arr[idx + 1]!, arr[idx]!]
  syncUnifiedTypes()
}

// ===== Drag-and-drop for Unified Types =====
const dragUnifiedTypeIdx = ref(-1)

function onUnifiedTypeDragStart(e: DragEvent, idx: number) {
  dragUnifiedTypeIdx.value = idx
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
  const tr = (e.currentTarget as HTMLElement).closest('tr')
  tr?.classList.add('row-dragging')
}

function onUnifiedTypeDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  ;(e.currentTarget as HTMLElement)?.classList.add('drag-over-row')
}

function onUnifiedTypeDragLeave(e: DragEvent) {
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-row')
}

function onUnifiedTypeDrop(e: DragEvent, toIdx: number) {
  e.preventDefault()
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-row')
  const fromIdx = dragUnifiedTypeIdx.value
  if (fromIdx < 0 || fromIdx === toIdx) return
  const arr = localUnifiedTypes.value
  const [item] = arr.splice(fromIdx, 1)
  if (item) {
    const insertIdx = toIdx > fromIdx ? toIdx - 1 : toIdx
    arr.splice(insertIdx, 0, item)
    syncUnifiedTypes()
  }
  dragUnifiedTypeIdx.value = -1
}

function onUnifiedTypeDragEnd(e: DragEvent) {
  const tr = (e.currentTarget as HTMLElement).closest('tr')
  tr?.classList.remove('row-dragging')
  document.querySelectorAll('.drag-over-row, .drag-over-tail').forEach(el => el.classList.remove('drag-over-row', 'drag-over-tail'))
  dragUnifiedTypeIdx.value = -1
}

function onUnifiedTypeDropTailOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  ;(e.currentTarget as HTMLElement)?.classList.add('drag-over-tail')
}

function onUnifiedTypeDropTailLeave(e: DragEvent) {
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-tail')
}

function onUnifiedTypeDropTail(e: DragEvent) {
  e.preventDefault()
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-tail')
  const fromIdx = dragUnifiedTypeIdx.value
  if (fromIdx < 0) return
  const arr = localUnifiedTypes.value
  if (fromIdx === arr.length - 1) return
  const [item] = arr.splice(fromIdx, 1)
  if (item) {
    arr.push(item)
    syncUnifiedTypes()
  }
  dragUnifiedTypeIdx.value = -1
}

// ===== Unified Types 本地数组 =====
function readUnifiedTypes(): UnifiedTypeDefinition[] {
  if (!store.commonConfig?.unified_types) return []
  // 深拷贝避免 v-model 编辑直接污染 store，确保 sync 时能检测到名称变更
  return store.commonConfig.unified_types.map(ut => ({
    name: ut.name,
    description: ut.description,
    quote_default: ut.quote_default,
    default_input: ut.default_input,
    mysql: { type: ut.mysql.type, length: ut.mysql.length, scale: ut.mysql.scale },
    postgresql: { type: ut.postgresql.type, length: ut.postgresql.length, scale: ut.postgresql.scale },
  }))
}

const localUnifiedTypes = ref<UnifiedTypeDefinition[]>(readUnifiedTypes())

watch(() => store.commonConfig, () => {
  localUnifiedTypes.value = readUnifiedTypes()
})

// 同步回 store
function syncUnifiedTypes() {
  // 检测类型名变更并同步更新所有引用
  const oldTypes = store.commonConfig?.unified_types ?? []
  const newTypes = localUnifiedTypes.value
  const compareLen = Math.min(oldTypes.length, newTypes.length)
  for (let i = 0; i < compareLen; i++) {
    const oldName = oldTypes[i]!.name
    const newName = newTypes[i]!.name
    if (oldName !== newName) {
      store.renameUnifiedType(oldName, newName)
    }
  }
  store.rebuildUnifiedTypesFromArray([...localUnifiedTypes.value])
}

const newUnifiedTypeName = ref('')

function handleAddUnifiedType() {
  const name = newUnifiedTypeName.value.trim()
  if (!name) { store.showToast(''); return }
  store.addUnifiedType(name)
  localUnifiedTypes.value = readUnifiedTypes()
  newUnifiedTypeName.value = ''
}

function handleDeleteUnifiedType(idx: number) {
  store.deleteUnifiedType(idx)
  localUnifiedTypes.value = readUnifiedTypes()
}
</script>

<template>
  <!-- ===== Common Config Panel ===== -->
  <template v-if="store.showCommonPanel && store.commonConfig">
    <!-- Unified Types -->
    <div class="section-card">
      <div class="section-header">
        <span>
          {{ $t('commonConfig.unifiedTypesTitle') }}
          <span class="badge">{{ $t('commonConfig.badge', { n: localUnifiedTypes.length }) }}</span>
        </span>
        <div class="header-actions">
          <input
            v-model="newUnifiedTypeName"
            class="form-input new-field-input"
            :placeholder="$t('commonConfig.newTypePlaceholder')"
            @keyup.enter="handleAddUnifiedType"
          />
          <button class="btn btn-sm btn-primary" @click="handleAddUnifiedType">{{ $t('commonConfig.addType') }}</button>
        </div>
      </div>
      <div class="section-body" style="padding: 0; overflow-x: auto;">
        <table class="common-fields-table">
          <thead>
            <tr>
              <th style="width:24px;"></th>
              <th>{{ $t('commonConfig.unifiedTypes.name') }}</th>
              <th>{{ $t('commonConfig.unifiedTypes.description') }}</th>
              <th>{{ $t('commonConfig.unifiedTypes.mysqlType') }}</th>
              <th>{{ $t('commonConfig.unifiedTypes.mysqlLength') }}</th>
              <th>{{ $t('commonConfig.unifiedTypes.mysqlScale') }}</th>
              <th>{{ $t('commonConfig.unifiedTypes.postgresqlType') }}</th>
              <th>{{ $t('commonConfig.unifiedTypes.postgresqlLength') }}</th>
              <th>{{ $t('commonConfig.unifiedTypes.postgresqlScale') }}</th>
              <th style="width:60px;">{{ $t('commonConfig.unifiedTypes.quoteDefault') }}</th>
              <th style="width:100px;">{{ $t('commonConfig.unifiedTypes.defaultInput') }}</th>
              <th style="width:90px;"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(ut, idx) in localUnifiedTypes"
              :key="idx"
              @dragover="onUnifiedTypeDragOver"
              @dragleave="onUnifiedTypeDragLeave"
              @drop="onUnifiedTypeDrop($event, idx)"
            >
              <!-- drag handle -->
              <td
                class="drag-handle-cell"
                draggable="true"
                @dragstart="onUnifiedTypeDragStart($event, idx)"
                @dragend="onUnifiedTypeDragEnd"
                :title="$t('commonConfig.dragToSort')"
              >
                <span class="drag-handle">⋮⋮</span>
              </td>
              <td>
                <input
                  class="table-input"
                  v-model="ut.name"
                  @change="syncUnifiedTypes()"
                  style="min-width:80px;"
                />
              </td>
              <td>
                <input
                  class="table-input"
                  v-model="ut.description"
                  @change="syncUnifiedTypes()"
                  style="min-width:100px;"
                />
              </td>
              <td>
                <input
                  class="table-input"
                  v-model="ut.mysql.type"
                  @change="syncUnifiedTypes()"
                  style="min-width:80px;"
                />
              </td>
              <td>
                <input
                  class="table-input"
                  :value="displayFieldLength(ut.mysql.length)"
                  @input="ut.mysql.length = parseFieldLengthInput(($event.target as HTMLInputElement).value); syncUnifiedTypes()"
                  style="width:60px;"
                />
              </td>
              <td>
                <input
                  class="table-input"
                  :value="displayFieldScale(ut.mysql.scale)"
                  @input="ut.mysql.scale = parseFieldScaleInput(($event.target as HTMLInputElement).value); syncUnifiedTypes()"
                  style="width:50px;"
                />
              </td>
              <td>
                <input
                  class="table-input"
                  v-model="ut.postgresql.type"
                  @change="syncUnifiedTypes()"
                  style="min-width:80px;"
                />
              </td>
              <td>
                <input
                  class="table-input"
                  :value="displayFieldLength(ut.postgresql.length)"
                  @input="ut.postgresql.length = parseFieldLengthInput(($event.target as HTMLInputElement).value); syncUnifiedTypes()"
                  style="width:60px;"
                />
              </td>
              <td>
                <input
                  class="table-input"
                  :value="displayFieldScale(ut.postgresql.scale)"
                  @input="ut.postgresql.scale = parseFieldScaleInput(($event.target as HTMLInputElement).value); syncUnifiedTypes()"
                  style="width:50px;"
                />
              </td>
              <td style="text-align:center;">
                <input type="checkbox" class="table-checkbox" v-model="ut.quote_default" @change="syncUnifiedTypes()" />
              </td>
              <td style="text-align:center;">
                <select class="table-input" :value="ut.default_input ?? ''" @change="ut.default_input = ($event.target as HTMLSelectElement).value === 'boolean' ? 'boolean' : undefined; syncUnifiedTypes()" style="min-width:100px;">
                  <option value="">{{ $t('commonConfig.unifiedTypes.defaultInputText') }}</option>
                  <option value="boolean">{{ $t('commonConfig.unifiedTypes.defaultInputBoolean') }}</option>
                </select>
              </td>
              <td style="min-width: 90px;">
                <div class="move-btns" style="display:inline-flex; margin-right:2px;">
                  <button class="move-btn" @click="moveUnifiedTypeUp(idx)" :disabled="idx === 0">↑</button>
                  <button class="move-btn" @click="moveUnifiedTypeDown(idx)" :disabled="idx === localUnifiedTypes.length - 1">↓</button>
                </div>
                <button
                  class="btn btn-sm btn-danger"
                  @click="handleDeleteUnifiedType(idx)"
                  :title="$t('commonConfig.deleteType')"
                >&times;</button>
              </td>
            </tr>
            <!-- 尾部 drop 区域 -->
            <tr
              v-if="localUnifiedTypes.length > 0"
              class="drop-tail-row"
              @dragover="onUnifiedTypeDropTailOver"
              @dragleave="onUnifiedTypeDropTailLeave"
              @drop="onUnifiedTypeDropTail"
            >
              <td :colspan="12"></td>
            </tr>
            <tr v-if="localUnifiedTypes.length === 0">
              <td colspan="12" style="text-align:center; color:#aaa; padding:16px;">
                {{ $t('commonConfig.emptyTypes') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Default MySQL Table Config -->
    <div class="section-card">
      <div class="section-header">{{ $t('commonConfig.defaultMysqlConfig') }}</div>
      <div class="section-body">
        <div class="form-row">
          <div class="form-group medium">
            <label class="form-label">{{ $t('commonConfig.engine') }}</label>
            <input
              class="form-input"
              :value="store.getCommonMysqlEngine()"
              @input="store.setCommonMysqlEngine(($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="form-group medium">
            <label class="form-label">{{ $t('commonConfig.charset') }}</label>
            <input
              class="form-input"
              :value="store.getCommonMysqlCharset()"
              @input="store.setCommonMysqlCharset(($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="form-group medium">
            <label class="form-label">{{ $t('commonConfig.collation') }}</label>
            <input
              class="form-input"
              :value="store.getCommonMysqlCollation()"
              @input="store.setCommonMysqlCollation(($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Default PostgreSQL Config -->
    <div class="section-card">
      <div class="section-header">{{ $t('commonConfig.defaultPostgresqlConfig') }}</div>
      <div class="section-body">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">{{ $t('commonConfig.quoteIdentifiers') }}</label>
            <div class="toggle-row">
              <label class="toggle-switch">
                <input
                  type="checkbox"
                  :checked="store.getCommonPostgresqlQuoteIdentifiers()"
                  @change="store.setCommonPostgresqlQuoteIdentifiers(($event.target as HTMLInputElement).checked)"
                />
                <span class="toggle-slider"></span>
              </label>
              <span class="toggle-hint">{{ $t('commonConfig.quoteIdentifiersHint') }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- DDL 生成选项 -->
    <div class="section-card">
      <div class="section-header">{{ $t('commonConfig.ddlOptionsTitle') }}</div>
      <div class="section-body">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">{{ $t('commonConfig.ddlModeLabel') }}</label>
            <div class="radio-group">
              <label class="radio-option" v-for="opt in [
                { value: 'create', label: $t('commonConfig.ddlModeCreate') },
                { value: 'drop_and_create', label: $t('commonConfig.ddlModeDropAndCreate') },
                { value: 'create_if_not_exists', label: $t('commonConfig.ddlModeCreateIfNotExists') },
              ]" :key="opt.value">
                <input
                  type="radio"
                  name="tableDdlMode"
                  :value="opt.value"
                  :checked="store.getTableDdlMode() === opt.value"
                  @change="store.setTableDdlMode(opt.value as any)"
                />
                <span class="radio-label">{{ opt.label }}</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Pre/Post SQL -->
    <PrePostSqlEditor
      :title="$t('commonConfig.prePostSql')"
      :pre-placeholder="$t('commonConfig.preSqlPlaceholder')"
      :post-placeholder="$t('commonConfig.postSqlPlaceholder')"
      :mysql-pre="getGlobalPreSql(store.commonConfig, 'mysql')"
      :mysql-post="getGlobalPostSql(store.commonConfig, 'mysql')"
      :postgresql-pre="getGlobalPreSql(store.commonConfig, 'postgresql')"
      :postgresql-post="getGlobalPostSql(store.commonConfig, 'postgresql')"
      @update:mysql-pre="store.setGlobalPreSql('mysql', $event)"
      @update:mysql-post="store.setGlobalPostSql('mysql', $event)"
      @update:postgresql-pre="store.setGlobalPreSql('postgresql', $event)"
      @update:postgresql-post="store.setGlobalPostSql('postgresql', $event)"
    />

    <!-- Field Type Case -->
    <div class="section-card">
      <div class="section-header">{{ $t('commonConfig.typeCaseTitle') }}</div>
      <div class="section-body">
        <div class="form-row">
          <div class="form-group medium">
            <label class="form-label">{{ $t('commonConfig.typeCaseLabel') }}</label>
            <select
              class="form-input"
              :value="store.getCommonTypeCase()"
              @change="store.setCommonTypeCase(($event.target as HTMLSelectElement).value as any)"
            >
              <option value="keep">{{ $t('commonConfig.typeCaseOptions.keep') }}</option>
              <option value="lowercase">{{ $t('commonConfig.typeCaseOptions.lowercase') }}</option>
              <option value="uppercase">{{ $t('commonConfig.typeCaseOptions.uppercase') }}</option>
              <option value="pascal">{{ $t('commonConfig.typeCaseOptions.pascal') }}</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <CommonUsedFieldsPanel />
  </template>
</template>

<style scoped src="@/assets/style/section.css"></style>
<style scoped src="@/assets/style/table.css"></style>
<style scoped src="@/assets/style/form.css"></style>
<style scoped src="@/assets/style/btn.css"></style>
<style scoped src="@/assets/style/move-btn.css"></style>
<style scoped>
.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.new-field-input {
  width: 150px;
  padding: 3px 6px;
  font-size: 11px;
}

.common-fields-table tbody tr:hover {
  background: #f5f5f5;
}

/* Button styles */
.btn {
  padding: 4px 10px;
  border: 1px solid #ccc;
  background: #fff;
  border-radius: 3px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}

.btn:hover {
  background: #f5f5f5;
}

.btn-primary {
  background: #4a90d9;
  color: #fff;
  border-color: #4a90d9;
}

.btn-primary:hover {
  background: #3a80c9;
}

.btn-danger {
  color: #d32f2f;
  border-color: #d32f2f;
}

.btn-danger:hover {
  background: #ffebee;
}

.btn-sm {
  padding: 2px 6px;
  font-size: 11px;
}

.table-input {
  padding: 3px 5px;
  border: 1px solid #ddd;
  border-radius: 3px;
  font-size: 12px;
  font-family: inherit;
  width: 100%;
  box-sizing: border-box;
}

.table-input:focus {
  outline: none;
  border-color: #4a90d9;
}

.move-btns {
  display: inline-flex;
  margin-right: 4px;
}

/* Toggle switch */
.toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  border-radius: 20px;
  transition: .2s;
}

.toggle-slider::before {
  content: "";
  position: absolute;
  height: 14px;
  width: 14px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  border-radius: 50%;
  transition: .2s;
}

.toggle-switch input:checked + .toggle-slider {
  background-color: #4a90d9;
}

.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(16px);
}

.toggle-hint {
  font-size: 11px;
  color: #888;
}

/* Drag-and-drop styles */
.drag-handle-cell {
  cursor: grab;
  text-align: center;
  padding: 4px 6px !important;
  user-select: none;
}

.drag-handle {
  color: #ccc;
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
  border-top: 2px solid #4a90d9 !important;
}

.drop-tail-row {
  height: 8px;
}

.drop-tail-row td {
  padding: 0 !important;
  border-bottom: none;
}

.drop-tail-row.drag-over-tail {
  border-top: 2px solid #4a90d9;
}

/* Radio group (DDL mode) */
.radio-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.radio-option {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 12px;
  color: #333;
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  transition: border-color .15s, background .15s;
}

.radio-option:hover {
  border-color: #4a90d9;
  background: #f5f9ff;
}

.radio-option input[type="radio"] {
  accent-color: #4a90d9;
  width: 16px;
  height: 16px;
  cursor: pointer;
  flex-shrink: 0;
}

.radio-label {
  font-size: 12px;
  color: #444;
  font-family: 'Consolas', 'Monaco', monospace;
}
</style>
