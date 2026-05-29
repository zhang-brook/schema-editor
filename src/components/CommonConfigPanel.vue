<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import type { Field } from '@/types/schema'
import { displayFieldLength, displayDefault, parseDefaultInput, parseFieldLengthInput } from '@/utils/file-helpers'

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
</script>

<template>
  <!-- ===== Common Config Panel ===== -->
  <template v-if="store.showCommonPanel && store.commonConfig">
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
              <th>{{ $t('commonConfig.fields.fieldName') }}</th>
              <th>{{ $t('commonConfig.fields.fieldType') }}</th>
              <th>{{ $t('commonConfig.fields.length') }}</th>
              <th>{{ $t('commonConfig.fields.notNull') }}</th>
              <th>{{ $t('commonConfig.fields.pk') }}</th>
              <th>{{ $t('commonConfig.fields.default') }}</th>
              <th>{{ $t('commonConfig.fields.comment') }}</th>
              <th>{{ $t('commonConfig.fields.mysql') }}</th>
              <th>{{ $t('commonConfig.fields.pgsql') }}</th>
              <th style="width:70px;"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="field in localFields" :key="field.field_name">
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
                <input class="table-input" v-model="field.field_type" style="min-width:60px;" />
              </td>
              <!-- field_length -->
              <td>
                <input
                  class="table-input"
                  :value="displayFieldLength(field.field_length)"
                  @input="field.field_length = parseFieldLengthInput(($event.target as HTMLInputElement).value)"
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
            <tr v-if="localFields.length === 0">
              <td colspan="10" style="text-align:center; color:#aaa; padding:16px;">
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
</style>
