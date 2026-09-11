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

const selectedId = ref<string | null>(null)
const isCreating = ref(false)
const draft = ref<Environment | null>(null)

const hasVersions = computed(() => store.versions.length > 0)
const canSave = computed(
  () => !!draft.value && !!draft.value.name.trim() && !!draft.value.version_id,
)

function versionName(id: string): string {
  return store.versions.find(v => v.id === id)?.name ?? id
}

function startCreate() {
  if (!hasVersions.value) return
  isCreating.value = true
  selectedId.value = null
  draft.value = {
    id: '',
    name: '',
    version_id: store.versions[store.versions.length - 1]?.id ?? '',
    created_at: '',
    updated_at: '',
  }
}

function select(env: Environment) {
  isCreating.value = false
  selectedId.value = env.id
  draft.value = JSON.parse(JSON.stringify(env))
}

function cancel() {
  isCreating.value = false
  selectedId.value = null
  draft.value = null
}

async function onSave() {
  if (!draft.value || !canSave.value) return
  if (isCreating.value) {
    const created = await store.createEnvironment(
      draft.value.name,
      draft.value.version_id,
      draft.value.note,
    )
    if (created) select(created)
    return
  }
  await store.updateEnvironment(draft.value)
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
  cancel()
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
          :class="{ active: selectedId === env.id }" @click="select(env)">
          <div class="ps-list-info">
            <span class="ps-list-name">{{ env.name }}</span>
            <span class="ps-list-meta">{{ versionName(env.version_id) }}</span>
          </div>
        </li>
      </ul>
    </div>

    <!-- 右侧：编辑区 -->
    <div class="ps-env-editor">
      <div v-if="!draft" class="ps-version-empty">{{ t('environment.emptyGuide') }}</div>

      <template v-else>
        <div class="ps-mig-titlebar">
          <span class="ps-mig-title">
            {{ isCreating ? t('environment.newTitle') : t('environment.editTitle', { name: draft.name }) }}
          </span>
          <button class="btn btn-sm btn-ghost" @click="cancel">{{ t('migration.cancel') }}</button>
        </div>

        <div class="ps-env-form">
          <div class="ps-env-field">
            <span class="ps-pick-label">{{ t('environment.name') }}</span>
            <input v-model="draft.name" class="ps-input" :placeholder="t('environment.namePlaceholder')" />
          </div>

          <div class="ps-env-field">
            <span class="ps-pick-label">{{ t('environment.version') }}</span>
            <select v-model="draft.version_id">
              <option v-for="v in store.versions" :key="v.id" :value="v.id">{{ v.name }}</option>
            </select>
          </div>

          <div class="ps-env-field">
            <span class="ps-pick-label">{{ t('environment.note') }}</span>
            <textarea v-model="draft.note" class="ps-textarea" rows="3"
              :placeholder="t('environment.notePlaceholder')" />
          </div>

          <div class="ps-env-actions">
            <button class="btn btn-primary" :disabled="!canSave" @click="onSave">
              {{ t('environment.save') }}
            </button>
            <button v-if="!isCreating" class="btn btn-danger-sm" @click="onDelete(draft)">
              {{ t('environment.delete') }}
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

.ps-textarea {
  padding: 6px 8px;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: var(--radius-sm, 6px);
  font: inherit;
  resize: vertical;
}

.ps-env-actions {
  display: flex;
  gap: 8px;
}
</style>
