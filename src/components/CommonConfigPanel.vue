<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import type { Field, UnifiedTypeDefinition } from '@/types/schema'
import { displayFieldLength, displayFieldScale, displayDefault, parseDefaultInput, parseFieldLengthInput, parseFieldScaleInput } from '@/utils/file-helpers'
import { getGlobalPreSql, getGlobalPostSql } from '@/utils/sql-generator/shared'
import PrePostSqlEditor from './PrePostSqlEditor.vue'

const store = useEditorStore()
const { t } = useI18n()

// ===== 本地数组：从 store 有序方法派生 =====
const localFields = ref<Field[]>([...store.getOrderedCommonUsedFields()])

// 切换项目时重新读取
watch(() => store.commonConfig, () => {
  localFields.value = [...store.getOrderedCommonUsedFields()]
})

// ===== Rename =====
const editingFieldName = ref('')
const editingOldName = ref('')

function startRename(oldName: string) {
  editingOldName.value = oldName
  editingFieldName.value = oldName
}

function finishRename() {
  const oldName = editingOldName.value
  const newName = editingFieldName.value.trim()
  editingOldName.value = ''

  if (!newName) { store.showToast(t('toast.fieldNameEmpty')); return }
  if (oldName === newName) return
  if (localFields.value.some(f => f.field_name === newName)) {
    store.showToast(t('toast.commonFieldExists', { name: newName }))
    editingFieldName.value = ''
    return
  }

  const field = localFields.value.find(f => f.field_name === oldName)
  if (!field) return
  field.field_name = newName
  store.updateCommonUsedFieldName(oldName, newName)
  store.rebuildCommonUsedFieldsFromArray(localFields.value)
  store.showToast(t('toast.commonFieldRenamed'))
  editingFieldName.value = ''
}

// ===== Add =====
const newCommonFieldName = ref('')

function handleAdd() {
  const name = newCommonFieldName.value.trim()
  if (!name) { store.showToast(t('toast.pleaseEnterFieldName')); return }
  if (localFields.value.some(f => f.field_name === name)) {
    store.showToast(t('toast.commonFieldExists', { name }))
    return
  }
  const newField: Field = {
    field_name: name,
    field_type: 'varchar',
    field_length: 255,
    not_null: false,
    primary_key: false,
    comment: ''
  }
  localFields.value.push(newField)
  store.rebuildCommonUsedFieldsFromArray(localFields.value)
  newCommonFieldName.value = ''
  store.showToast(t('toast.commonFieldAdded'))
}

// ===== Sort (move up/down) =====
function moveCommonFieldUp(idx: number) {
  if (idx <= 0) return
  const arr = localFields.value;
  [arr[idx - 1], arr[idx]] = [arr[idx]!, arr[idx - 1]!]
  store.rebuildCommonUsedFieldsFromArray(arr)
}

function moveCommonFieldDown(idx: number) {
  if (idx >= localFields.value.length - 1) return
  const arr = localFields.value;
  [arr[idx], arr[idx + 1]] = [arr[idx + 1]!, arr[idx]!]
  store.rebuildCommonUsedFieldsFromArray(arr)
}

// ===== Drag-and-drop for Common Fields =====
const dragCommonFieldIdx = ref(-1)

function onCommonFieldDragStart(e: DragEvent, idx: number) {
  dragCommonFieldIdx.value = idx
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
  const tr = (e.currentTarget as HTMLElement).closest('tr')
  tr?.classList.add('row-dragging')
}

function onCommonFieldDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  ;(e.currentTarget as HTMLElement)?.classList.add('drag-over-row')
}

function onCommonFieldDragLeave(e: DragEvent) {
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-row')
}

function onCommonFieldDrop(e: DragEvent, toIdx: number) {
  e.preventDefault()
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-row')
  const fromIdx = dragCommonFieldIdx.value
  if (fromIdx < 0 || fromIdx === toIdx) return
  const arr = localFields.value
  const [item] = arr.splice(fromIdx, 1)
  if (item) {
    const insertIdx = toIdx > fromIdx ? toIdx - 1 : toIdx
    arr.splice(insertIdx, 0, item)
    store.rebuildCommonUsedFieldsFromArray(arr)
  }
  dragCommonFieldIdx.value = -1
}

function onCommonFieldDragEnd(e: DragEvent) {
  const tr = (e.currentTarget as HTMLElement).closest('tr')
  tr?.classList.remove('row-dragging')
  document.querySelectorAll('.drag-over-row, .drag-over-tail').forEach(el => el.classList.remove('drag-over-row', 'drag-over-tail'))
  dragCommonFieldIdx.value = -1
}

function onCommonFieldDropTailOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  ;(e.currentTarget as HTMLElement)?.classList.add('drag-over-tail')
}

function onCommonFieldDropTailLeave(e: DragEvent) {
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-tail')
}

function onCommonFieldDropTail(e: DragEvent) {
  e.preventDefault()
  ;(e.currentTarget as HTMLElement)?.classList.remove('drag-over-tail')
  const fromIdx = dragCommonFieldIdx.value
  if (fromIdx < 0) return
  const arr = localFields.value
  if (fromIdx === arr.length - 1) return
  const [item] = arr.splice(fromIdx, 1)
  if (item) {
    arr.push(item)
    store.rebuildCommonUsedFieldsFromArray(arr)
  }
  dragCommonFieldIdx.value = -1
}

// ===== Delete =====
function handleDelete(name: string) {
  const refs: string[] = []
  for (const schema of store.schemas) {
    for (const table of schema.tables) {
      if (table.fields.some(f => f.use_common_used_fields && f.field_name === name)) {
        refs.push(`${schema.schema}.${table.name}`)
      }
    }
  }
  if (refs.length > 0) {
    if (!confirm(
      t('confirm.deleteCommonField', { name, refs: refs.join('\n') })
    )) return
  }
  localFields.value = localFields.value.filter(f => f.field_name !== name)
  store.rebuildCommonUsedFieldsFromArray(localFields.value)
  store.showToast(t('toast.commonFieldDeleted'))
}

/** 选择统一类型时仅清除 field_type，长度和小数位由用户决定是否覆盖 */
function handleUnifiedTypeChange(field: Field, value: string) {
  if (value) {
    field.unified_type = value
    field.field_type = ''
    // 统一类型字段的 quote_default 由类型定义决定，清除字段级设置
    field.quote_default = undefined
  } else {
    field.unified_type = undefined
  }
}

/** 获取统一类型定义中配置的 placeholder 值（优先取 MySQL 的值） */
function getUnifiedTypePlaceholder(field: Field, key: 'length' | 'scale'): string {
  if (!field.unified_type || !store.commonConfig?.unified_types) return ''
  const def = store.commonConfig.unified_types.find(ut => ut.name === field.unified_type)
  if (!def) return ''
  const val = def.mysql[key]
  return val !== undefined && val !== null ? String(val) : ''
}

/** 切换字段是否有默认值 */
function toggleHasDefault(field: Field) {
  if (field.default !== undefined) {
    field.default = undefined
    field.quote_default = undefined
  } else {
    field.default = ''
  }
}

/** 获取统一类型定义的默认值输入组件类型 */
function getDefaultInputType(field: Field): string {
  if (!field.unified_type || !store.commonConfig?.unified_types) return ''
  const def = store.commonConfig.unified_types.find(ut => ut.name === field.unified_type)
  return def?.default_input || ''
}

// ===== Common field expand =====
const expandedCommonFields = reactive(new Set<string>())

function toggleCommonFieldExpand(fieldName: string) {
  if (expandedCommonFields.has(fieldName)) {
    expandedCommonFields.delete(fieldName)
  } else {
    expandedCommonFields.add(fieldName)
  }
}

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

    <!-- Common Used Fields -->
    <div class="section-card">
      <div class="section-header">
        <span>
          {{ $t('commonConfig.commonUsedFields') }}
          <span class="badge">{{ $t('commonConfig.badge', { n: localFields.length }) }}</span>
        </span>
        <div class="header-actions">
          <input
            v-model="newCommonFieldName"
            class="form-input new-field-input"
            :placeholder="$t('commonConfig.newFieldPlaceholder')"
            @keyup.enter="handleAdd"
          />
          <button class="btn btn-sm btn-primary" @click="handleAdd">{{ $t('commonConfig.addField') }}</button>
        </div>
      </div>
      <div class="section-body" style="padding: 0; overflow-x: auto;">
        <table class="common-fields-table">
          <thead>
            <tr>
              <th style="width:24px;"></th>
              <th style="width:30px;"></th>
              <th>{{ $t('commonConfig.fields.fieldName') }}</th>
              <th>{{ $t('commonConfig.fields.fieldType') }}</th>
              <th>{{ $t('commonConfig.fields.length') }}</th>
              <th>{{ $t('commonConfig.fields.scale') }}</th>
              <th>{{ $t('commonConfig.fields.notNull') }}</th>
              <th>{{ $t('commonConfig.fields.pk') }}</th>
              <th>{{ $t('commonConfig.fields.default') }}</th>
              <th style="width:40px;">
                "?"
                <span class="quote-help-icon" :title="$t('fieldTable.quoteDefaultHint')">?</span>
              </th>
              <th>{{ $t('commonConfig.fields.comment') }}</th>
              <th style="width:90px;"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="field in localFields" :key="field.field_name">
            <tr
              @dragover="onCommonFieldDragOver"
              @dragleave="onCommonFieldDragLeave"
              @drop="onCommonFieldDrop($event, localFields.indexOf(field))"
            >
              <!-- drag handle -->
              <td
                class="drag-handle-cell"
                draggable="true"
                @dragstart="onCommonFieldDragStart($event, localFields.indexOf(field))"
                @dragend="onCommonFieldDragEnd"
                :title="$t('commonConfig.dragToSort')"
              >
                <span class="drag-handle">⋮⋮</span>
              </td>
              <!-- expand toggle -->
              <td>
                <span class="expand-toggle" @click="toggleCommonFieldExpand(field.field_name)">
                  {{ expandedCommonFields.has(field.field_name) ? '▼' : '▶' }}
                </span>
              </td>
              <!-- field_name -->
              <td>
                <input
                  v-if="editingOldName === field.field_name"
                  class="table-input"
                  v-model="editingFieldName"
                  @blur="finishRename"
                  @keyup.enter="($event.target as HTMLInputElement).blur()"
                  @keyup.escape="editingOldName = ''; editingFieldName = ''"
                  style="min-width:80px;"
                />
                <span
                  v-else
                  class="editable-field-name"
                  @click="startRename(field.field_name)"
                  :title="$t('commonConfig.clickToRename')"
                >{{ field.field_name }}</span>
              </td>
              <!-- field_type -->
              <td>
                <div class="type-cell">
                  <select
                    class="table-input unified-type-select"
                    :value="field.unified_type ?? ''"
                    @change="handleUnifiedTypeChange(field, ($event.target as HTMLSelectElement).value)"
                    style="min-width:80px;"
                  >
                    <option value="">{{ $t('fieldTable.customType') }}</option>
                    <option v-for="ut in store.unifiedTypeNames" :key="ut" :value="ut">{{ ut }}</option>
                  </select>
                  <input
                    v-if="!field.unified_type"
                    class="table-input type-free-input"
                    v-model="field.field_type"
                    :placeholder="$t('fieldTable.typePlaceholder')"
                    style="min-width:60px;"
                  />
                  <span v-if="store.hasFieldOverrides(field)" class="override-badge" :title="$t('fieldTable.hasOverrides')">⚡</span>
                </div>
              </td>
              <!-- field_length -->
              <td>
                <div class="field-num-cell">
                  <input
                    v-if="!field.field_length_disabled"
                    class="table-input"
                    :value="displayFieldLength(field.field_length)"
                    :placeholder="getUnifiedTypePlaceholder(field, 'length')"
                    @input="field.field_length = parseFieldLengthInput(($event.target as HTMLInputElement).value)"
                    style="width:38px;"
                  />
                  <span v-else class="disabled-indicator" title="已禁用长度（点击恢复）" @click="field.field_length_disabled = undefined">—</span>
                  <label class="mini-checkbox-label" title="不设置长度">
                    <input
                      type="checkbox"
                      class="mini-checkbox"
                      :checked="!!field.field_length_disabled"
                      @change="field.field_length_disabled = ($event.target as HTMLInputElement).checked || undefined"
                    />{{ $t('fieldTable.notSet') }}
                  </label>
                </div>
              </td>
              <!-- field_scale -->
              <td>
                <div class="field-num-cell">
                  <input
                    v-if="!field.field_scale_disabled"
                    class="table-input"
                    :value="displayFieldScale(field.field_scale)"
                    :placeholder="getUnifiedTypePlaceholder(field, 'scale')"
                    @input="field.field_scale = parseFieldScaleInput(($event.target as HTMLInputElement).value)"
                    style="width:38px;"
                  />
                  <span v-else class="disabled-indicator" title="已禁用小数位（点击恢复）" @click="field.field_scale_disabled = undefined">—</span>
                  <label class="mini-checkbox-label" title="不设置小数位">
                    <input
                      type="checkbox"
                      class="mini-checkbox"
                      :checked="!!field.field_scale_disabled"
                      @change="field.field_scale_disabled = ($event.target as HTMLInputElement).checked || undefined"
                    />{{ $t('fieldTable.notSet') }}
                  </label>
                </div>
              </td>
              <!-- not_null -->
              <td>
                <input type="checkbox" class="table-checkbox" v-model="field.not_null" />
              </td>
              <!-- primary_key -->
              <td>
                <input type="checkbox" class="table-checkbox" v-model="field.primary_key" />
              </td>
              <!-- default -->
              <td>
                <div class="default-cell">
                  <input
                    type="checkbox"
                    class="table-checkbox"
                    :checked="field.default !== undefined"
                    @change="toggleHasDefault(field)"
                    :title="$t('fieldTable.hasDefault')"
                  >
                  <select
                    v-if="field.default !== undefined && getDefaultInputType(field) === 'boolean'"
                    class="table-input"
                    :value="field.default === true ? 'TRUE' : field.default === false ? 'FALSE' : ''"
                    @change="field.default = ($event.target as HTMLSelectElement).value === 'TRUE' ? true : ($event.target as HTMLSelectElement).value === 'FALSE' ? false : undefined"
                    style="min-width:80px;"
                  >
                    <option value=""></option>
                    <option value="TRUE">TRUE</option>
                    <option value="FALSE">FALSE</option>
                  </select>
                  <input
                    v-else-if="field.default !== undefined"
                    class="table-input"
                    :value="displayDefault(field.default)"
                    @input="field.default = parseDefaultInput(($event.target as HTMLInputElement).value)"
                    style="min-width:60px;"
                  >
                </div>
              </td>
              <!-- "?" quote_default -->
              <td style="text-align:center;">
                <template v-if="field.default === undefined">
                </template>
                <template v-else-if="field.unified_type">
                  <span v-if="store.quoteDefaultForField(field)" style="color:#4a90d9; font-size:11px;">✓</span>
                </template>
                <input v-else type="checkbox" class="table-checkbox" v-model="field.quote_default">
              </td>
              <!-- comment -->
              <td>
                <input class="table-input" v-model="field.comment" style="min-width:80px;" />
              </td>
              <!-- delete / move -->
              <td style="min-width: 80px;">
                <div class="move-btns">
                  <button class="move-btn" @click="moveCommonFieldUp(localFields.indexOf(field))" :disabled="localFields.indexOf(field) === 0">↑</button>
                  <button class="move-btn" @click="moveCommonFieldDown(localFields.indexOf(field))" :disabled="localFields.indexOf(field) === localFields.length - 1">↓</button>
                </div>
                <button
                  class="btn btn-sm btn-danger"
                  @click="handleDelete(field.field_name)"
                  :title="$t('commonConfig.deleteField')"
                >&times;</button>
              </td>
            </tr>
            <!-- 展开行：数据库方言覆盖 -->
            <tr v-if="expandedCommonFields.has(field.field_name)">
              <td :colspan="12">
                <div class="field-expand-content">
                  <!-- 解析后类型预览 -->
                  <div class="expand-section">
                    <div class="expand-section-title">{{ $t('fieldTable.resolvedTypes') }}</div>
                    <div class="resolved-type-row">
                      <span class="db-label">MySQL:</span>
                      <code>{{ store.getResolvedFieldTypeForDb(field, 'mysql') }}</code>
                      <span class="db-label" style="margin-left:16px;">PostgreSQL:</span>
                      <code>{{ store.getResolvedFieldTypeForDb(field, 'postgresql') }}</code>
                    </div>
                  </div>
                  <div class="expand-section">
                    <div class="expand-section-title">{{ $t('commonConfig.fields.dbOverrides') }}</div>
                    <div class="db-override-grid">
                      <div class="db-override-group">
                        <div class="db-label">{{ $t('fieldTable.mysql') }}</div>
                        <input class="form-input" placeholder="field_type" :value="store.getFieldOverrideValue(field, 'mysql', 'field_type')" @input="store.setFieldOverrideValue(field, 'mysql', 'field_type', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="field_length" :value="store.getFieldOverrideValue(field, 'mysql', 'field_length')" @input="store.setFieldOverrideValue(field, 'mysql', 'field_length', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="field_scale" :value="store.getFieldOverrideValue(field, 'mysql', 'field_scale')" @input="store.setFieldOverrideValue(field, 'mysql', 'field_scale', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="default" :value="store.getFieldOverrideValue(field, 'mysql', 'default')" @input="store.setFieldOverrideValue(field, 'mysql', 'default', ($event.target as HTMLInputElement).value)">
                      </div>
                      <div class="db-override-group">
                        <div class="db-label">{{ $t('fieldTable.postgresql') }}</div>
                        <input class="form-input" placeholder="field_type" :value="store.getFieldOverrideValue(field, 'postgresql', 'field_type')" @input="store.setFieldOverrideValue(field, 'postgresql', 'field_type', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="field_length" :value="store.getFieldOverrideValue(field, 'postgresql', 'field_length')" @input="store.setFieldOverrideValue(field, 'postgresql', 'field_length', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="field_scale" :value="store.getFieldOverrideValue(field, 'postgresql', 'field_scale')" @input="store.setFieldOverrideValue(field, 'postgresql', 'field_scale', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="default" :value="store.getFieldOverrideValue(field, 'postgresql', 'default')" @input="store.setFieldOverrideValue(field, 'postgresql', 'default', ($event.target as HTMLInputElement).value)">
                      </div>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
            </template>
            <!-- 尾部 drop 区域 -->
            <tr
              v-if="localFields.length > 0"
              class="drop-tail-row"
              @dragover="onCommonFieldDropTailOver"
              @dragleave="onCommonFieldDropTailLeave"
              @drop="onCommonFieldDropTail"
            >
              <td :colspan="12"></td>
            </tr>
            <tr v-if="localFields.length === 0">
              <td colspan="12" style="text-align:center; color:#aaa; padding:16px;">
                {{ $t('commonConfig.emptyFields') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </template>
</template>

<style scoped>
@import '../assets/style/section.css';
@import '../assets/style/table.css';
@import '../assets/style/form.css';
@import '../assets/style/btn.css';
@import '../assets/style/expand.css';
@import '../assets/style/help.css';
@import '../assets/style/move-btn.css';

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

.editable-field-name {
  cursor: pointer;
  color: #4a90d9;
  font-weight: 500;
  padding: 2px 4px;
  border-radius: 2px;
  transition: background .15s;
}

.editable-field-name:hover {
  background: #e8f0fe;
  text-decoration: underline;
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

/* Type cell with unified type select + custom input */
.type-cell {
  display: flex;
  gap: 4px;
  align-items: center;
}

.unified-type-select {
  max-width: 100px;
}

.type-free-input {
  max-width: 70px;
}

.override-badge {
  font-size: 11px;
  cursor: help;
  flex-shrink: 0;
  line-height: 1;
}

.resolved-length {
  color: #666;
  font-size: 12px;
}

.field-num-cell {
  display: flex;
  align-items: center;
  gap: 2px;
}

.mini-checkbox {
  width: 12px;
  height: 12px;
  cursor: pointer;
  flex-shrink: 0;
}

.mini-checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  font-size: 9px;
  opacity: 0.6;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}

.disabled-indicator {
  color: #999;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}

.disabled-indicator:hover {
  color: #4a90d9;
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

/* Default value cell */
.default-cell {
  display: flex;
  align-items: center;
  gap: 4px;
}

.resolved-type-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.resolved-type-row code {
  background: #e8f0fe;
  color: #333;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-family: 'Consolas', 'Monaco', monospace;
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
