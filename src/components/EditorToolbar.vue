<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import { availableLocales, persistLocale } from '@/i18n/detection'
import type { SupportedLocale } from '@/i18n/detection'
import AboutModal from '@/components/modal/AboutModal.vue'
import { GITHUB_REPO_URL } from '@/utils/constants'

const store = useEditorStore()
const { t, locale } = useI18n()

const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '')

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

/** 判断事件目标是否处于可编辑元素（输入框/文本域/contenteditable），这类场景应使用原生撤销/重做 */
function isEditableTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  return false
}

function onKeydown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey
  if (e.key === 'Escape' && openMenu.value) {
    closeMenu()
  }

  // 打开文件夹（通用约定 Ctrl/Cmd+O），调用目录选择器
  if (mod && (e.key === 'o' || e.key === 'O')) {
    e.preventDefault()
    store.openProject()
    return
  }
  // 关闭文件夹（Ctrl/Cmd+E，避开浏览器保留的 Ctrl+W / Ctrl+Shift+W）
  if (mod && (e.key === 'e' || e.key === 'E')) {
    if (store.projectOpened) {
      e.preventDefault()
      store.closeProject()
    }
    return
  }
  // Undo/Redo 快捷键（仅在项目打开时生效）。
  // 当焦点位于输入框/文本域等可编辑元素时，交由浏览器原生撤销/重做处理，
  // 避免拦截导致导入 SQL 弹窗等场景无法正确撤消重做。
  if (store.projectOpened && !isEditableTarget(e)) {
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault()
      if (e.shiftKey) store.redo()
      else store.undo()
    } else if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault()
      store.redo()
    }
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
          <span>{{ $t('toolbar.openFolder') }}</span>
          <span class="menu-shortcut">{{ isMac ? '⌘O' : 'Ctrl+O' }}</span>
        </div>
        <div
          class="menu-dropdown-item"
          :class="{ disabled: !store.projectOpened }"
          @click="store.projectOpened && menuAction(() => store.closeProject())"
        >
          <span>{{ $t('toolbar.closeFolder') }}</span>
          <span class="menu-shortcut">{{ isMac ? '⌘E' : 'Ctrl+E' }}</span>
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

    <!-- Edit Menu -->
    <div class="menu-item" :class="{ open: openMenu === 'edit' }" @click.stop="toggleMenu('edit')">
      {{ $t('menu.edit') }}
      <div v-if="openMenu === 'edit'" class="menu-dropdown" @click.stop>
        <div
          class="menu-dropdown-item"
          :class="{ disabled: !store.canUndo }"
          @click="store.canUndo && menuAction(() => store.undo())"
        >
          <span>{{ $t('history.undo') }}</span>
          <span class="menu-shortcut">{{ isMac ? '⌘Z' : 'Ctrl+Z' }}</span>
        </div>
        <div
          class="menu-dropdown-item"
          :class="{ disabled: !store.canRedo }"
          @click="store.canRedo && menuAction(() => store.redo())"
        >
          <span>{{ $t('history.redo') }}</span>
          <span class="menu-shortcut">{{ isMac ? '⌘⇧Z' : 'Ctrl+Shift+Z / Ctrl+Y' }}</span>
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
  padding: 0 4px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  height: 40px;
  user-select: none;
  box-shadow: 0 1px 2px rgba(27, 31, 36, 0.04);
}

.menu-bar-logo {
  height: 20px;
  aspect-ratio: 1;
  margin: 0 6px 0 12px;
}

.menu-bar-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  margin-right: 16px;
  white-space: nowrap;
}

.menu-item {
  position: relative;
  padding: 5px 11px;
  margin-right: 2px;
  font-size: 13px;
  color: var(--fg);
  cursor: pointer;
  border-radius: var(--radius-sm);
  white-space: nowrap;
  transition: background .12s ease, color .12s ease;
}

.menu-item:hover,
.menu-item.open {
  background: var(--surface-3);
  color: var(--accent);
}

.menu-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  min-width: 200px;
  z-index: 200;
  padding: 6px 0;
}

.menu-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 28px 7px 14px;
  cursor: pointer;
  font-size: 13px;
  color: var(--fg);
  white-space: nowrap;
  text-decoration: none;
  transition: background .1s ease, color .1s ease;
}

.menu-dropdown-item:hover {
  background: var(--accent-subtle);
  color: var(--accent-active);
}

.menu-dropdown-item.disabled {
  color: var(--fg-subtle);
  cursor: default;
  pointer-events: none;
}

.menu-shortcut {
  margin-left: 24px;
  font-size: 11px;
  color: #999;
  font-family: -apple-system, "Segoe UI", sans-serif;
  letter-spacing: 0.3px;
}

.menu-dropdown-item.disabled .menu-shortcut {
  color: var(--border);
}

.menu-separator {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}

.menu-bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  padding-right: 8px;
}

.toolbar-btn {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--fg);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: background .12s ease, border-color .12s ease;
}

.toolbar-btn:hover:not(:disabled) {
  background: var(--surface-3);
  border-color: var(--border-strong);
}

.toolbar-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.sync-badge {
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  opacity: 0.75;
  white-space: nowrap;
  color: var(--fg-muted);
}

.locale-select {
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--fg-muted);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  appearance: auto;
  user-select: none;
  transition: border-color .12s ease, box-shadow .12s ease;
}

.locale-select:hover {
  border-color: var(--border-strong);
}

.locale-select:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}
</style>
