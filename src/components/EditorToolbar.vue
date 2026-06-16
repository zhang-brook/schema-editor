<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import { availableLocales, persistLocale } from '@/i18n/detection'
import type { SupportedLocale } from '@/i18n/detection'
import AboutModal from '@/components/AboutModal.vue'

const store = useEditorStore()
const { t, locale } = useI18n()

const showAboutModal = ref(false)

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
    <img src="/logo.png" alt="Logo" class="toolbar-logo-img" />
    <span class="title">{{ $t('app.title') }}</span>

    <!-- Primary: Open / Close Folder -->
    <button v-if="!store.projectOpened" class="btn btn-primary" @click="store.openProject()">
      <span class="btn-icon">&#128193;&#xFE0E;</span> {{ $t('toolbar.openFolder') }}
    </button>
    <button v-if="store.projectOpened" class="btn btn-close-folder" @click="store.closeProject()">
      <span class="btn-icon">&#128193;&#xFE0E;</span> {{ $t('toolbar.closeFolder') }}
    </button>

    <span v-if="store.projectOpened" class="sync-badge" :title="$t('toolbar.autoSavingTitle')">
      &#128190;&#xFE0E; {{ $t('toolbar.autoSaving') }}
    </span>

    <button
      v-if="store.projectOpened"
      class="btn btn-reload"
      :title="$t('toolbar.reloadFromDiskTitle')"
      @click="store.reloadFromDisk()"
    >
      &#8635;&#xFE0E; {{ $t('toolbar.reloadFromDisk') }}
    </button>

    <button
      v-if="store.projectOpened"
      class="btn btn-import-sql"
      :title="$t('toolbar.importSqlTitle')"
      @click="store.openImportSqlModal()"
    >
      &#128196;&#xFE0E; {{ $t('toolbar.importSql') }}
    </button>

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

      <a
        href="https://github.com/coder-xiaomo/schema-editor"
        target="_blank"
        rel="noopener noreferrer"
        class="btn btn-github"
        :title="$t('toolbar.github')"
      >
        GitHub
      </a>

      <button class="btn btn-about" :title="$t('toolbar.about')" @click="showAboutModal = true">
        {{ $t('toolbar.about') }}
      </button>
    </div>
  </div>

  <AboutModal :visible="showAboutModal" @close="showAboutModal = false" />
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

.toolbar .toolbar-logo-img {
  height: 2em;
  aspect-ratio: 1;
  margin-top: 0.1em;
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

.btn-github {
  text-decoration: none;
}

.btn-reload {
}

.btn-close-folder {
  border-color: #d94a4a;
  color: #d94a4a;
}

.btn-close-folder:hover {
  background: #d94a4a;
  color: #fff;
  border-color: #d94a4a;
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
