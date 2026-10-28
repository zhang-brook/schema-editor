<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import { useEscClose } from '@/composables/useEscClose'
import { useEnterConfirm } from '@/composables/useEnterConfirm'
import { parseRepoUrl } from 'schema-editor-core/core/workspace/git/url'
import { GitRepoError } from 'schema-editor-core/core/workspace/git/types'
import { readStoredGitToken } from 'schema-editor-core/core/workspace/git/credentials'

const store = useEditorStore()
const { t } = useI18n()

const url = ref('')
const branch = ref('')
const subdir = ref('')
const token = ref('')
const remember = ref(false)
const errorMsg = ref('')
const busy = ref(false)
const urlInput = ref<HTMLInputElement | null>(null)

// When the entered URL can be parsed, auto-fill the saved token for that host if one exists
watch(url, value => {
  if (token.value) return
  try {
    const host = parseRepoUrl(value).host
    const stored = readStoredGitToken(host)
    if (stored) {
      token.value = stored
      remember.value = true
    }
  } catch {
    // Ignore while the URL is still incomplete
  }
})

useEscClose(computed(() => store.showOpenGitModal), () => {
  if (!busy.value) store.showOpenGitModal = false
})

const canSubmit = computed(() => !!url.value.trim() && !!token.value.trim() && !busy.value)

useEnterConfirm(computed(() => store.showOpenGitModal), () => {
  if (canSubmit.value) void submit()
}, urlInput)

async function submit() {
  errorMsg.value = ''
  busy.value = true
  try {
    const opened = await store.openGitRepository({
      url: url.value,
      branch: branch.value,
      subdir: subdir.value,
      token: token.value,
      remember: remember.value,
    })
    if (opened) store.showOpenGitModal = false
  } catch (e) {
    errorMsg.value = e instanceof GitRepoError ? t(`gitRepo.openError.${e.code}`) : t('gitRepo.openError.unknown')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" v-if="store.showOpenGitModal" @click.self="!busy && (store.showOpenGitModal = false)">
    <div class="modal-box">
      <div class="modal-header">
        <h3>{{ $t('gitRepo.title') }}</h3>
        <button class="modal-close-btn" @click="store.showOpenGitModal = false">&times;</button>
      </div>

      <div class="form-group">
        <label class="form-label">{{ $t('gitRepo.url') }}</label>
        <input
          ref="urlInput"
          class="form-input"
          v-model="url"
          :placeholder="$t('gitRepo.urlPlaceholder')"
          spellcheck="false"
        />
        <span class="field-hint">{{ $t('gitRepo.urlHint') }}</span>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">{{ $t('gitRepo.branch') }}</label>
          <input class="form-input" v-model="branch" :placeholder="$t('gitRepo.branchPlaceholder')" spellcheck="false" />
        </div>
        <div class="form-group">
          <label class="form-label">{{ $t('gitRepo.subdir') }}</label>
          <input class="form-input" v-model="subdir" :placeholder="$t('gitRepo.subdirPlaceholder')" spellcheck="false" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">{{ $t('gitRepo.token') }}</label>
        <input
          class="form-input"
          type="password"
          v-model="token"
          :placeholder="$t('gitRepo.tokenPlaceholder')"
          spellcheck="false"
          autocomplete="off"
        />
        <label class="remember-row">
          <input type="checkbox" class="mini-checkbox" v-model="remember" />
          <span>{{ $t('gitRepo.remember') }}</span>
        </label>
      </div>

      <div v-if="errorMsg" class="repo-error">{{ errorMsg }}</div>

      <div class="modal-actions">
        <button class="btn" :disabled="busy" @click="store.showOpenGitModal = false">{{ $t('confirm.cancel') }}</button>
        <button class="btn btn-primary" :disabled="!canSubmit" @click="submit">{{ $t('gitRepo.open') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-box {
  max-width: 560px;
}

.form-group {
  margin-bottom: 12px;
}

.field-hint {
  font-size: 11px;
  color: var(--fg-subtle);
}

.remember-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--fg-muted);
  cursor: pointer;
  user-select: none;
}

.remember-row input {
  margin: 0;
  cursor: pointer;
}

.repo-error {
  padding: 8px 10px;
  border: 1px solid var(--danger-border);
  border-radius: var(--radius-sm);
  background: var(--danger-subtle);
  color: var(--danger);
  font-size: 12px;
  line-height: 1.5;
}
</style>
