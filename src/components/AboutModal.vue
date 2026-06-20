<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { version } from '../../package.json'
import { GITHUB_REPO_URL } from '@/utils/constants'

defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()
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
          <div class="about-version">
            {{ $t('about.version') }} {{ version }}
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

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-box {
  background: #fff;
  border-radius: 8px;
  padding: 20px 24px;
  min-width: 360px;
  max-width: 480px;
  width: 90vw;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
}

.modal-box h3 {
  margin-bottom: 16px;
  font-size: 15px;
  color: #333;
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
  color: #333;
}

.about-version {
  font-size: 13px;
  color: #666;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}

.about-github {
  padding-bottom: 12px;
}

.about-github-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: #4a90d9;
  text-decoration: none;
  transition: color .15s;
}

.about-github-link:hover {
  color: #3a7bc8;
  text-decoration: underline;
}

.modal-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  color: #333;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all .15s;
}

.btn:hover {
  background: #e8e8e8;
  border-color: #aaa;
}

.btn-primary {
  background: #4a90d9;
  color: #fff;
  border-color: #4a90d9;
}

.btn-primary:hover {
  background: #3a7bc8;
  border-color: #3a7bc8;
}
</style>
