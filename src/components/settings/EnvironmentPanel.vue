<script setup lang="ts">
/**
 * 环境管理：每个环境关联到版本链上的某个版本，表示「该环境当前处于这个版本」。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import type { Environment } from '@/core/version/types'
import { confirmDialog } from '@/composables/useConfirm'

const store = useEditorStore()
const { t } = useI18n()

/** view = 查看详情；edit = 编辑 / 新建表单 */
const viewId = ref<string | null>(null)
const editing = ref(false)
const isCreating = ref(false)
const draft = ref<Environment | null>(null)

const hasVersions = computed(() => store.versions.length > 0)
const canSave = computed(
  () => !!draft.value && !!draft.value.name.trim() && !!draft.value.version_id,
)

/** 当前查看的环境：直接取自列表，保存后自动展示最新内容 */
const viewingEnv = computed(
  () => store.environments.find(e => e.id === viewId.value) ?? null,
)

function versionName(id: string): string {
  return store.versions.find(v => v.id === id)?.name ?? id
}

/** 点击列表项：先进入查看详情，不直接进编辑 */
function select(env: Environment) {
  viewId.value = env.id
  editing.value = false
  isCreating.value = false
  draft.value = null
}

/** 查看 → 编辑 */
function startEdit() {
  const env = viewingEnv.value
  if (!env) return
  draft.value = JSON.parse(JSON.stringify(env))
  editing.value = true
  isCreating.value = false
}

/** 新建：直接进入表单 */
function startCreate() {
  if (!hasVersions.value) return
  viewId.value = null
  draft.value = {
    id: '',
    name: '',
    version_id: store.versions[store.versions.length - 1]?.id ?? '',
    created_at: '',
    updated_at: '',
  }
  editing.value = true
  isCreating.value = true
}

/** 取消编辑：新建回到空白态，编辑现有环境则回到该环境的查看页 */
function cancelEdit() {
  if (isCreating.value) viewId.value = null
  editing.value = false
  isCreating.value = false
  draft.value = null
}

/** 保存：成功后退出表单，回到该环境的查看页 */
async function onSave() {
  if (!draft.value || !canSave.value) return
  if (isCreating.value) {
    const created = await store.createEnvironment(
      draft.value.name,
      draft.value.version_id,
      draft.value.note,
    )
    if (!created) return
    viewId.value = created.id
    editing.value = false
    isCreating.value = false
    draft.value = null
    return
  }
  const saved = draft.value
  await store.updateEnvironment(saved)
  // 失败时 store 已给出错误提示，这里回到查看页展示最新内容
  viewId.value = saved.id
  editing.value = false
  draft.value = null
}

async function onDelete(env: Environment) {
  if (
    !(await confirmDialog({
      title: t('confirm.title'),
      message: t('environment.deleteConfirm', { name: env.name }),
      confirmText: t('confirm.ok'),
      cancelText: t('confirm.cancel'),
    }))
  )
    return
  await store.deleteEnvironmentById(env.id)
  viewId.value = null
  editing.value = false
  isCreating.value = false
  draft.value = null
}
</script>

<template>
  <div class="ps-version-body ps-env">
    <!-- 左侧：环境列表 -->
    <div class="ps-env-list">
      <button class="btn btn-primary btn-block" :disabled="!hasVersions" @click="startCreate">
        + {{ t('environment.create') }}
      </button>
      <div v-if="!hasVersions" class="ps-empty-sm">{{ t('environment.noVersion') }}</div>
      <div v-else-if="store.environments.length === 0" class="ps-empty-sm">
        {{ t('environment.empty') }}
      </div>
      <ul v-else class="ps-list">
        <li v-for="env in store.environments" :key="env.id" class="ps-list-item"
          :class="{ active: viewId === env.id }" @click="select(env)">
          <div class="ps-list-info">
            <span class="ps-list-name">{{ env.name }}</span>
            <span class="ps-list-meta">{{ versionName(env.version_id) }}</span>
          </div>
        </li>
      </ul>
    </div>

    <!-- 右侧：查看 / 编辑 -->
    <div class="ps-env-editor">
      <!-- 未选中环境且未编辑 -->
      <div v-if="!editing && !viewingEnv" class="ps-version-empty">
        {{ t('environment.emptyGuide') }}
      </div>

      <!-- 查看页 -->
      <template v-else-if="!editing && viewingEnv">
        <div class="ps-mig-titlebar">
          <span class="ps-mig-title">{{ viewingEnv.name }}</span>
          <div class="ps-env-view-actions">
            <button class="btn btn-sm" @click="startEdit">{{ t('environment.edit') }}</button>
            <button class="btn btn-danger-sm" @click="onDelete(viewingEnv)">
              {{ t('environment.delete') }}
            </button>
          </div>
        </div>

        <div class="ps-env-view">
          <div class="ps-env-view-row">
            <span class="ps-pick-label">{{ t('environment.version') }}</span>
            <span class="ps-env-view-value">{{ versionName(viewingEnv.version_id) }}</span>
          </div>
          <div class="ps-env-view-row">
            <span class="ps-pick-label">{{ t('environment.note') }}</span>
            <span class="ps-env-view-value">{{ viewingEnv.note || '—' }}</span>
          </div>
        </div>
      </template>

      <!-- 编辑页 -->
      <template v-else-if="editing && draft">
        <div class="ps-mig-titlebar">
          <span class="ps-mig-title">
            {{ isCreating
              ? t('environment.newTitle')
              : t('environment.editTitle', { name: viewingEnv?.name ?? draft.name }) }}
          </span>
          <button class="btn btn-sm btn-ghost" @click="cancelEdit">{{ t('migration.cancel') }}</button>
        </div>

        <div class="ps-env-form">
          <div class="ps-env-field">
            <span class="ps-pick-label">{{ t('environment.name') }}</span>
            <input v-model="draft.name" class="form-input" :placeholder="t('environment.namePlaceholder')" />
          </div>

          <div class="ps-env-field">
            <span class="ps-pick-label">{{ t('environment.version') }}</span>
            <select v-model="draft.version_id" class="form-input">
              <option v-for="v in store.versions" :key="v.id" :value="v.id">{{ v.name }}</option>
            </select>
          </div>

          <div class="ps-env-field">
            <span class="ps-pick-label">{{ t('environment.note') }}</span>
            <textarea v-model="draft.note" class="form-input ps-textarea" rows="3"
              :placeholder="t('environment.notePlaceholder')" />
          </div>

          <div class="ps-env-actions">
            <button class="btn btn-primary" :disabled="!canSave" @click="onSave">
              {{ t('environment.save') }}
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped src="@/assets/style/form.css"></style>
<style scoped src="@/assets/style/btn.css"></style>

<style scoped>
.ps-env {
  display: flex;
  flex: 1;
  gap: 16px;
  min-height: 0;
}

.ps-env-list {
  display: flex;
  flex: 0 0 260px;
  flex-direction: column;
  gap: 8px;
}

.ps-env-editor {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.ps-env-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 520px;
}

.ps-env-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* textarea 外观交由全局 form-input 统一处理，这里只保留交互行为 */
.ps-textarea {
  resize: vertical;
}

.ps-env-field .form-input {
  width: 100%;
  box-sizing: border-box;
}

/* ===== 以下类原本定义在 VersionManagementPage 的 scoped 样式中。
   scoped 样式不会穿透到子组件的内部元素，环境面板引用了它们却拿不到样式，
   故按相同取值在此重新声明，使环境 tab 的列表、标题栏、空态与项目其他页面一致。 ===== */
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

.ps-empty-sm {
  color: #999;
  font-size: 13px;
  padding: 16px;
  text-align: center;
}

.ps-version-empty {
  color: #999;
  font-size: 13px;
  padding: 40px 16px;
  text-align: center;
}

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

.ps-pick-label {
  font-size: 11px;
  color: #888;
}

.ps-env-actions {
  display: flex;
  gap: 8px;
}

.ps-env-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 520px;
  margin-top: 12px;
}

.ps-env-view-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ps-env-view-value {
  font-size: 13px;
  color: var(--fg);
  white-space: pre-wrap;
  word-break: break-word;
}

.ps-env-view-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
