<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import { useEscClose } from '@/composables/useEscClose'
import { useEnterConfirm } from '@/composables/useEnterConfirm'

const store = useEditorStore()
const { t } = useI18n()

const messageInput = ref<HTMLInputElement | null>(null)

/** Group pending files for commit by add / update / delete */
const groups = computed(() => {
  const staged = store.commitPendingChanges
  return [
    { key: 'add', label: t('commitDialog.added'), files: staged.filter(c => c.kind === 'add').map(c => c.path) },
    { key: 'update', label: t('commitDialog.updated'), files: staged.filter(c => c.kind === 'update').map(c => c.path) },
    { key: 'delete', label: t('commitDialog.deleted'), files: staged.filter(c => c.kind === 'delete').map(c => c.path) },
  ].filter(group => group.files.length > 0)
})

useEscClose(computed(() => store.commitDialogVisible), () => store.cancelCommit())

// ENTER to commit: press Enter directly when focus is in the commit message input
useEnterConfirm(computed(() => store.commitDialogVisible), () => store.confirmCommit(), messageInput)
</script>

<template>
  <div class="modal-overlay" v-if="store.commitDialogVisible" @click.self="store.cancelCommit()">
    <div class="modal-box">
      <div class="modal-header">
        <h3>{{ $t('commitDialog.title') }}</h3>
        <button class="modal-close-btn" @click="store.cancelCommit()">&times;</button>
      </div>

      <div class="change-groups">
        <div v-for="group in groups" :key="group.key" class="change-group">
          <div class="change-group-title">
            <span class="change-kind" :class="`is-${group.key}`">{{ group.label }}</span>
            <span class="change-count">{{ group.files.length }}</span>
          </div>
          <div v-for="path in group.files" :key="path" class="change-path">{{ path }}</div>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">{{ $t('commitDialog.message') }}</label>
        <input
          ref="messageInput"
          class="form-input"
          v-model="store.commitMessage"
          :placeholder="$t('commitDialog.messagePlaceholder')"
          spellcheck="false"
        />
      </div>

      <div class="modal-actions">
        <button class="btn" @click="store.cancelCommit()">{{ $t('confirm.cancel') }}</button>
        <button class="btn btn-primary" @click="store.confirmCommit()">{{ $t('commitDialog.confirm') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-box {
  max-width: 560px;
}

.change-groups {
  max-height: 280px;
  overflow-y: auto;
  padding: 10px 12px;
  margin-bottom: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.change-group + .change-group {
  margin-top: 10px;
}

.change-group-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.change-kind {
  font-size: 11px;
  font-weight: 600;
}

.change-kind.is-add {
  color: var(--success);
}

.change-kind.is-update {
  color: var(--warning);
}

.change-kind.is-delete {
  color: var(--danger);
}

.change-count {
  font-size: 11px;
  color: var(--fg-subtle);
}

.change-path {
  padding: 1px 0 1px 10px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  line-height: 1.6;
  color: var(--fg-muted);
  word-break: break-all;
}
</style>
