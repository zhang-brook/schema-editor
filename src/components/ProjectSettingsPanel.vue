<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import type {
  Migration,
  MigrationStep,
  MigrationDdlPreview,
} from '@/core/baseline/types'
import CommonConfigPanel from '@/components/CommonConfigPanel.vue'
import EditorSidebar from '@/components/EditorSidebar.vue'
import SchemaConfigPanel from '@/components/SchemaConfigPanel.vue'
import TableEditor from '@/components/TableEditor.vue'

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
  <div class="ps-root">
    <!-- 最左侧：VSCode 风格的页面切换列 -->
    <div class="ps-rail">
      <div class="ps-rail-title">{{ $t('settings.title') }}</div>
      <button class="ps-rail-item" :class="{ active: store.settingsTab === 'global' }"
        @click="store.selectSettingsTab('global')">{{ $t('settings.tabs.global') }}</button>
      <button class="ps-rail-item" :class="{ active: store.settingsTab === 'structure' }"
        @click="store.selectSettingsTab('structure')">{{ $t('settings.tabs.structure') }}</button>
      <button class="ps-rail-item" :class="{ active: store.settingsTab === 'version' }"
        @click="store.selectSettingsTab('version')">{{ $t('settings.tabs.version') }}</button>
      <button class="ps-rail-item" :class="{ active: store.settingsTab === 'project' }"
        @click="store.selectSettingsTab('project')">{{ $t('settings.tabs.project') }}</button>
    </div>

    <!-- 右侧内容区（每个页面自己布局自己） -->
    <div class="ps-content">
      <!-- 全局配置：无 schema 侧边树 -->
      <div v-if="store.settingsTab === 'global' && store.commonConfig" class="ps-global">
        <CommonConfigPanel />
      </div>

      <!-- 库结构设计：沿用原布局 = EditorSidebar + SchemaConfigPanel/TableEditor -->
      <div v-else-if="store.settingsTab === 'structure'" class="ps-structure">
        <EditorSidebar />
        <div class="ps-structure-content">
          <SchemaConfigPanel v-if="store.currentSchema && store.selectedTableIdx === -1" />
          <TableEditor v-else-if="store.currentTable" />
          <div v-else class="ps-empty">
            <p>{{ $t('settings.structureEmpty') }}</p>
          </div>
        </div>
      </div>

      <!-- 版本管理 -->
      <div v-else-if="store.settingsTab === 'version'" class="ps-version">
        <div class="ps-version-tabs">
          <button :class="{ active: versionTab === 'baseline' }" @click="versionTab = 'baseline'">{{
            $t('baseline.title') }}</button>
          <button :class="{ active: versionTab === 'migration' }" @click="versionTab = 'migration'">{{
            $t('migration.title') }}</button>
        </div>

        <!-- 基线 -->
        <div v-if="versionTab === 'baseline'" class="ps-version-body">
          <div class="ps-create-row">
            <input v-model="newBaselineName" class="ps-input" :placeholder="$t('baseline.namePlaceholder')" />
            <button class="btn btn-primary" @click="onCreateBaseline">{{ $t('baseline.create') }}</button>
          </div>
          <div v-if="store.baselines.length === 0" class="ps-empty-sm">{{ $t('baseline.empty') }}</div>
          <ul v-else class="ps-list">
            <li v-for="b in store.baselines" :key="b.id" class="ps-list-item">
              <div class="ps-list-info">
                <span class="ps-list-name">{{ b.name }}</span>
                <span class="ps-list-meta">{{ b.created_at }}</span>
              </div>
              <button class="btn btn-danger-sm" @click="onDeleteBaseline(b.id, b.name)">{{ $t('baseline.delete')
                }}</button>
            </li>
          </ul>
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

      <!-- 项目设置（先空占位） -->
      <div v-else-if="store.settingsTab === 'project'" class="ps-empty">
        <p>{{ $t('settings.projectEmpty') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped src="@/assets/style/btn.css"></style>
<style scoped>
.ps-root {
  display: flex;
  flex: 1;
  min-width: 0;
  height: 100%;
  background: #fff;
  overflow: hidden;
}

/* 最左侧：VSCode 风格页面切换列 */
.ps-rail {
  width: 140px;
  min-width: 140px;
  background: #f3f3f3;
  border-right: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
  padding: 12px 8px;
  gap: 2px;
}

.ps-rail-title {
  font-size: 11px;
  font-weight: 600;
  color: #999;
  text-transform: uppercase;
  letter-spacing: .5px;
  padding: 4px 8px 10px;
}

.ps-rail-item {
  text-align: left;
  padding: 8px 12px;
  border: none;
  background: none;
  border-radius: 5px;
  font-size: 13px;
  color: #444;
  cursor: pointer;
  font-family: inherit;
  transition: background .1s;
}

.ps-rail-item:hover {
  background: #e6e6e6;
}

.ps-rail-item.active {
  background: #4a90d9;
  color: #fff;
  font-weight: 500;
}

/* 右侧内容：flex 纵向，子项默认 stretch 横向撑满 */
.ps-content {
  flex: 1;
  min-width: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

/* 全局配置页容器：独立内边距与滚动，不影响库结构设计页 */
.ps-global {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 20px 24px;
}

/* 库结构设计：保留 EditorSidebar + 右侧内容（原布局不变） */
.ps-structure {
  display: flex;
  flex: 1;
  width: 100%;
  min-height: 100%;
}

.ps-structure-content {
  flex: 1;
  min-width: 0;
  overflow: auto;
}

.ps-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #aaa;
  font-size: 13px;
}

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
</style>
