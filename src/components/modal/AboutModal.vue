<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { version } from '@/../package.json'
import { BUILD_TIME, COMMIT_ID } from '@/utils/build-info'
import { GITHUB_REPO_URL } from '@/utils/constants'
import { useEscClose } from '@/composables/useEscClose'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const { locale } = useI18n()

// ESC 关闭弹窗
useEscClose(
  computed(() => props.visible),
  () => emit('close'),
)

// 构建时刻转为本地时区展示
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
</script>

<template>
  <div class="modal-overlay" v-if="visible" @click.self="emit('close')">
    <div class="modal-box about-box">
      <h3>{{ $t('about.title') }}</h3>

      <div class="about-body">
        <div class="about-logo">
          <img src="/logo.png" alt="Logo" class="about-logo-img" />
        </div>
        <div class="about-info">
          <div class="about-name">{{ $t('app.title') }}</div>
          <div class="about-version">{{ $t('about.version') }} {{ version }}</div>
          <div class="about-meta">
            <div class="about-meta-row">
              <span class="about-meta-label">{{ $t('about.buildTime') }}</span>
              <span class="about-meta-value">{{ formattedBuildTime }}</span>
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

      <div class="about-github">
        <a
          :href="GITHUB_REPO_URL"
          target="_blank"
          rel="noopener noreferrer"
          class="about-github-link"
        >
          {{ $t('about.github') }}
        </a>
      </div>

      <div class="modal-actions">
        <button class="btn btn-primary" @click="emit('close')">
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
  color: #666;
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
  color: #999;
}

.about-meta-value {
  color: #666;
}

.about-commit-link {
  color: var(--accent);
  text-decoration: none;
}

.about-commit-link:hover {
  color: var(--accent-hover);
  text-decoration: underline;
}

.about-github {
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
