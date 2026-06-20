<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import { availableLocales, persistLocale } from '@/i18n/detection'
import type { SupportedLocale } from '@/i18n/detection'
import AboutModal from '@/components/AboutModal.vue'
import { GITHUB_REPO_URL } from '@/utils/constants'

const store = useEditorStore()
const { t, locale } = useI18n()

const showAboutModal = ref(false)
const openMenu = ref<string | null>(null)

function toggleMenu(menu: string) {
  openMenu.value = openMenu.value === menu ? null : menu
}

function closeMenu() {
  openMenu.value = null
}

function menuAction(fn: () => void) {
  closeMenu()
  fn()
}

function switchLocale(newLocale: SupportedLocale) {
  locale.value = newLocale
  persistLocale(newLocale)
  document.documentElement.lang = newLocale
  document.title = t('app.title')
}

// Close menu when clicking outside the menu bar
function onDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.menu-bar')) {
    closeMenu()
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && openMenu.value) {
    closeMenu()
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <!-- ===== Menu Bar ===== -->
  <div class="menu-bar">
    <img src="/logo.png" alt="Logo" class="menu-bar-logo" />
    <span class="menu-bar-title">{{ $t('app.title') }}</span>

    <!-- File Menu -->
    <div class="menu-item" :class="{ open: openMenu === 'file' }" @click.stop="toggleMenu('file')">
      {{ $t('menu.file') }}
      <div v-if="openMenu === 'file'" class="menu-dropdown" @click.stop>
        <div
          class="menu-dropdown-item"
          :class="{ disabled: store.projectOpened }"
          @click="menuAction(() => store.openProject())"
        >
          {{ $t('toolbar.openFolder') }}
        </div>
        <div
          class="menu-dropdown-item"
          :class="{ disabled: !store.projectOpened }"
          @click="store.projectOpened && menuAction(() => store.closeProject())"
        >
          {{ $t('toolbar.closeFolder') }}
        </div>
        <div class="menu-separator"></div>
        <div
          class="menu-dropdown-item"
          :class="{ disabled: !store.projectOpened }"
          @click="store.projectOpened && menuAction(() => store.openImportSqlModal())"
        >
          {{ $t('toolbar.importSql') }}
        </div>
        <div class="menu-separator"></div>
        <div
          class="menu-dropdown-item"
          :class="{ disabled: !store.projectOpened }"
          @click="store.projectOpened && menuAction(() => store.reloadFromDisk())"
        >
          {{ $t('toolbar.reloadFromDisk') }}
        </div>
      </div>
    </div>

    <!-- Help Menu -->
    <div class="menu-item" :class="{ open: openMenu === 'help' }" @click.stop="toggleMenu('help')">
      {{ $t('menu.help') }}
      <div v-if="openMenu === 'help'" class="menu-dropdown" @click.stop>
        <a
          class="menu-dropdown-item"
          :href="GITHUB_REPO_URL"
          target="_blank"
          rel="noopener noreferrer"
          @click="closeMenu()"
        >
          {{ $t('toolbar.github') }}
        </a>
        <div class="menu-separator"></div>
        <div class="menu-dropdown-item" @click="menuAction(() => { showAboutModal = true })">
          {{ $t('toolbar.about') }}
        </div>
      </div>
    </div>

    <!-- Right Side -->
    <div class="menu-bar-right">
      <span v-if="store.projectOpened" class="sync-badge" :title="$t('toolbar.autoSavingTitle')">
        &#128190;&#xFE0E; {{ $t('toolbar.autoSaving') }}
      </span>

      <select
        class="locale-select"
        :title="$t('toolbar.language')"
        :value="locale"
        @change="switchLocale(($event.target as HTMLSelectElement).value as SupportedLocale)"
      >
        <option v-for="loc in availableLocales" :key="loc" :value="loc">
          {{ loc.toUpperCase() }}
        </option>
      </select>
    </div>
  </div>

  <AboutModal :visible="showAboutModal" @close="showAboutModal = false" />
</template>

<style scoped>
.menu-bar {
  display: flex;
  align-items: center;
  padding: 0;
  background: #f3f3f3;
  border-bottom: 1px solid #d0d0d0;
  flex-shrink: 0;
  height: 30px;
  user-select: none;
}

.menu-bar-logo {
  height: 18px;
  aspect-ratio: 1;
  margin: 0 6px 0 10px;
}

.menu-bar-title {
  font-size: 12px;
  font-weight: 600;
  color: #4a90d9;
  margin-right: 16px;
  white-space: nowrap;
}

.menu-item {
  position: relative;
  padding: 4px 9px;
  margin-right: 2px;
  font-size: 12px;
  color: #333;
  cursor: pointer;
  border-radius: 4px;
  white-space: nowrap;
  transition: background .1s;
}

.menu-item:hover,
.menu-item.open {
  background: #d0d0d0;
}

.menu-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  background: #fff;
  border: 1px solid #d0d0d0;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  min-width: 200px;
  z-index: 200;
  padding: 4px 0;
}

.menu-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 24px 5px 12px;
  cursor: pointer;
  font-size: 12px;
  color: #333;
  white-space: nowrap;
  text-decoration: none;
}

.menu-dropdown-item:hover {
  background: #e8e8e8;
}

.menu-dropdown-item.disabled {
  color: #bbb;
  cursor: default;
  pointer-events: none;
}

.menu-separator {
  height: 1px;
  background: #e0e0e0;
  margin: 4px 0;
}

.menu-bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  padding-right: 8px;
}

.sync-badge {
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  opacity: 0.618;
  white-space: nowrap;
}

.locale-select {
  padding: 2px 4px;
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
