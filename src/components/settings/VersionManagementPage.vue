<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import type {
  Migration,
  MigrationStep,
  MigrationDdlPreview,
} from '@/core/version/types'
import { generateSchemaMySQL } from '@/utils/sql-generator/mysql'
import { generateSchemaPostgreSQL } from '@/utils/sql-generator/postgresql'
import { generateSchemaSQLite } from '@/utils/sql-generator/sqlite'
import { confirmDialog } from '@/composables/useConfirm'
import { useEnabledDialect } from '@/composables/useEnabledDialect'
import PageTabs from '@/components/ui/PageTabs.vue'
import SegmentedSwitch from '@/components/ui/SegmentedSwitch.vue'
import VersionTimeline from './VersionTimeline.vue'

const store = useEditorStore()
const { t } = useI18n()

// ===== 版本管理（迁入自 VersionMigrationModal 的逻辑，去掉 modal 外壳） =====
const versionTab = ref<'version' | 'migration'>('version')
const newVersionName = ref('')

const versionTabOptions = computed(() => [
  { value: 'version' as const, label: t('version.title') },
  { value: 'migration' as const, label: t('migration.title') },
])

async function onCreateVersion() {
  await store.createVersion(newVersionName.value)
  newVersionName.value = ''
}

async function onDeleteVersion(id: string, name: string) {
  if (!(await confirmDialog({ title: t('confirm.title'), message: t('version.deleteConfirm', { name }), confirmText: t('confirm.ok'), cancelText: t('confirm.cancel') }))) return
  await store.deleteVersionById(id)
}

const selectedMigrationId = ref<string | null>(null)
// true => 右侧处于「新建迁移草稿」模式；false => 未选中任何项
const isDrafting = ref(false)
const draftFrom = ref('')
const draftTo = ref('')
const editingMigration = ref<Migration | null>(null)
const preview = ref<MigrationDdlPreview | null>(null)
// 迁移预览：只展示已启用的方言
const { dialectOptions, activeDialect: previewDialect } = useEnabledDialect()

const canCreateMigration = computed(
  () =>
    draftFrom.value &&
    draftTo.value &&
    draftFrom.value !== draftTo.value &&
    store.versions.length >= 2,
)

/** 根据版本 id 取名称（用于列表项副标题） */
function versionName(id: string): string {
  return store.versions.find(b => b.id === id)?.name ?? id
}

async function selectMigration(m: Migration) {
  isDrafting.value = false
  editingMigration.value = JSON.parse(JSON.stringify(m))
  selectedMigrationId.value = m.id
  draftFrom.value = m.from_version
  draftTo.value = m.to_version
  await refreshPreview()
}

/** 进入「新建迁移草稿」模式：清空选中态，默认选首尾两个版本作为 from/to */
function startNewMigration() {
  isDrafting.value = true
  editingMigration.value = null
  selectedMigrationId.value = null
  draftFrom.value = store.versions[0]?.id ?? ''
  draftTo.value = store.versions[store.versions.length - 1]?.id ?? ''
  preview.value = null
}

/** 点击时间轴上的迁移缺口：切到迁移页并预填 from/to，便于直接补建 */
function onCreateMigrationForGap(from: string, to: string) {
  versionTab.value = 'migration'
  isDrafting.value = true
  editingMigration.value = null
  selectedMigrationId.value = null
  preview.value = null
  draftFrom.value = from
  draftTo.value = to
}

/** 取消草稿，回到「未选中」空白态 */
function cancelDraft() {
  isDrafting.value = false
  editingMigration.value = null
  selectedMigrationId.value = null
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
      return { type: 'sql_transform', mysql: '', postgresql: '', sqlite: '' }
    case 'custom_sql':
      return { type: 'custom_sql', mysql: '', postgresql: '', sqlite: '' }
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
  if (!(await confirmDialog({ title: t('confirm.title'), message: t('migration.deleteConfirm', { name }), confirmText: t('confirm.ok'), cancelText: t('confirm.cancel') }))) return
  await store.deleteMigrationById(id)
  if (selectedMigrationId.value === id) cancelDraft()
}

function previewText(): string {
  if (!preview.value) return ''
  return preview.value[previewDialect.value]
}

// ===== 版本预览 =====
const previewVersionId = ref<string | null>(null)
const { activeDialect: previewSqlDialect } = useEnabledDialect()

async function onPreviewVersion(id: string) {
  previewVersionId.value = id
  await store.previewVersionById(id)
}

function onCloseVersionPreview() {
  previewVersionId.value = null
  store.clearVersionPreview()
}

/** 从版本快照生成 SQL */
const versionSqlPreview = computed(() => {
  const snap = store.selectedVersionSnapshot
  if (!snap) return { mysql: '', postgresql: '', sqlite: '' }
  const common = snap.common
  const schemas = snap.schemas
  if (!schemas || schemas.length === 0) return { mysql: '', postgresql: '', sqlite: '' }

  let mysql = ''
  let postgresql = ''
  let sqlite = ''
  for (const schema of schemas) {
    mysql += generateSchemaMySQL(schema, common)
    mysql += '\n\n\n'
    postgresql += generateSchemaPostgreSQL(schema, common)
    postgresql += '\n\n'
    sqlite += generateSchemaSQLite(schema, common)
    sqlite += '\n\n'
  }
  return { mysql: mysql.trimEnd(), postgresql: postgresql.trimEnd(), sqlite: sqlite.trimEnd() }
})

const versionSqlText = computed(() => {
  return versionSqlPreview.value[previewSqlDialect.value]
})

/** 统计快照中的表/字段/索引总数 */
const versionSnapshotStats = computed(() => {
  const snap = store.selectedVersionSnapshot
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

/** 当前版本摘要（用于面板头标题） */
const previewVersionSummary = computed(() => {
  if (!previewVersionId.value) return null
  return store.versions.find(b => b.id === previewVersionId.value) ?? null
})

// 进入版本管理页时重置迁移编辑状态（保持未选中空白态，避免误以为在新建）
onMounted(() => {
  versionTab.value = 'version'
  cancelDraft()
})
</script>

<template>
  <!-- 版本管理 -->
  <div class="ps-version">
    <div class="ps-version-tabs">
      <PageTabs v-model="versionTab" :options="versionTabOptions" />
    </div>

    <!-- 版本 -->
    <div v-if="versionTab === 'version'" class="ps-version-tab">
      <VersionTimeline :active-id="previewVersionId" @select="onPreviewVersion"
        @create-migration="onCreateMigrationForGap" />

      <div class="ps-version-body ps-version-root">
      <!-- 左侧：版本列表 -->
      <div class="ps-version-list">
        <div class="ps-create-row">
          <input v-model="newVersionName" class="ps-input" :placeholder="$t('version.namePlaceholder')" />
          <button class="btn btn-primary" @click="onCreateVersion">{{ $t('version.create') }}</button>
        </div>
        <div v-if="store.versions.length === 0" class="ps-empty-sm">{{ $t('version.empty') }}</div>
        <ul v-else class="ps-list">
          <li v-for="b in store.versions" :key="b.id" class="ps-list-item"
            :class="{ active: previewVersionId === b.id }" @click="onPreviewVersion(b.id)">
            <div class="ps-list-info">
              <span class="ps-list-name">{{ b.name }}</span>
              <span class="ps-list-meta">{{ b.created_at }}</span>
            </div>
            <button class="btn btn-danger-sm" @click.stop="onDeleteVersion(b.id, b.name)">{{ $t('version.delete')
              }}</button>
          </li>
        </ul>
      </div>

      <!-- 右侧：版本预览面板 -->
      <div class="ps-version-preview">
        <!-- 未选中版本 -->
        <div v-if="!previewVersionId" class="ps-version-empty">
          {{ $t('version.previewEmpty') }}
        </div>

        <!-- 加载中 -->
        <div v-else-if="store.versionPreviewLoading" class="ps-version-empty">
          {{ $t('app.loadingOpenProject') }}
        </div>

        <!-- 快照加载失败 -->
        <div v-else-if="previewVersionId && !store.selectedVersionSnapshot" class="ps-version-empty">
          {{ $t('version.previewLoadFailed') }}
        </div>

        <!-- 预览面板内容 -->
        <template v-else-if="store.selectedVersionSnapshot">
          <div class="ps-bp-header">
            <div>
              <span class="ps-bp-name">{{ previewVersionSummary?.name ?? store.selectedVersionSnapshot.name }}</span>
              <span class="ps-bp-meta">{{ previewVersionSummary?.created_at ?? store.selectedVersionSnapshot.created_at }}</span>
            </div>
            <button class="btn btn-sm" @click="onCloseVersionPreview">{{ $t('version.previewClose') }}</button>
          </div>

          <div class="ps-bp-stats">
            <span>{{ $t('version.previewSchemas', { n: versionSnapshotStats.schemas }) }}</span>
            <span>·</span>
            <span>{{ $t('version.previewTables', { n: versionSnapshotStats.tables }) }}</span>
            <span>·</span>
            <span>{{ $t('version.previewFields', { n: versionSnapshotStats.fields }) }}</span>
            <span>·</span>
            <span>{{ $t('version.previewIndexes', { n: versionSnapshotStats.indexes }) }}</span>
            <span>·</span>
            <span>{{ $t('version.previewStructVersion') }}: {{ store.selectedVersionSnapshot.struct_version }}</span>
          </div>

          <!-- 结构树 -->
          <div class="ps-bp-tree">
            <template v-if="store.selectedVersionSnapshot.schemas.length === 0">
              <div class="ps-empty-sm">{{ $t('version.previewNoSchemas') }}</div>
            </template>
            <div v-for="(schema, si) in store.selectedVersionSnapshot.schemas" :key="si" class="ps-bp-schema">
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
              <span>{{ $t('version.previewSqlTitle') }}</span>
              <SegmentedSwitch v-model="previewSqlDialect" :options="dialectOptions" />
            </div>
            <pre class="ps-code">{{ versionSqlText || $t('version.previewNoSchemas') }}</pre>
          </div>
        </template>
      </div>
      </div>
    </div>

    <!-- 迁移 -->
    <div v-else class="ps-version-body ps-mig">
      <div class="ps-mig-list">
        <button class="btn btn-primary btn-block" @click="startNewMigration">+ {{ $t('migration.create') }}</button>
        <div v-if="store.migrations.length === 0" class="ps-empty-sm">{{ $t('migration.empty') }}</div>
        <ul class="ps-list">
          <li v-for="m in store.migrations" :key="m.id" class="ps-list-item"
            :class="{ active: selectedMigrationId === m.id }" @click="selectMigration(m)">
            <div class="ps-list-info">
              <span class="ps-list-name">{{ m.name }}</span>
              <span class="ps-list-meta">{{ $t('migration.from') }}: {{ versionName(m.from_version) }} → {{ $t('migration.to') }}: {{ versionName(m.to_version) }}</span>
            </div>
          </li>
        </ul>
      </div>

      <!-- 未选中任何项：引导说明 -->
      <div v-if="!isDrafting && !editingMigration" class="ps-mig-editor ps-mig-guide">
        <div class="ps-guide-card">
          <div class="ps-guide-icon">⇄</div>
          <h3>{{ $t('migration.guideTitle') }}</h3>
          <p>{{ $t('migration.guideDesc') }}</p>
          <ol class="ps-guide-steps">
            <li>{{ $t('migration.guideStep1') }}</li>
            <li>{{ $t('migration.guideStep2') }}</li>
            <li>{{ $t('migration.guideStep3') }}</li>
          </ol>
          <button class="btn btn-primary" @click="startNewMigration">+ {{ $t('migration.create') }}</button>
        </div>
      </div>

      <!-- 新建迁移草稿 -->
      <div v-else-if="isDrafting && !editingMigration" class="ps-mig-editor">
        <div class="ps-mig-titlebar">
          <span class="ps-mig-title">{{ $t('migration.newTitle') }}</span>
          <button class="btn btn-sm btn-ghost" @click="cancelDraft">{{ $t('migration.cancel') }}</button>
        </div>

        <div class="ps-mig-pick ps-mig-pick-form">
          <div class="ps-pick-field">
            <span class="ps-pick-label">{{ $t('migration.from') }}</span>
            <select v-model="draftFrom">
              <option v-for="b in store.versions" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
          </div>
          <span class="ps-pick-arrow">→</span>
          <div class="ps-pick-field">
            <span class="ps-pick-label">{{ $t('migration.to') }}</span>
            <select v-model="draftTo">
              <option v-for="b in store.versions" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
          </div>
          <button class="btn btn-primary ps-pick-create"
            :disabled="!canCreateMigration" @click="onCreateMigration">{{
            $t('migration.create') }}</button>
        </div>

        <div v-if="store.versions.length < 2" class="ps-mig-warn">
          {{ $t('migration.needTwoBaselines') }}
        </div>
        <div v-else-if="draftFrom === draftTo" class="ps-mig-warn">
          {{ $t('migration.sameBaseline') }}
        </div>
      </div>

      <!-- 编辑已有迁移 -->
      <div v-else-if="editingMigration" class="ps-mig-editor">
        <div class="ps-mig-titlebar">
          <span class="ps-mig-title">{{ $t('migration.editTitle', { name: editingMigration.name }) }}</span>
        </div>

        <div class="ps-mig-pick ps-mig-pick-form">
          <div class="ps-pick-field">
            <span class="ps-pick-label">{{ $t('migration.from') }}</span>
            <select v-model="editingMigration.from_version"
              @change="draftFrom = editingMigration!.from_version; refreshPreview()">
              <option v-for="b in store.versions" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
          </div>
          <span class="ps-pick-arrow">→</span>
          <div class="ps-pick-field">
            <span class="ps-pick-label">{{ $t('migration.to') }}</span>
            <select v-model="editingMigration.to_version"
              @change="draftTo = editingMigration!.to_version; refreshPreview()">
              <option v-for="b in store.versions" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
          </div>
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

          <div v-if="editingMigration.steps.length === 0" class="ps-empty-sm ps-steps-empty">
            {{ $t('migration.noSteps') }}
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
              <textarea v-model="step.sqlite" :placeholder="$t('migration.sqliteSql')" rows="3"></textarea>
            </template>
            <template v-else>
              <div class="ps-step-hint">auto diff ({{ editingMigration.from_version }} → {{
                editingMigration.to_version }})</div>
            </template>
          </div>
        </div>

        <div class="ps-preview">
          <div class="ps-preview-head">
            <span>{{ $t('migration.preview') }}</span>
            <SegmentedSwitch v-model="previewDialect" :options="dialectOptions" />
            <button class="btn btn-sm" @click="onSaveMigration">{{ $t('migration.save') }}</button>
          </div>
          <pre class="ps-code">{{ previewText() || $t('version.noChange') }}</pre>
        </div>

        <button class="btn btn-danger-sm ps-del"
          @click="onDeleteMigration(editingMigration.id, editingMigration.name)">{{
            $t('migration.delete') }}</button>
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
  padding: 12px 16px 0;
}

/* 共享 tab 自带的下边距在此处多余（内容区已有内边距） */
.ps-version-tabs .page-tabs {
  margin-bottom: 0;
}

/* 版本 tab：时间轴固定在上，下方可滚动的双栏占满剩余高度 */
.ps-version-tab {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
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
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
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
  border: 1px solid var(--border-muted);
  border-radius: 5px;
  margin-bottom: 6px;
  cursor: pointer;
}

.ps-list-item.active {
  border-color: var(--accent);
  background: var(--accent-subtle-2);
}

.ps-list-info {
  display: flex;
  flex-direction: column;
}

.ps-list-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
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
  width: 220px;
  flex-shrink: 0;
}

.ps-mig-list .btn-block {
  margin-bottom: 12px;
}

.ps-mig-editor {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 引导 / 空白态 */
.ps-mig-guide {
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.ps-guide-card {
  max-width: 360px;
  text-align: center;
  background: var(--surface-2);
  border: 1px dashed #d5d5d5;
  border-radius: var(--radius-lg);
  padding: 28px 24px;
}

.ps-guide-icon {
  font-size: 34px;
  color: var(--accent);
  margin-bottom: 8px;
}

.ps-guide-card h3 {
  margin: 0 0 8px;
  font-size: 16px;
  color: var(--fg);
}

.ps-guide-card p {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--code-thumb);
  line-height: 1.6;
}

.ps-guide-steps {
  text-align: left;
  margin: 0 0 18px;
  padding-left: 20px;
  font-size: 12px;
  color: #666;
  line-height: 1.9;
}

/* 标题栏（新建 / 编辑） */
.ps-mig-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-muted);
}

.ps-mig-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--fg);
}

/* 选版本表单（新建 / 编辑共用） */
.ps-mig-pick-form {
  background: #f7f9fc;
  border: 1px solid #e3e9f2;
  border-radius: 8px;
  padding: 12px;
  align-items: flex-end;
}

.ps-mig-pick {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.ps-pick-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ps-pick-label {
  font-size: 11px;
  color: #888;
}

.ps-pick-arrow {
  color: var(--accent);
  font-size: 16px;
  font-weight: 700;
  padding-bottom: 2px;
}

.ps-mig-pick select {
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  min-width: 130px;
}

.ps-pick-create {
  margin-left: auto;
}

/* 警告提示 */
.ps-mig-warn {
  font-size: 12px;
  color: var(--warning);
  background: var(--warning-subtle);
  border: 1px solid var(--warning-border);
  border-radius: 6px;
  padding: 8px 10px;
}

/* 步骤空态 */
.ps-steps-empty {
  padding: 14px;
}

.ps-steps {
  border: 1px solid var(--border-muted);
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
  border: 1px solid var(--border-muted);
  border-radius: 5px;
  padding: 8px;
  margin-bottom: 8px;
  background: var(--surface-2);
}

.ps-step-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--code-thumb);
  margin-bottom: 6px;
}

.ps-step-fields {
  display: flex;
  gap: 6px;
}

.ps-step-fields input {
  flex: 1;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
}

.ps-step textarea {
  width: 100%;
  box-sizing: border-box;
  font-family: 'Consolas', monospace;
  font-size: 12px;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  margin-bottom: 4px;
}

.ps-step-hint {
  font-size: 11px;
  color: #999;
}

.ps-preview {
  border: 1px solid var(--border-muted);
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

.ps-preview-head .btn {
  margin-left: auto;
}

.ps-code {
  background: var(--code-bg);
  color: var(--code-fg);
  padding: 14px 16px;
  border-radius: var(--radius);
  border: 1px solid var(--code-bg-2);
  font-size: 12.5px;
  font-family: var(--font-mono);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow: auto;
  margin: 0;
}

.ps-del {
  align-self: flex-start;
}

/* ===== 版本预览 双栏布局 ===== */
.ps-version-root {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 0;
  padding: 0 !important;
  overflow: hidden;
}

.ps-version-list {
  width: 280px;
  min-width: 260px;
  flex-shrink: 0;
  padding: 16px;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  background: var(--surface-2);
}

.ps-version-list .ps-list-item {
  cursor: pointer;
}

.ps-version-preview {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ps-version-empty {
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
  border-bottom: 1px solid var(--border-muted);
}

.ps-bp-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--fg);
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
  border: 1px solid var(--border-muted);
  border-radius: 5px;
  padding: 8px;
  background: var(--surface-2);
}

.ps-bp-schema {
  margin-bottom: 8px;
}

.ps-bp-schema-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  cursor: pointer;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
}

.ps-bp-schema-name:hover {
  background: var(--accent-subtle);
}

.ps-bp-table {
  margin: 4px 0 4px 12px;
}

.ps-bp-table-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--code-thumb);
  cursor: pointer;
  padding: 3px 6px;
  border-radius: var(--radius-sm);
}

.ps-bp-table-name:hover {
  background: var(--surface-3);
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
  background: var(--surface-3);
  border-bottom: 1px solid var(--border);
  font-weight: 600;
  color: var(--code-thumb);
  border-radius: var(--radius-sm) 3px 0 0;
}

.ps-bp-field-row {
  display: flex;
  border-bottom: 1px solid var(--surface-3);
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
  color: var(--code-thumb);
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
  border: 1px solid var(--border-muted);
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
