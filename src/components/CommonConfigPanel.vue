<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import type { Field, UnifiedTypeDefinition } from '@/types/schema'
import { displayFieldLength, displayFieldScale, displayDefault, parseDefaultInput, parseFieldLengthInput, parseFieldScaleInput } from '@/utils/file-helpers'

const store = useEditorStore()
const { t } = useI18n()

// ===== 本地数组：从 record 派生，保持稳定顺序 =====
function readFieldsFromRecord(): Field[] {
  if (!store.commonConfig) return []
  return Object.keys(store.commonConfig.common_used_fields).map(
    k => store.commonConfig!.common_used_fields[k]!
  )
}

const localFields = ref<Field[]>(readFieldsFromRecord())

// 切换项目时重新读取
watch(() => store.commonConfig, () => {
  localFields.value = readFieldsFromRecord()
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

/** 选择统一类型时清除旧的 field_type/field_length，让 unified_type 映射生效 */
function handleUnifiedTypeChange(field: Field, value: string) {
  if (value) {
    field.unified_type = value
    field.field_type = ''
    field.field_length = null
    field.field_scale = null
  } else {
    field.unified_type = undefined
  }
}

// ===== Override helpers =====
function formatOverride(override: Record<string, any> | undefined): string {
  if (!override || Object.keys(override).length === 0) return ''
  return Object.entries(override).map(([k, v]) => `${k}=${v}`).join(', ')
}

function parseOverride(text: string): Record<string, any> | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const result: Record<string, any> = {}
  const pairs = trimmed.split(',').map(s => s.trim()).filter(s => s)
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=')
    if (eqIdx === -1) continue
    const key = pair.substring(0, eqIdx).trim()
    let val: any = pair.substring(eqIdx + 1).trim()
    if (val === 'true') val = true
    else if (val === 'false') val = false
    else if (val === 'null') val = null
    else {
      const num = Number(val)
      if (!isNaN(num) && val !== '') val = num
    }
    if (key) result[key] = val
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function setOverride(field: Field, db: 'mysql' | 'pgsql', text: string) {
  const parsed = parseOverride(text)
  if (parsed) {
    field[db] = parsed
  } else {
    delete field[db]
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
    mysql: { type: ut.mysql.type, length: ut.mysql.length, scale: ut.mysql.scale },
    pgsql: { type: ut.pgsql.type, length: ut.pgsql.length, scale: ut.pgsql.scale },
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
              <th>{{ $t('commonConfig.unifiedTypes.pgsqlType') }}</th>
              <th>{{ $t('commonConfig.unifiedTypes.pgsqlLength') }}</th>
              <th>{{ $t('commonConfig.unifiedTypes.pgsqlScale') }}</th>
              <th style="width:60px;">{{ $t('commonConfig.unifiedTypes.quoteDefault') }}</th>
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
                  v-model="ut.pgsql.type"
                  @change="syncUnifiedTypes()"
                  style="min-width:80px;"
                />
              </td>
              <td>
                <input
                  class="table-input"
                  :value="displayFieldLength(ut.pgsql.length)"
                  @input="ut.pgsql.length = parseFieldLengthInput(($event.target as HTMLInputElement).value); syncUnifiedTypes()"
                  style="width:60px;"
                />
              </td>
              <td>
                <input
                  class="table-input"
                  :value="displayFieldScale(ut.pgsql.scale)"
                  @input="ut.pgsql.scale = parseFieldScaleInput(($event.target as HTMLInputElement).value); syncUnifiedTypes()"
                  style="width:50px;"
                />
              </td>
              <td style="text-align:center;">
                <input type="checkbox" class="table-checkbox" v-model="ut.quote_default" @change="syncUnifiedTypes()" />
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
              <td :colspan="11"></td>
            </tr>
            <tr v-if="localUnifiedTypes.length === 0">
              <td colspan="11" style="text-align:center; color:#aaa; padding:16px;">
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
      <div class="section-header">{{ $t('commonConfig.defaultPgsqlConfig') }}</div>
      <div class="section-body">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">{{ $t('commonConfig.quoteIdentifiers') }}</label>
            <div class="toggle-row">
              <label class="toggle-switch">
                <input
                  type="checkbox"
                  :checked="store.getCommonPgsqlQuoteIdentifiers()"
                  @change="store.setCommonPgsqlQuoteIdentifiers(($event.target as HTMLInputElement).checked)"
                />
                <span class="toggle-slider"></span>
              </label>
              <span class="toggle-hint">{{ $t('commonConfig.quoteIdentifiersHint') }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

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
              <th>{{ $t('commonConfig.fields.fieldName') }}</th>
              <th>{{ $t('commonConfig.fields.fieldType') }}</th>
              <th>{{ $t('commonConfig.fields.length') }}</th>
              <th>{{ $t('commonConfig.fields.scale') }}</th>
              <th>{{ $t('commonConfig.fields.notNull') }}</th>
              <th>{{ $t('commonConfig.fields.pk') }}</th>
              <th>{{ $t('commonConfig.fields.default') }}</th>
              <th>{{ $t('commonConfig.fields.comment') }}</th>
              <th>{{ $t('commonConfig.fields.mysql') }}</th>
              <th>{{ $t('commonConfig.fields.pgsql') }}</th>
              <th style="width:90px;"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="field in localFields"
              :key="field.field_name"
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
                </div>
              </td>
              <!-- field_length -->
              <td>
                <span v-if="field.unified_type" class="resolved-length">{{ displayFieldLength(field.field_length) || '-' }}</span>
                <input
                  v-else
                  class="table-input"
                  :value="displayFieldLength(field.field_length)"
                  @input="field.field_length = parseFieldLengthInput(($event.target as HTMLInputElement).value)"
                  style="width:50px;"
                />
              </td>
              <!-- field_scale -->
              <td>
                <span v-if="field.unified_type" class="resolved-length">{{ displayFieldScale(field.field_scale) || '-' }}</span>
                <input
                  v-else
                  class="table-input"
                  :value="displayFieldScale(field.field_scale)"
                  @input="field.field_scale = parseFieldScaleInput(($event.target as HTMLInputElement).value)"
                  style="width:50px;"
                />
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
                <input
                  class="table-input"
                  :value="displayDefault(field.default)"
                  @input="field.default = parseDefaultInput(($event.target as HTMLInputElement).value)"
                  style="min-width:60px;"
                />
              </td>
              <!-- comment -->
              <td>
                <input class="table-input" v-model="field.comment" style="min-width:80px;" />
              </td>
              <!-- mysql override -->
              <td>
                <input
                  class="table-input"
                  :value="formatOverride(field.mysql)"
                  @input="setOverride(field, 'mysql', ($event.target as HTMLInputElement).value)"
                  :placeholder="$t('commonConfig.overridePlaceholder')"
                  style="min-width:80px;"
                />
              </td>
              <!-- pgsql override -->
              <td>
                <input
                  class="table-input"
                  :value="formatOverride(field.pgsql)"
                  @input="setOverride(field, 'pgsql', ($event.target as HTMLInputElement).value)"
                  :placeholder="$t('commonConfig.overridePlaceholder')"
                  style="min-width:80px;"
                />
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
/* ===== Section Card ===== */
.section-card {
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 6px;
  margin-bottom: 16px;
  overflow: hidden;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #fafafa;
  border-bottom: 1px solid #eee;
  font-weight: 600;
  font-size: 13px;
  color: #444;
}

.section-header .badge {
  font-weight: 400;
  font-size: 11px;
  color: #888;
  margin-left: 8px;
}

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

.section-body {
  padding: 14px;
}

/* ===== Form Row ===== */
.form-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 10px;
}

.form-row:last-child {
  margin-bottom: 0;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}

.form-group.medium {
  flex: 0 0 200px;
}

.form-label {
  font-size: 11px;
  color: #888;
  font-weight: 500;
}

.form-input {
  padding: 5px 8px;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-size: 12px;
  font-family: inherit;
  color: #333;
  transition: border-color .15s;
}

.form-input:focus {
  outline: none;
  border-color: #4a90d9;
}

/* ===== Common Fields Table ===== */
.common-fields-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.common-fields-table th {
  background: #f5f5f5;
  padding: 6px 8px;
  text-align: left;
  font-weight: 600;
  color: #666;
  border-bottom: 1px solid #ddd;
  font-size: 11px;
  white-space: nowrap;
}

.common-fields-table td {
  padding: 4px 8px;
  border-bottom: 1px solid #eee;
  vertical-align: middle;
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

.table-checkbox {
  width: 14px;
  height: 14px;
  cursor: pointer;
}

.move-btns {
  display: inline-flex;
  margin-right: 4px;
}

.move-btn {
  padding: 2px 5px;
  font-size: 10px;
  border: 1px solid #ccc;
  background: #fff;
  cursor: pointer;
  border-radius: 2px;
  margin-right: 2px;
}

.move-btn:hover:not(:disabled) {
  background: #f0f0f0;
}

.move-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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

.resolved-length {
  color: #666;
  font-size: 12px;
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
</style>
