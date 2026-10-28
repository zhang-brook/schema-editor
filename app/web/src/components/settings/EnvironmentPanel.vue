<script setup lang="ts">
/**
 * Environment management: each environment is linked to a version in the version chain,
 * meaning "the environment is currently on this version".
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import AppSelect from '@/components/ui/AppSelect.vue'
import type { Environment } from 'schema-editor-core/core/version/types'
import { confirmDialog } from '@/composables/useConfirm'

const store = useEditorStore()
const { t } = useI18n()

/** view = view details; edit = edit / create form */
const viewId = ref<string | null>(null)
const editing = ref(false)
const isCreating = ref(false)
const draft = ref<Environment | null>(null)

const hasVersions = computed(() => store.versions.length > 0)
const versionOptions = computed(() => store.versions.map(v => ({ value: v.id, label: v.name })))
const canSave = computed(
  () => !!draft.value && !!draft.value.name.trim() && !!draft.value.version_id,
)

/** Environment currently being viewed: taken directly from the list, so saved changes are shown automatically */
const viewingEnv = computed(
  () => store.environments.find(e => e.id === viewId.value) ?? null,
)

function versionName(id: string): string {
  return store.versions.find(v => v.id === id)?.name ?? id
}

/** Click a list item: open the detail view first, not the edit form */
function select(env: Environment) {
  viewId.value = env.id
  editing.value = false
  isCreating.value = false
  draft.value = null
}

/** View → edit */
function startEdit() {
  const env = viewingEnv.value
  if (!env) return
  draft.value = JSON.parse(JSON.stringify(env))
  editing.value = true
  isCreating.value = false
}

/** Create: go straight to the form */
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

/** Cancel editing: a new environment returns to the empty state; editing an existing one returns to its detail view */
function cancelEdit() {
  if (isCreating.value) viewId.value = null
  editing.value = false
  isCreating.value = false
  draft.value = null
}

/** Save: on success leave the form and return to the environment's detail view */
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
  // On failure the store has already shown an error; return to the detail view to show the latest content
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
    <!-- Left: environment list -->
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

    <!-- Right: view / edit -->
    <div class="ps-env-editor">
      <!-- No environment selected and not editing -->
      <div v-if="!editing && !viewingEnv" class="ps-version-empty">
        {{ t('environment.emptyGuide') }}
      </div>

      <!-- Detail view -->
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

      <!-- Edit view -->
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
            <AppSelect v-model="draft.version_id" :options="versionOptions" />
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

/* The textarea appearance is handled by the global form-input; only interaction behavior is kept here */
.ps-textarea {
  resize: vertical;
}

.ps-env-field .form-input {
  width: 100%;
  box-sizing: border-box;
}

/* ===== The classes below were originally defined in VersionManagementPage's scoped styles.
   Scoped styles do not reach into child component internals, so the environment panel referenced
   them without receiving any styles; they are redeclared here with the same values so the
   environment tab's list, title bar and empty state match the rest of the project. ===== */
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
  color: var(--fg-subtle);
}

.ps-empty-sm {
  color: var(--fg-subtle);
  font-size: 13px;
  padding: 16px;
  text-align: center;
}

.ps-version-empty {
  color: var(--fg-subtle);
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
  color: var(--fg-muted);
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
