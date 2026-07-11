<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import type {
  Migration,
  MigrationStep,
  MigrationDdlPreview,
} from '@/core/baseline/types'
import { generateSchemaMySQL } from '@/utils/sql-generator/mysql'
import { generateSchemaPostgreSQL } from '@/utils/sql-generator/postgresql'

const store = useEditorStore()
const { t } = useI18n()

// ===== 版本管理（迁入自 BaselineMigrationModal 的逻辑，去掉 modal 外壳） =====
const versionTab = ref<'baseline' | 'migration'>('baseline')
const newBaselineName = ref('')

async function onCreateBaseline() {
  await store.createBaseline(newBaselineName.value)
  newBaselineName.value = ''
}

async function onDeleteBaseline(id: string, name: string) {
  if (!confirm(t('baseline.deleteConfirm', { name }))) return
  await store.deleteBaselineById(id)
}

const selectedMigrationId = ref<string | null>(null)
const draftFrom = ref('')
const draftTo = ref('')
const editingMigration = ref<Migration | null>(null)
const preview = ref<MigrationDdlPreview | null>(null)
const previewDialect = ref<'mysql' | 'postgresql'>('mysql')

const canCreateMigration = computed(
  () => draftFrom.value && draftTo.value && draftFrom.value !== draftTo.value,
)

async function selectMigration(m: Migration) {
  editingMigration.value = JSON.parse(JSON.stringify(m))
  selectedMigrationId.value = m.id
  draftFrom.value = m.from_baseline
  draftTo.value = m.to_baseline
  await refreshPreview()
}

function startNewMigration() {
  editingMigration.value = null
  selectedMigrationId.value = null
  draftFrom.value = store.baselines[0]?.id ?? ''
  draftTo.value = store.baselines[store.baselines.length - 1]?.id ?? ''
  preview.value = null
}

async function onCreateMigration() {
  if (!canCreateMigration.value) return
  const m = await store.createMigration(draftFrom.value, draftTo.value)
  if (m) await selectMigration(m)
}

function addStep(type: MigrationStep['type']) {
  if (!editingMigration.value) return
  const step: MigrationStep = buildEmptyStep(type)
  editingMigration.value.steps.push(step)
}

function buildEmptyStep(type: MigrationStep['type']): MigrationStep {
  switch (type) {
    case 'auto_diff':
      return { type: 'auto_diff' }
    case 'clear_column':
      return { type: 'clear_column', schema: '', table: '', column: '' }
    case 'sql_transform':
      return { type: 'sql_transform', mysql: '', postgresql: '' }
    case 'custom_sql':
      return { type: 'custom_sql', mysql: '', postgresql: '' }
  }
}

function removeStep(idx: number) {
  editingMigration.value?.steps.splice(idx, 1)
}

async function onSaveMigration() {
  if (!editingMigration.value) return
  await store.updateMigration(editingMigration.value)
  await refreshPreview()
}

async function refreshPreview() {
  if (!editingMigration.value) {
    preview.value = null
    return
  }
  preview.value = await store.previewMigrationDdl(editingMigration.value)
}

async function onDeleteMigration(id: string, name: string) {
  if (!confirm(t('migration.deleteConfirm', { name }))) return
  await store.deleteMigrationById(id)
  if (selectedMigrationId.value === id) startNewMigration()
}

function previewText(): string {
  if (!preview.value) return ''
  return previewDialect.value === 'mysql' ? preview.value.mysql : preview.value.postgresql
}

// ===== 基线预览 =====
const previewBaselineId = ref<string | null>(null)
const previewSqlDialect = ref<'mysql' | 'postgresql'>('mysql')

async function onPreviewBaseline(id: string) {
  previewBaselineId.value = id
  await store.previewBaselineById(id)
}

function onCloseBaselinePreview() {
  previewBaselineId.value = null
  store.clearBaselinePreview()
}

/** 从基线快照生成 SQL */
const baselineSqlPreview = computed(() => {
  const snap = store.selectedBaselineSnapshot
  if (!snap) return { mysql: '', postgresql: '' }
  const common = snap.common
  const schemas = snap.schemas
  if (!schemas || schemas.length === 0) return { mysql: '', postgresql: '' }

  let mysql = ''
  let postgresql = ''
  for (const schema of schemas) {
    mysql += generateSchemaMySQL(schema, common)
    mysql += '\n\n\n'
    postgresql += generateSchemaPostgreSQL(schema, common)
    postgresql += '\n\n'
  }
  return { mysql: mysql.trimEnd(), postgresql: postgresql.trimEnd() }
})

const baselineSqlText = computed(() => {
  return previewSqlDialect.value === 'mysql'
    ? baselineSqlPreview.value.mysql
    : baselineSqlPreview.value.postgresql
})

/** 统计快照中的表/字段/索引总数 */
const baselineSnapshotStats = computed(() => {
  const snap = store.selectedBaselineSnapshot
  if (!snap) return { schemas: 0, tables: 0, fields: 0, indexes: 0 }
  let tables = 0, fields = 0, indexes = 0
  for (const s of snap.schemas) {
    tables += s.tables.length
    for (const t of s.tables) {
      fields += t.fields.length
      indexes += t.indexes.length
    }
  }
  return { schemas: snap.schemas.length, tables, fields, indexes }
})

/** 当前基线摘要（用于面板头标题） */
const previewBaselineSummary = computed(() => {
  if (!previewBaselineId.value) return null
  return store.baselines.find(b => b.id === previewBaselineId.value) ?? null
})

// 进入版本管理 tab 时重置迁移草稿
watch(
  () => store.settingsTab,
  (tab) => {
    if (tab === 'version') {
      versionTab.value = 'baseline'
      startNewMigration()
    }
  },
)

onMounted(() => {
  if (store.settingsTab === 'version') startNewMigration()
})

onUnmounted(() => {
  // 卸载时无需额外处理
})
</script>

<template>
      <!-- 版本管理 -->
      <div v-if="store.settingsTab === 'version'" class="ps-version">
        <div class="ps-version-tabs">
          <button :class="{ active: versionTab === 'baseline' }" @click="versionTab = 'baseline'">{{
            $t('baseline.title') }}</button>
          <button :class="{ active: versionTab === 'migration' }" @click="versionTab = 'migration'">{{
            $t('migration.title') }}</button>
        </div>

        <!-- 基线 -->
        <div v-if="versionTab === 'baseline'" class="ps-version-body ps-baseline-root">
          <!-- 左侧：基线列表 -->
          <div class="ps-baseline-list">
            <div class="ps-create-row">
              <input v-model="newBaselineName" class="ps-input" :placeholder="$t('baseline.namePlaceholder')" />
              <button class="btn btn-primary" @click="onCreateBaseline">{{ $t('baseline.create') }}</button>
            </div>
            <div v-if="store.baselines.length === 0" class="ps-empty-sm">{{ $t('baseline.empty') }}</div>
            <ul v-else class="ps-list">
              <li v-for="b in store.baselines" :key="b.id" class="ps-list-item"
                :class="{ active: previewBaselineId === b.id }" @click="onPreviewBaseline(b.id)">
                <div class="ps-list-info">
                  <span class="ps-list-name">{{ b.name }}</span>
                  <span class="ps-list-meta">{{ b.created_at }}</span>
                </div>
                <button class="btn btn-danger-sm" @click.stop="onDeleteBaseline(b.id, b.name)">{{ $t('baseline.delete')
                  }}</button>
              </li>
            </ul>
          </div>

          <!-- 右侧：基线预览面板 -->
          <div class="ps-baseline-preview">
            <!-- 未选中基线 -->
            <div v-if="!previewBaselineId" class="ps-baseline-empty">
              {{ $t('baseline.previewEmpty') }}
            </div>

            <!-- 加载中 -->
            <div v-else-if="store.baselinePreviewLoading" class="ps-baseline-empty">
              {{ $t('app.loadingOpenProject') }}
            </div>

            <!-- 快照加载失败 -->
            <div v-else-if="previewBaselineId && !store.selectedBaselineSnapshot" class="ps-baseline-empty">
              {{ $t('baseline.previewLoadFailed') }}
            </div>

            <!-- 预览面板内容 -->
            <template v-else-if="store.selectedBaselineSnapshot">
              <div class="ps-bp-header">
                <div>
                  <span class="ps-bp-name">{{ previewBaselineSummary?.name ?? store.selectedBaselineSnapshot.name }}</span>
                  <span class="ps-bp-meta">{{ previewBaselineSummary?.created_at ?? store.selectedBaselineSnapshot.created_at }}</span>
                </div>
                <button class="btn btn-sm" @click="onCloseBaselinePreview">{{ $t('baseline.previewClose') }}</button>
              </div>

              <div class="ps-bp-stats">
                <span>{{ $t('baseline.previewSchemas', { n: baselineSnapshotStats.schemas }) }}</span>
                <span>·</span>
                <span>{{ $t('baseline.previewTables', { n: baselineSnapshotStats.tables }) }}</span>
                <span>·</span>
                <span>{{ $t('baseline.previewFields', { n: baselineSnapshotStats.fields }) }}</span>
                <span>·</span>
                <span>{{ $t('baseline.previewIndexes', { n: baselineSnapshotStats.indexes }) }}</span>
                <span>·</span>
                <span>{{ $t('baseline.previewStructVersion') }}: {{ store.selectedBaselineSnapshot.struct_version }}</span>
              </div>

              <!-- 结构树 -->
              <div class="ps-bp-tree">
                <template v-if="store.selectedBaselineSnapshot.schemas.length === 0">
                  <div class="ps-empty-sm">{{ $t('baseline.previewNoSchemas') }}</div>
                </template>
                <div v-for="(schema, si) in store.selectedBaselineSnapshot.schemas" :key="si" class="ps-bp-schema">
                  <details open>
                    <summary class="ps-bp-schema-name">{{ schema.schema }}</summary>
                    <div v-for="(table, ti) in schema.tables" :key="ti" class="ps-bp-table">
                      <details>
                        <summary class="ps-bp-table-name">{{ table.name }} <span class="ps-bp-table-comment">{{ table.comment }}</span></summary>
                        <!-- 字段 -->
                        <div class="ps-bp-fields">
                          <div class="ps-bp-field-head">
                            <span class="ps-bp-col ps-bp-col-name">{{ $t('fieldTable.fieldName') }}</span>
                            <span class="ps-bp-col ps-bp-col-type">{{ $t('fieldTable.type') }}</span>
                            <span class="ps-bp-col ps-bp-col-len">{{ $t('fieldTable.length') }}/{{ $t('fieldTable.scale') }}</span>
                            <span class="ps-bp-col ps-bp-col-nn">{{ $t('fieldTable.nn') }}</span>
                            <span class="ps-bp-col ps-bp-col-pk">{{ $t('fieldTable.pk') }}</span>
                            <span class="ps-bp-col ps-bp-col-def">{{ $t('fieldTable.default') }}</span>
                            <span class="ps-bp-col ps-bp-col-comment">{{ $t('fieldTable.comment') }}</span>
                          </div>
                          <div v-for="(field, fi) in table.fields" :key="fi" class="ps-bp-field-row">
                            <span class="ps-bp-col ps-bp-col-name">{{ field.field_name }}</span>
                            <span class="ps-bp-col ps-bp-col-type">{{ field.field_type || '-' }}</span>
                            <span class="ps-bp-col ps-bp-col-len">{{ field.field_length ?? '-' }}{{ field.field_scale != null ? ',' + field.field_scale : '' }}</span>
                            <span class="ps-bp-col ps-bp-col-nn">{{ field.not_null ? '✓' : '' }}</span>
                            <span class="ps-bp-col ps-bp-col-pk">{{ field.primary_key ? '✓' : '' }}</span>
                            <span class="ps-bp-col ps-bp-col-def">{{ field.default ?? '-' }}</span>
                            <span class="ps-bp-col ps-bp-col-comment">{{ field.comment || '-' }}</span>
                          </div>
                        </div>
                        <!-- 索引 -->
                        <div v-if="table.indexes.length > 0" class="ps-bp-indexes">
                          <div class="ps-bp-index-title">{{ $t('indexTable.indexes') }} ({{ table.indexes.length }})</div>
                          <div v-for="(idx, ii) in table.indexes" :key="ii" class="ps-bp-index-row">
                            <span class="ps-bp-index-name">{{ idx.name || '-' }}</span>
                            <span class="ps-bp-index-type">{{ idx.type }}</span>
                            <span class="ps-bp-index-cols">({{ idx.columns.map(c => c.name).join(', ') }})</span>
                          </div>
                        </div>
                      </details>
                    </div>
                  </details>
                </div>
              </div>

              <!-- SQL 预览 -->
              <div class="ps-bp-sql-section">
                <div class="ps-bp-sql-header">
                  <span>{{ $t('baseline.previewSqlTitle') }}</span>
                  <div class="ps-dialect">
                    <button :class="{ active: previewSqlDialect === 'mysql' }"
                      @click="previewSqlDialect = 'mysql'">MySQL</button>
                    <button :class="{ active: previewSqlDialect === 'postgresql' }"
                      @click="previewSqlDialect = 'postgresql'">PostgreSQL</button>
                  </div>
                </div>
                <pre class="ps-code">{{ baselineSqlText || $t('baseline.previewNoSchemas') }}</pre>
              </div>
            </template>
          </div>
        </div>

        <!-- 迁移 -->
        <div v-else class="ps-version-body ps-mig">
          <div class="ps-mig-list">
            <button class="btn btn-sm" @click="startNewMigration">+ {{ $t('migration.create') }}</button>
            <div v-if="store.migrations.length === 0" class="ps-empty-sm">{{ $t('migration.empty') }}</div>
            <ul class="ps-list">
              <li v-for="m in store.migrations" :key="m.id" class="ps-list-item"
                :class="{ active: selectedMigrationId === m.id }" @click="selectMigration(m)">
                <span class="ps-list-name">{{ m.name }}</span>
              </li>
            </ul>
          </div>

          <div class="ps-mig-editor" v-if="editingMigration">
            <div class="ps-mig-pick">
              <label>{{ $t('migration.from') }}
                <select v-model="editingMigration.from_baseline"
                  @change="draftFrom = editingMigration!.from_baseline; refreshPreview()">
                  <option v-for="b in store.baselines" :key="b.id" :value="b.id">{{ b.name }}</option>
                </select>
              </label>
              <label>{{ $t('migration.to') }}
                <select v-model="editingMigration.to_baseline"
                  @change="draftTo = editingMigration!.to_baseline; refreshPreview()">
                  <option v-for="b in store.baselines" :key="b.id" :value="b.id">{{ b.name }}</option>
                </select>
              </label>
            </div>

            <div class="ps-steps">
              <div class="ps-steps-head">
                <span>{{ $t('migration.steps') }}</span>
                <div class="ps-step-add">
                  <button class="btn btn-sm" @click="addStep('auto_diff')">{{ $t('migration.stepAutoDiff') }}</button>
                  <button class="btn btn-sm" @click="addStep('clear_column')">{{ $t('migration.stepClearColumn')
                    }}</button>
                  <button class="btn btn-sm" @click="addStep('sql_transform')">{{ $t('migration.stepSqlTransform')
                    }}</button>
                  <button class="btn btn-sm" @click="addStep('custom_sql')">{{ $t('migration.stepCustomSql') }}</button>
                </div>
              </div>

              <div v-for="(step, idx) in editingMigration.steps" :key="idx" class="ps-step">
                <div class="ps-step-head">
                  <span class="ps-step-type">{{ $t('migration.stepType') }}: {{ step.type }}</span>
                  <button class="btn btn-danger-sm" @click="removeStep(idx)">×</button>
                </div>
                <template v-if="step.type === 'clear_column'">
                  <div class="ps-step-fields">
                    <input v-model="step.schema" :placeholder="$t('migration.schema')" />
                    <input v-model="step.table" :placeholder="$t('migration.table')" />
                    <input v-model="step.column" :placeholder="$t('migration.column')" />
                  </div>
                </template>
                <template v-else-if="step.type === 'sql_transform' || step.type === 'custom_sql'">
                  <textarea v-model="step.mysql" :placeholder="$t('migration.mysqlSql')" rows="3"></textarea>
                  <textarea v-model="step.postgresql" :placeholder="$t('migration.postgresqlSql')" rows="3"></textarea>
                </template>
                <template v-else>
                  <div class="ps-step-hint">auto diff ({{ editingMigration.from_baseline }} → {{
                    editingMigration.to_baseline }})</div>
                </template>
              </div>
            </div>

            <div class="ps-preview">
              <div class="ps-preview-head">
                <span>{{ $t('migration.preview') }}</span>
                <div class="ps-dialect">
                  <button :class="{ active: previewDialect === 'mysql' }"
                    @click="previewDialect = 'mysql'">MySQL</button>
                  <button :class="{ active: previewDialect === 'postgresql' }"
                    @click="previewDialect = 'postgresql'">PostgreSQL</button>
                </div>
                <button class="btn btn-sm" @click="onSaveMigration">{{ $t('migration.save') }}</button>
              </div>
              <pre class="ps-code">{{ previewText() || $t('baseline.noChange') }}</pre>
            </div>

            <button class="btn btn-danger-sm ps-del"
              @click="onDeleteMigration(editingMigration.id, editingMigration.name)">{{
                $t('migration.delete') }}</button>
          </div>

          <div v-else class="ps-mig-editor">
            <div class="ps-mig-pick">
              <label>{{ $t('migration.from') }}
                <select v-model="draftFrom">
                  <option v-for="b in store.baselines" :key="b.id" :value="b.id">{{ b.name }}</option>
                </select>
              </label>
              <label>{{ $t('migration.to') }}
                <select v-model="draftTo">
                  <option v-for="b in store.baselines" :key="b.id" :value="b.id">{{ b.name }}</option>
                </select>
              </label>
              <button class="btn btn-sm" :disabled="!canCreateMigration" @click="onCreateMigration">{{
                $t('migration.create')
                }}</button>
            </div>
            <div class="ps-empty-sm">{{ $t('migration.empty') }}</div>
          </div>
        </div>
      </div>
</template>

<style scoped src="@/assets/style/btn.css"></style>
<style scoped>
/* 版本管理 */
.ps-version {
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  min-height: 100%;
}

.ps-version-tabs {
  display: flex;
  gap: 4px;
  padding: 12px 16px 0;
  border-bottom: 1px solid #eee;
}

.ps-version-tabs button {
  padding: 6px 14px;
  border: 1px solid #d0d0d0;
  background: #f5f5f5;
  border-radius: 5px 5px 0 0;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}

.ps-version-tabs button.active {
  background: #4a90d9;
  color: #fff;
  border-color: #4a90d9;
}

.ps-version-body {
  padding: 16px;
  overflow: auto;
}

.ps-create-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.ps-input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 13px;
  font-family: inherit;
}

.ps-empty-sm {
  color: #999;
  font-size: 13px;
  padding: 16px;
  text-align: center;
}

.ps-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.ps-list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border: 1px solid #eee;
  border-radius: 5px;
  margin-bottom: 6px;
  cursor: pointer;
}

.ps-list-item.active {
  border-color: #4a90d9;
  background: #f0f6fd;
}

.ps-list-info {
  display: flex;
  flex-direction: column;
}

.ps-list-name {
  font-size: 13px;
  font-weight: 600;
  color: #333;
}

.ps-list-meta {
  font-size: 11px;
  color: #999;
}

/* 迁移双栏 */
.ps-mig {
  display: flex;
  gap: 14px;
}

.ps-mig-list {
  width: 200px;
  flex-shrink: 0;
}

.ps-mig-editor {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ps-mig-pick {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.ps-mig-pick label {
  font-size: 12px;
  color: #555;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ps-mig-pick select {
  padding: 3px 6px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 12px;
}

.ps-steps {
  border: 1px solid #eee;
  border-radius: 6px;
  padding: 10px;
}

.ps-steps-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #444;
}

.ps-step-add {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.ps-step {
  border: 1px solid #eee;
  border-radius: 5px;
  padding: 8px;
  margin-bottom: 8px;
  background: #fafafa;
}

.ps-step-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: #555;
  margin-bottom: 6px;
}

.ps-step-fields {
  display: flex;
  gap: 6px;
}

.ps-step-fields input {
  flex: 1;
  padding: 4px 6px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 12px;
}

.ps-step textarea {
  width: 100%;
  box-sizing: border-box;
  font-family: 'Consolas', monospace;
  font-size: 12px;
  padding: 5px;
  border: 1px solid #ccc;
  border-radius: 4px;
  margin-bottom: 4px;
}

.ps-step-hint {
  font-size: 11px;
  color: #999;
}

.ps-preview {
  border: 1px solid #eee;
  border-radius: 6px;
  padding: 10px;
}

.ps-preview-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #444;
}

.ps-dialect {
  display: flex;
  gap: 4px;
}

.ps-dialect button {
  padding: 2px 8px;
  border: 1px solid #d0d0d0;
  background: #f5f5f5;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
}

.ps-dialect button.active {
  background: #4a90d9;
  color: #fff;
  border-color: #4a90d9;
}

.ps-preview-head .btn {
  margin-left: auto;
}

.ps-code {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 10px;
  border-radius: 5px;
  font-size: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow: auto;
  margin: 0;
}

.ps-del {
  align-self: flex-start;
}

/* ===== 基线预览 双栏布局 ===== */
.ps-baseline-root {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 0;
  padding: 0 !important;
  overflow: hidden;
}

.ps-baseline-list {
  width: 260px;
  min-width: 260px;
  flex-shrink: 0;
  padding: 16px;
  overflow-y: auto;
  border-right: 1px solid #e0e0e0;
  background: #fafafa;
}

.ps-baseline-list .ps-list-item {
  cursor: pointer;
}

.ps-baseline-preview {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ps-baseline-empty {
  color: #999;
  font-size: 13px;
  padding: 40px 16px;
  text-align: center;
}

/* 预览面板头 */
.ps-bp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid #eee;
}

.ps-bp-name {
  font-size: 15px;
  font-weight: 600;
  color: #333;
  display: block;
}

.ps-bp-meta {
  font-size: 11px;
  color: #999;
  margin-top: 2px;
  display: block;
}

/* 统计栏 */
.ps-bp-stats {
  font-size: 11px;
  color: #888;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

/* 结构树 */
.ps-bp-tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid #eee;
  border-radius: 5px;
  padding: 8px;
  background: #fafafa;
}

.ps-bp-schema {
  margin-bottom: 8px;
}

.ps-bp-schema-name {
  font-size: 13px;
  font-weight: 600;
  color: #4a90d9;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 3px;
}

.ps-bp-schema-name:hover {
  background: #e8f0fe;
}

.ps-bp-table {
  margin: 4px 0 4px 12px;
}

.ps-bp-table-name {
  font-size: 12px;
  font-weight: 600;
  color: #555;
  cursor: pointer;
  padding: 3px 6px;
  border-radius: 3px;
}

.ps-bp-table-name:hover {
  background: #f0f0f0;
}

.ps-bp-table-comment {
  font-weight: 400;
  color: #999;
  font-size: 11px;
  margin-left: 8px;
}

/* 字段表格 */
.ps-bp-fields {
  margin: 4px 0 4px 12px;
  font-size: 11px;
}

.ps-bp-field-head {
  display: flex;
  background: #f0f0f0;
  border-bottom: 1px solid #ddd;
  font-weight: 600;
  color: #555;
  border-radius: 3px 3px 0 0;
}

.ps-bp-field-row {
  display: flex;
  border-bottom: 1px solid #f0f0f0;
  color: #666;
}

.ps-bp-field-row:last-child {
  border-bottom: none;
}

.ps-bp-col {
  padding: 3px 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ps-bp-col-name { width: 120px; flex-shrink: 0; }
.ps-bp-col-type { width: 90px; flex-shrink: 0; }
.ps-bp-col-len  { width: 60px; flex-shrink: 0; text-align: right; }
.ps-bp-col-nn   { width: 30px; flex-shrink: 0; text-align: center; }
.ps-bp-col-pk   { width: 30px; flex-shrink: 0; text-align: center; }
.ps-bp-col-def  { width: 90px; flex-shrink: 0; }
.ps-bp-col-comment { flex: 1; min-width: 0; }

/* 索引 */
.ps-bp-indexes {
  margin: 2px 0 6px 12px;
}

.ps-bp-index-title {
  font-size: 11px;
  font-weight: 600;
  color: #777;
  padding: 2px 6px;
}

.ps-bp-index-row {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: #888;
  padding: 2px 12px;
}

.ps-bp-index-name {
  font-weight: 500;
  color: #666;
  min-width: 80px;
}

.ps-bp-index-type {
  color: #999;
  min-width: 50px;
}

.ps-bp-index-cols {
  color: #999;
}

/* SQL 预览区 */
.ps-bp-sql-section {
  border: 1px solid #eee;
  border-radius: 6px;
  padding: 10px;
}

.ps-bp-sql-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #444;
}
</style>
