<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import { availableLocales, persistLocale } from '@/i18n/detection'
import type { SupportedLocale } from '@/i18n/detection'

const store = useEditorStore()
const { t, locale } = useI18n()

function switchLocale(newLocale: SupportedLocale) {
  locale.value = newLocale
  persistLocale(newLocale)
  document.documentElement.lang = newLocale
  document.title = t('app.title')
}
</script>

<template>
  <!-- ===== Top Toolbar ===== -->
  <div class="toolbar">
    <span class="title">{{ $t('app.title') }}</span>

    <!-- Primary: Open Folder -->
    <button class="btn btn-primary" @click="store.openProject()">
      <span class="btn-icon">&#128193;&#xFE0E;</span> {{ $t('toolbar.openFolder') }}
    </button>

    <span v-if="store.projectOpened" class="sync-badge" :title="$t('toolbar.autoSavingTitle')">
      &#128190;&#xFE0E; {{ $t('toolbar.autoSaving') }}
    </span>

    <div class="toolbar-right">
      <!-- Language Switch -->
      <div class="locale-switch" :title="$t('toolbar.language')">
        <select
          class="locale-select"
          :value="locale"
          @change="switchLocale(($event.target as HTMLSelectElement).value as SupportedLocale)"
        >
          <option v-for="loc in availableLocales" :key="loc" :value="loc">
            {{ loc.toUpperCase() }}
          </option>
        </select>
      </div>

      <button
        v-if="store.projectOpened"
        class="btn btn-reload"
        :title="$t('toolbar.reloadFromDiskTitle')"
        @click="store.reloadFromDisk()"
      >
        &#8635;&#xFE0E; {{ $t('toolbar.reloadFromDisk') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ===== Top Toolbar ===== */
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: #fff;
  border-bottom: 1px solid #ddd;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.toolbar .title {
  font-size: 15px;
  font-weight: 600;
  color: #4a90d9;
  margin-right: 16px;
  white-space: nowrap;
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
  /* padding: 5px 16px; */
  font-weight: 500;
}

.btn-primary:hover {
  background: #3a7bc8;
  border-color: #3a7bc8;
}

.btn-icon {
  font-size: 14px;
  line-height: 1;
}

.sync-badge {
  font-size: 11px;
  /* color: #888; */
  display: inline-flex;
  align-items: center;
  gap: 3px;
  opacity: 0.618;
}

.btn-reload {
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.locale-switch {
  display: flex;
  align-items: center;
}

.locale-select {
  padding: 3px 6px;
  border: 1px solid #ccc;
  border-radius: 3px;
  background: #fff;
  color: #555;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  appearance: auto;
}

.locale-select:hover {
  border-color: #aaa;
}

.locale-select:focus {
  outline: none;
  border-color: #4a90d9;
}
</style>
