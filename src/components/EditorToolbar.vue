<script setup lang="ts">
import { ref, computed, watchEffect, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import { availableLocales, persistLocale } from '@/i18n/detection'
import type { SupportedLocale } from '@/i18n/detection'
import AboutModal from '@/components/modal/AboutModal.vue'
import MonitorIcon from '@/components/icon/MonitorIcon.vue'
import SunIcon from '@/components/icon/SunIcon.vue'
import MoonIcon from '@/components/icon/MoonIcon.vue'
import { GITHUB_REPO_URL, GITHUB_ISSUE_URL, changelogUrl } from '@/utils/constants'
import { version } from '@/../package.json'
import { useTheme } from '@/composables/useTheme'

const store = useEditorStore()
const { t, locale } = useI18n()
const { preference: themePreference, setTheme } = useTheme()

/** 外观切换：跟随系统 / 浅色 / 深色 */
const themeOptions = [
  { value: 'system' as const, labelKey: 'toolbar.themeSystem', icon: MonitorIcon },
  { value: 'light' as const, labelKey: 'toolbar.themeLight', icon: SunIcon },
  { value: 'dark' as const, labelKey: 'toolbar.themeDark', icon: MoonIcon },
]

const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '')

const showAboutModal = ref(false)
const openMenu = ref<string | null>(null)

/** 顶部菜单栏居中标题：显示项目名称，未设置时留空 */
const displayTitle = computed(() => store.projectName.trim())

/** 网页标题：项目名称 - 应用名；未设置项目名时仅应用名。有未保存改动时加圆点标记 */
watchEffect(() => {
  const base = displayTitle.value
    ? `${displayTitle.value} - ${t('app.title')}`
    : t('app.title')
  document.title = store.hasUnsavedChanges ? `● ${base}` : base
})

/** 右上角保存状态：保存中 / 保存失败 / 未保存 N 处 / 已保存 */
const saveBadge = computed(() => {
  const state = store.saveState
  if (state.saving) return t('toolbar.saving')
  if (state.error) return t('toolbar.saveFailed')
  if (state.dirty) return t('toolbar.unsaved', { n: state.pendingFiles })
  return t('toolbar.saved')
})

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

  // 从磁盘重新加载（Alt/Option+R，仅项目打开时生效）
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyR') {
    if (store.projectOpened) {
      e.preventDefault()
      store.reloadFromDisk()
    }
    return
  }
  // 打开文件夹（通用约定 Ctrl/Cmd+O），调用目录选择器
  if (mod && (e.key === 'o' || e.key === 'O')) {
    e.preventDefault()
    store.openProject()
    return
  }
  // 通过 SQL 导入（Ctrl/Cmd+I，仅项目打开时生效）
  if (mod && !e.altKey && e.code === 'KeyI') {
    if (store.projectOpened) {
      e.preventDefault()
      store.openImportSqlModal()
    }
    return
  }
  // 保存到磁盘（Ctrl/Cmd+S，覆盖浏览器「保存网页」快捷键）
  if (mod && !e.altKey && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
    if (store.projectOpened) {
      e.preventDefault()
      void store.saveProjectWithFeedback()
    }
    return
  }
  // 关闭文件夹（Ctrl/Cmd+E，避开浏览器保留的 Ctrl+W / Ctrl+Shift+W）
  if (mod && (e.key === 'e' || e.key === 'E')) {
    if (store.projectOpened) {
      e.preventDefault()
      void store.requestCloseProject()
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

// 关闭标签页/刷新前：有未保存改动时交给浏览器原生确认
// （自动保存关闭后磁盘上的内容落后于网页，静默离开会丢改动）
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!store.hasUnsavedChanges) return
  e.preventDefault()
  e.returnValue = ''
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', onBeforeUnload)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
})
</script>

<template>
  <!-- ===== Menu Bar ===== -->
  <div class="menu-bar">
    <img src="/logo.png" alt="Logo" class="menu-bar-logo" />
    <span class="menu-bar-brand">{{ $t('app.title') }}</span>

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
          @click="menuAction(() => store.saveProjectWithFeedback())"
        >
          <span>{{ $t('toolbar.save') }}</span>
          <span class="menu-shortcut">{{ isMac ? '⌘S' : 'Ctrl+S' }}</span>
        </div>
        <div
          class="menu-dropdown-item"
          :class="{ disabled: !store.projectOpened }"
          @click="store.projectOpened && menuAction(() => store.requestCloseProject())"
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
          <span>{{ $t('toolbar.importSql') }}</span>
          <span class="menu-shortcut">{{ isMac ? '⌘I' : 'Ctrl+I' }}</span>
        </div>
        <div class="menu-separator"></div>
        <div
          class="menu-dropdown-item"
          :class="{ disabled: !store.projectOpened }"
          @click="store.projectOpened && menuAction(() => store.reloadFromDisk())"
        >
          <span>{{ $t('toolbar.reloadFromDisk') }}</span>
          <span class="menu-shortcut">{{ isMac ? '⌥R' : 'Alt+R' }}</span>
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
        <a
          class="menu-dropdown-item"
          :href="GITHUB_ISSUE_URL"
          target="_blank"
          rel="noopener noreferrer"
          @click="closeMenu()"
        >
          {{ $t('toolbar.reportIssue') }}
        </a>
        <div class="menu-separator"></div>
        <a
          class="menu-dropdown-item"
          :href="changelogUrl(version)"
          target="_blank"
          rel="noopener noreferrer"
          @click="closeMenu()"
        >
          {{ $t('toolbar.changelog') }}
        </a>
        <div class="menu-separator"></div>
        <div class="menu-dropdown-item" @click="menuAction(() => { showAboutModal = true })">
          {{ $t('toolbar.about') }}
        </div>
      </div>
    </div>

    <!-- 居中标题：点击进入「项目设置 → 项目信息」 -->
    <button
      v-if="displayTitle"
      class="menu-bar-title"
      type="button"
      :title="`${displayTitle} — ${t('settings.tabs.project')}`"
      @click="store.openProjectInfoSettings()"
    >{{ displayTitle }}</button>

    <!-- Right Side -->
    <div class="menu-bar-right">
      <div v-if="store.projectOpened" class="save-switches">
        <label class="autosave-toggle" :title="$t('toolbar.autoSaveTitle')">
          <input
            type="checkbox"
            :checked="store.autoSaveEnabled"
            @change="store.setAutoSave(($event.target as HTMLInputElement).checked)"
          />
          <span>{{ $t('toolbar.autoSave') }}</span>
        </label>
        <label class="autosave-toggle" :title="$t('toolbar.autoSyncSqlTitle')">
          <input
            type="checkbox"
            :checked="store.autoSyncOutputsEnabled"
            @change="store.setAutoSyncOutputs(($event.target as HTMLInputElement).checked)"
          />
          <span>{{ $t('toolbar.autoSyncSql') }}</span>
        </label>
      </div>

      <span
        v-if="store.projectOpened"
        class="save-badge"
        :class="{ 'is-dirty': store.hasUnsavedChanges, 'is-error': !!store.saveState.error }"
        :title="saveBadge"
      >{{ saveBadge }}</span>

      <button
        v-if="store.projectOpened"
        class="toolbar-btn"
        :class="{ 'toolbar-btn--primary': store.hasUnsavedChanges }"
        :disabled="store.saveState.saving"
        :title="$t('toolbar.saveTitle')"
        @click="store.saveProjectWithFeedback()"
      >
        &#128190;&#xFE0E; {{ $t('toolbar.save') }}
      </button>

      <div class="theme-switch" role="group" :title="$t('toolbar.theme')">
        <button
          v-for="opt in themeOptions"
          :key="opt.value"
          type="button"
          class="theme-switch-btn"
          :class="{ active: themePreference === opt.value }"
          :title="$t(opt.labelKey)"
          @click="setTheme(opt.value)"
        >
          <component :is="opt.icon" />
        </button>
      </div>

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
  box-shadow: var(--shadow-sm);
  position: relative;
}

.menu-bar-logo {
  height: 20px;
  aspect-ratio: 1;
  margin: 0 6px 0 12px;
}

/* 品牌名：固定在左上角，不随项目变化 */
.menu-bar-brand {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  margin-right: 16px;
  white-space: nowrap;
}

/* 项目名称：绝对定位在菜单栏正中（不受左右宽度影响），样式低调、可点击 */
.menu-bar-title {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  max-width: 40%;
  padding: 3px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  font-family: inherit;
  font-size: 12px;
  font-weight: 400;
  color: var(--fg-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  transition: background .12s ease, color .12s ease;
}

.menu-bar-title:hover {
  background: var(--surface-3);
  color: var(--fg);
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
  color: var(--fg-subtle);
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

.save-badge {
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  opacity: 0.85;
  white-space: nowrap;
  color: var(--fg-muted);
}

.save-badge.is-dirty {
  color: var(--warning);
  opacity: 1;
}

.save-badge.is-error {
  color: var(--danger);
  opacity: 1;
}

.save-switches {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.autosave-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--fg-muted);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}

.autosave-toggle input {
  margin: 0;
  cursor: pointer;
}

.toolbar-btn--primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-fg);
}

.toolbar-btn--primary:hover:not(:disabled) {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
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

/* ===== Theme Switch（跟随系统 / 浅色 / 深色） ===== */
.theme-switch {
  display: inline-flex;
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  overflow: hidden;
}

.theme-switch-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition: background .12s ease, color .12s ease;
}

.theme-switch-btn + .theme-switch-btn {
  border-left: 1px solid var(--border);
}

.theme-switch-btn:hover {
  background: var(--surface-3);
  color: var(--fg);
}

.theme-switch-btn.active {
  background: var(--accent);
  color: var(--accent-fg);
}
</style>
