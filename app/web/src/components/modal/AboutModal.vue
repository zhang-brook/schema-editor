<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { APP_VERSION, BUILD_TIME, COMMIT_ID } from '@/utils/build-info'
import { GITHUB_REPO_URL, changelogUrl } from '@/utils/constants'
import { updateStatusLabel, useDesktopUpdate } from '@/composables/useDesktopUpdate'
import { useEscClose } from '@/composables/useEscClose'
import { useEnterConfirm } from '@/composables/useEnterConfirm'
import logoUrl from '@/assets/logo.svg'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const { locale, t } = useI18n()

// Online update is only available in the packaged desktop app
const { status, supported, checkUpdate, installUpdate } = useDesktopUpdate()
const isChecking = computed(() => status.value?.state === 'checking')
const isReady = computed(() => status.value?.state === 'ready')
const updateText = computed(() =>
  updateStatusLabel(status.value, (key, params) => (params ? t(key, params) : t(key))),
)

// ESC/ENTER closes the modal
const closeBtn = ref<HTMLButtonElement | null>(null)
const visibleFlag = computed(() => props.visible)

useEscClose(
  visibleFlag,
  () => emit('close'),
)
useEnterConfirm(visibleFlag, () => emit('close'), closeBtn)

// Display the build time converted to the local time zone
const formattedBuildTime = computed(() => {
  if (!BUILD_TIME) return BUILD_TIME
  const date = new Date(BUILD_TIME)
  if (Number.isNaN(date.getTime())) return BUILD_TIME
  return new Intl.DateTimeFormat(locale.value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
})

const commitUrl = computed(() =>
  COMMIT_ID && COMMIT_ID !== 'unknown' ? `${GITHUB_REPO_URL}/commit/${COMMIT_ID}` : '',
)

// Refresh "x seconds ago" every second while the modal is visible, so build freshness is easy to see
const now = ref(Date.now())
let ticker: number | undefined

watch(
  () => props.visible,
  (visible) => {
    window.clearInterval(ticker)
    if (!visible) return
    now.value = Date.now()
    ticker = window.setInterval(() => {
      now.value = Date.now()
    }, 1000)
  },
  { immediate: true },
)

onBeforeUnmount(() => window.clearInterval(ticker))

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 30],
  ['month', 12],
]

/** Time elapsed since the build, e.g. "3 minutes ago"; returns an empty string when the time is invalid */
const relativeBuildTime = computed(() => {
  const date = new Date(BUILD_TIME)
  if (!BUILD_TIME || Number.isNaN(date.getTime())) return ''

  const rtf = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' })
  let value = Math.round((date.getTime() - now.value) / 1000)
  for (const [unit, limit] of RELATIVE_UNITS) {
    if (Math.abs(value) < limit) return rtf.format(value, unit)
    value = Math.round(value / limit)
  }
  return rtf.format(value, 'year')
})

// Use full-width parentheses for Chinese and half-width for English
const bracket = computed(() => (locale.value.startsWith('zh') ? ['（', '）'] : ['(', ')']))
</script>

<template>
  <div class="modal-overlay" v-if="visible" @click.self="emit('close')">
    <div class="modal-box about-box">
      <h3>{{ $t('about.title') }}</h3>

      <div class="about-body">
        <div class="about-logo">
          <img :src="logoUrl" alt="Logo" class="about-logo-img" />
        </div>
        <div class="about-info">
          <div class="about-name">{{ $t('app.title') }}</div>
          <div class="about-version">{{ $t('about.version') }} {{ APP_VERSION }}</div>
          <div class="about-meta">
            <div class="about-meta-row">
              <span class="about-meta-label">{{ $t('about.buildTime') }}</span>
              <span class="about-meta-value">
                {{ formattedBuildTime }}
                <span v-if="relativeBuildTime" class="about-meta-relative" :class="locale.startsWith('zh') ? 'zh' : null">
                  {{ bracket[0] }}{{ relativeBuildTime }}{{ bracket[1] }}
                </span>
              </span>
            </div>
            <div class="about-meta-row">
              <span class="about-meta-label">{{ $t('about.commit') }}</span>
              <a
                v-if="commitUrl"
                :href="commitUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="about-meta-value about-commit-link"
                >{{ COMMIT_ID }}</a>
              <span v-else class="about-meta-value">{{ COMMIT_ID }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="supported" class="about-update">
        <span v-if="updateText" class="about-update-text">{{ updateText }}</span>
        <div class="about-update-actions">
          <button class="btn btn-ghost btn-sm" :disabled="isChecking" @click="checkUpdate">
            {{ $t('about.update.check') }}
          </button>
          <button v-if="isReady" class="btn btn-primary btn-sm" @click="installUpdate">
            {{ $t('about.update.install') }}
          </button>
        </div>
      </div>

      <div class="about-github">
        <a
          :href="GITHUB_REPO_URL"
          target="_blank"
          rel="noopener noreferrer"
          class="about-github-link"
        >
          {{ $t('about.github') }}
        </a>
        <a
          :href="changelogUrl(APP_VERSION)"
          target="_blank"
          rel="noopener noreferrer"
          class="about-github-link"
        >
          {{ $t('about.changelog') }}
        </a>
      </div>

      <div class="modal-actions">
        <button class="btn btn-primary" ref="closeBtn" @click="emit('close')">
          {{ $t('about.close') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped src="@/assets/style/modal.css"></style>
<style scoped src="@/assets/style/btn.css"></style>
<style scoped>
.modal-box {
  background: var(--surface);
  border-radius: var(--radius-lg);
  padding: 22px 26px;
  min-width: 360px;
  max-width: 480px;
  width: 90vw;
  box-shadow: var(--shadow-lg);
}

.modal-box h3 {
  margin-bottom: 16px;
  font-size: 15px;
  color: var(--fg);
}

.about-box {
  text-align: center;
}

.about-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 16px 0 24px;
}

.about-logo-img {
  /* width: 64px; */
  /* height: 64px; */
  width: 81px;
  height: 81px;
  object-fit: contain;
}

.about-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.about-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--fg);
}

.about-version {
  font-size: 13px;
  color: var(--fg-muted);
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}

.about-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-top: 8px;
}

.about-meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}

.about-meta-label {
  color: var(--fg-subtle);
}

.about-meta-value {
  color: var(--fg-muted);
}

.about-meta-relative {
  color: var(--fg-subtle);
  font-size: 11px;
}

.about-meta-relative.zh {
  font-size: 10px;
}

.about-commit-link {
  color: var(--accent);
  text-decoration: none;
}

.about-commit-link:hover {
  color: var(--accent-hover);
  text-decoration: underline;
}

.about-update {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding-bottom: 14px;
}

.about-update-text {
  font-size: 12px;
  color: var(--fg-muted);
}

.about-update-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
}

.about-github {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding-bottom: 12px;
}

.about-github-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--accent);
  text-decoration: none;
  transition: color 0.15s;
}

.about-github-link:hover {
  color: var(--accent-hover);
  text-decoration: underline;
}

.modal-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
}
</style>
