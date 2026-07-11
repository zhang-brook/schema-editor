<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import type {
  Migration,
  MigrationStep,
  MigrationDdlPreview,
  StructureDiff,
} from '@/core/baseline/types'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()

const store = useEditorStore()
const { t } = useI18n()

const tab = ref<'baseline' | 'migration'>('baseline')

// ===== 创建基线 =====
const newBaselineName = ref('')
async function onCreateBaseline() {
  await store.createBaseline(newBaselineName.value)
  newBaselineName.value = ''
}

async function onDeleteBaseline(id: string, name: string) {
  if (!confirm(t('baseline.deleteConfirm', { name }))) return
  await store.deleteBaselineById(id)
}

// ===== 迁移 =====
const selectedMigrationId = ref<string | null>(null)
const draftFrom = ref('')
const draftTo = ref('')
const editingMigration = ref<Migration | null>(null)
const preview = ref<MigrationDdlPreview | null>(null)
const previewDialect = ref<'mysql' | 'postgresql'>('mysql')

const canCreateMigration = computed(
  () => draftFrom.value && draftTo.value && draftFrom.value !== draftTo.value,
)

// 选中某迁移进行编辑
async function selectMigration(m: Migration) {
  // 深拷贝编辑草稿
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

// 弹窗打开时重置/同步
watch(
  () => props.visible,
  (v) => {
    if (v) {
      tab.value = 'baseline'
      startNewMigration()
    }
  },
)
</script>

<template>
  <div class="modal-overlay" v-if="visible" @click.self="emit('close')">
    <div class="modal-box bm-box">
      <div class="bm-header">
        <h3>{{ tab === 'baseline' ? $t('baseline.title') : $t('migration.title') }}</h3>
        <div class="bm-tabs">
          <button :class="{ active: tab === 'baseline' }" @click="tab = 'baseline'">
            {{ $t('baseline.title') }}
          </button>
          <button :class="{ active: tab === 'migration' }" @click="tab = 'migration'">
            {{ $t('migration.title') }}
          </button>
        </div>
        <button class="bm-close" @click="emit('close')">×</button>
      </div>

      <!-- ===== 基线标签 ===== -->
      <div v-if="tab === 'baseline'" class="bm-body">
        <div class="bm-create-row">
          <input
            v-model="newBaselineName"
            class="bm-input"
            :placeholder="$t('baseline.namePlaceholder')"
          />
          <button class="btn btn-primary" @click="onCreateBaseline">
            {{ $t('baseline.create') }}
          </button>
        </div>

        <div v-if="store.baselines.length === 0" class="bm-empty">
          {{ $t('baseline.empty') }}
        </div>

        <ul v-else class="bm-list">
          <li v-for="b in store.baselines" :key="b.id" class="bm-list-item">
            <div class="bm-list-info">
              <span class="bm-list-name">{{ b.name }}</span>
              <span class="bm-list-meta">{{ b.created_at }}</span>
            </div>
            <button class="btn btn-danger-sm" @click="onDeleteBaseline(b.id, b.name)">
              {{ $t('baseline.delete') }}
            </button>
          </li>
        </ul>
      </div>

      <!-- ===== 迁移标签 ===== -->
      <div v-else class="bm-body bm-body-migration">
        <div class="bm-mig-list">
          <button class="btn btn-sm" @click="startNewMigration">
            + {{ $t('migration.create') }}
          </button>
          <div v-if="store.migrations.length === 0" class="bm-empty bm-empty-sm">
            {{ $t('migration.empty') }}
          </div>
          <ul class="bm-list">
            <li
              v-for="m in store.migrations"
              :key="m.id"
              class="bm-list-item"
              :class="{ active: selectedMigrationId === m.id }"
              @click="selectMigration(m)"
            >
              <span class="bm-list-name">{{ m.name }}</span>
            </li>
          </ul>
        </div>

        <div class="bm-mig-editor" v-if="editingMigration">
          <div class="bm-mig-pick">
            <label>{{ $t('migration.from') }}
              <select v-model="editingMigration.from_baseline" @change="draftFrom = editingMigration!.from_baseline; refreshPreview()">
                <option v-for="b in store.baselines" :key="b.id" :value="b.id">{{ b.name }}</option>
              </select>
            </label>
            <label>{{ $t('migration.to') }}
              <select v-model="editingMigration.to_baseline" @change="draftTo = editingMigration!.to_baseline; refreshPreview()">
                <option v-for="b in store.baselines" :key="b.id" :value="b.id">{{ b.name }}</option>
              </select>
            </label>
          </div>

          <div class="bm-steps">
            <div class="bm-steps-head">
              <span>{{ $t('migration.steps') }}</span>
              <div class="bm-step-add">
                <button class="btn btn-sm" @click="addStep('auto_diff')">{{ $t('migration.stepAutoDiff') }}</button>
                <button class="btn btn-sm" @click="addStep('clear_column')">{{ $t('migration.stepClearColumn') }}</button>
                <button class="btn btn-sm" @click="addStep('sql_transform')">{{ $t('migration.stepSqlTransform') }}</button>
                <button class="btn btn-sm" @click="addStep('custom_sql')">{{ $t('migration.stepCustomSql') }}</button>
              </div>
            </div>

            <div v-for="(step, idx) in editingMigration.steps" :key="idx" class="bm-step">
              <div class="bm-step-head">
                <span class="bm-step-type">{{ $t('migration.stepType') }}: {{ step.type }}</span>
                <button class="btn btn-danger-sm" @click="removeStep(idx)">×</button>
              </div>
              <template v-if="step.type === 'clear_column'">
                <div class="bm-step-fields">
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
                <div class="bm-step-hint">auto diff ({{ editingMigration.from_baseline }} → {{ editingMigration.to_baseline }})</div>
              </template>
            </div>
          </div>

          <div class="bm-preview">
            <div class="bm-preview-head">
              <span>{{ $t('migration.preview') }}</span>
              <div class="bm-dialect">
                <button :class="{ active: previewDialect === 'mysql' }" @click="previewDialect = 'mysql'">MySQL</button>
                <button :class="{ active: previewDialect === 'postgresql' }" @click="previewDialect = 'postgresql'">PostgreSQL</button>
              </div>
              <button class="btn btn-sm" @click="onSaveMigration">{{ $t('migration.save') }}</button>
            </div>
            <pre class="bm-code">{{ previewText() || $t('baseline.noChange') }}</pre>
          </div>

          <button class="btn btn-danger-sm bm-del" @click="onDeleteMigration(editingMigration.id, editingMigration.name)">
            {{ $t('migration.delete') }}
          </button>
        </div>

        <div v-else class="bm-mig-editor">
          <div class="bm-mig-pick">
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
            <button
              class="btn btn-sm"
              :disabled="!canCreateMigration"
              @click="onCreateMigration"
            >{{ $t('migration.create') }}</button>
          </div>
          <div class="bm-empty bm-empty-sm">
            {{ $t('migration.empty') }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="@/assets/style/modal.css"></style>
<style scoped src="@/assets/style/btn.css"></style>
<style scoped>
.bm-box {
  min-width: 720px;
  max-width: 960px;
  width: 92vw;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 8px;
  padding: 16px 20px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
}
.bm-header {
  display: flex;
  align-items: center;
  gap: 16px;
  border-bottom: 1px solid #e6e6e6;
  padding-bottom: 10px;
}
.bm-header h3 { font-size: 15px; color: #333; margin: 0; }
.bm-tabs { display: flex; gap: 4px; }
.bm-tabs button {
  padding: 4px 12px;
  border: 1px solid #d0d0d0;
  background: #f5f5f5;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}
.bm-tabs button.active { background: #4a90d9; color: #fff; border-color: #4a90d9; }
.bm-close {
  margin-left: auto;
  border: none;
  background: none;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  color: #888;
}
.bm-body { padding: 12px 0; overflow: auto; }
.bm-create-row { display: flex; gap: 8px; margin-bottom: 12px; }
.bm-input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 13px;
  font-family: inherit;
}
.bm-empty { color: #999; font-size: 13px; padding: 16px; text-align: center; }
.bm-empty-sm { padding: 8px; }
.bm-list { list-style: none; margin: 0; padding: 0; }
.bm-list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border: 1px solid #eee;
  border-radius: 5px;
  margin-bottom: 6px;
  cursor: pointer;
}
.bm-list-item.active { border-color: #4a90d9; background: #f0f6fd; }
.bm-list-info { display: flex; flex-direction: column; }
.bm-list-name { font-size: 13px; font-weight: 600; color: #333; }
.bm-list-meta { font-size: 11px; color: #999; }

/* 迁移双栏 */
.bm-body-migration { display: flex; gap: 14px; }
.bm-mig-list { width: 200px; flex-shrink: 0; }
.bm-mig-editor { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.bm-mig-pick { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.bm-mig-pick label { font-size: 12px; color: #555; display: flex; flex-direction: column; gap: 2px; }
.bm-mig-pick select { padding: 3px 6px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px; }

.bm-steps { border: 1px solid #eee; border-radius: 6px; padding: 10px; }
.bm-steps-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 13px; font-weight: 600; color: #444; }
.bm-step-add { display: flex; gap: 4px; flex-wrap: wrap; }
.bm-step { border: 1px solid #eee; border-radius: 5px; padding: 8px; margin-bottom: 8px; background: #fafafa; }
.bm-step-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: #555; margin-bottom: 6px; }
.bm-step-fields { display: flex; gap: 6px; }
.bm-step-fields input { flex: 1; padding: 4px 6px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px; }
.bm-step textarea { width: 100%; box-sizing: border-box; font-family: 'Consolas', monospace; font-size: 12px; padding: 5px; border: 1px solid #ccc; border-radius: 4px; margin-bottom: 4px; }
.bm-step-hint { font-size: 11px; color: #999; }

.bm-preview { border: 1px solid #eee; border-radius: 6px; padding: 10px; }
.bm-preview-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 13px; font-weight: 600; color: #444; }
.bm-dialect { display: flex; gap: 4px; }
.bm-dialect button { padding: 2px 8px; border: 1px solid #d0d0d0; background: #f5f5f5; border-radius: 4px; font-size: 11px; cursor: pointer; }
.bm-dialect button.active { background: #4a90d9; color: #fff; border-color: #4a90d9; }
.bm-preview-head .btn { margin-left: auto; }
.bm-code {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 10px;
  border-radius: 5px;
  font-size: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 280px;
  overflow: auto;
  margin: 0;
}
.bm-del { align-self: flex-start; }
</style>
