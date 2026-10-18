<script setup lang="ts">
import { ref, computed, watchEffect, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  PopoverRoot,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from 'reka-ui'
import { useEditorStore } from '@/stores/editor'
import { availableLocales, persistLocale } from '@/i18n/detection'
import type { SupportedLocale } from '@/i18n/detection'
import AboutModal from '@/components/modal/AboutModal.vue'
import SegmentedSwitch from '@/components/ui/SegmentedSwitch.vue'
import MonitorIcon from '@/components/icon/MonitorIcon.vue'
import SunIcon from '@/components/icon/SunIcon.vue'
import MoonIcon from '@/components/icon/MoonIcon.vue'
import { GITHUB_REPO_URL, GITHUB_ISSUE_URL, changelogUrl } from '@/utils/constants'
import { APP_VERSION } from '@/utils/build-info'
import { useTheme } from '@/composables/useTheme'
import type { ThemePreference } from '@/composables/useTheme'
import { useDensity } from '@/composables/useDensity'
import type { DensityPreference } from '@/composables/useDensity'
import { folderLabel, useRecentFolders } from '@/composables/useRecentFolders'

const store = useEditorStore()
const { t, locale } = useI18n()
const { preference: themePreference, setTheme } = useTheme()
const { preference: densityPreference, setDensity } = useDensity()
const {
  supported: recentFoldersSupported,
  recentFolders,
  refresh: refreshRecentFolders,
  open: openRecentFolder,
  remove: removeRecentFolder,
} = useRecentFolders()

/** 主题三档：跟随系统 / 浅色 / 深色 */
const themeOptions = [
  { value: 'system' as const, labelKey: 'toolbar.themeSystem', icon: MonitorIcon },
  { value: 'light' as const, labelKey: 'toolbar.themeLight', icon: SunIcon },
  { value: 'dark' as const, labelKey: 'toolbar.themeDark', icon: MoonIcon },
]

/** 触发按钮图标随当前主题偏好变化 */
const activeThemeIcon = computed(
  () => themeOptions.find(opt => opt.value === themePreference.value)?.icon ?? MonitorIcon,
)

const themeSegments = computed(() =>
  themeOptions.map(opt => ({ value: opt.value, label: t(opt.labelKey) })),
)

/** 密度三档：紧凑 / 正常 / 宽松 */
const densitySegments = computed(() => [
  { value: 'compact', label: t('toolbar.densityCompact') },
  { value: 'normal', label: t('toolbar.densityNormal') },
  { value: 'relaxed', label: t('toolbar.densityRelaxed') },
])

function onThemeChange(value: string) {
  setTheme(value as ThemePreference)
}

function onDensityChange(value: string) {
  setDensity(value as DensityPreference)
}

const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '')

const showAboutModal = ref(false)

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

/** Git 徽章提示：仓库地址 + 作为数据源的子目录 */
const gitBadgeTitle = computed(() => {
  const repo = store.gitRepo
  if (!repo) return ''
  return repo.subdir ? `${repo.webUrl} (${repo.subdir})` : repo.webUrl
})

/** 菜单展开时刷新最近列表，确保本次会话中新打开的文件夹立即出现 */
function onFileMenuOpen(open: boolean) {
  if (open) void refreshRecentFolders()
}

function switchLocale(newLocale: SupportedLocale) {
  locale.value = newLocale
  persistLocale(newLocale)
  document.documentElement.lang = newLocale
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
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', onBeforeUnload)
})

onUnmounted(() => {
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
    <DropdownMenuRoot @update:open="onFileMenuOpen">
      <DropdownMenuTrigger class="menu-item" type="button">{{ $t('menu.file') }}</DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent class="menu-dropdown" align="start" :side-offset="4">
          <DropdownMenuItem
            class="menu-dropdown-item"
            :disabled="store.projectOpened"
            @select="store.openProject()"
          >
            <span>{{ $t('toolbar.openFolder') }}</span>
            <span class="menu-shortcut">{{ isMac ? '⌘O' : 'Ctrl+O' }}</span>
          </DropdownMenuItem>
          <DropdownMenuSub v-if="recentFoldersSupported">
            <DropdownMenuSubTrigger class="menu-dropdown-item" :disabled="store.projectOpened">
              <span>{{ $t('toolbar.recentFolders') }}</span>
              <span class="menu-shortcut">›</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent class="menu-dropdown recent-folders-menu" :side-offset="4">
                <DropdownMenuItem v-if="!recentFolders.length" class="menu-dropdown-item" disabled>
                  {{ $t('toolbar.recentFoldersEmpty') }}
                </DropdownMenuItem>
                <DropdownMenuItem
                  v-for="folder in recentFolders"
                  :key="folder"
                  class="menu-dropdown-item recent-folder-item"
                  @select="openRecentFolder(folder)"
                >
                  <span class="recent-folder-text">
                    <span class="recent-folder-name">{{ folderLabel(folder) }}</span>
                    <span class="recent-folder-path">{{ folder }}</span>
                  </span>
                  <button
                    class="recent-folder-remove"
                    type="button"
                    :title="$t('toolbar.removeRecentFolder')"
                    :aria-label="$t('toolbar.removeRecentFolder')"
                    @pointerdown.stop.prevent
                    @pointerup.stop.prevent
                    @click.stop="removeRecentFolder(folder)"
                  >×</button>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuItem
            class="menu-dropdown-item"
            :disabled="store.projectOpened"
            @select="store.openGitRepoModal()"
          >
            <span>{{ $t('toolbar.openGitRepo') }}</span>
          </DropdownMenuItem>
          <DropdownMenuItem class="menu-dropdown-item" @select="store.saveProjectWithFeedback()">
            <span>{{ $t('toolbar.save') }}</span>
            <span class="menu-shortcut">{{ isMac ? '⌘S' : 'Ctrl+S' }}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            class="menu-dropdown-item"
            :disabled="!store.projectOpened"
            @select="store.requestCloseProject()"
          >
            <span>{{ $t('toolbar.closeFolder') }}</span>
            <span class="menu-shortcut">{{ isMac ? '⌘E' : 'Ctrl+E' }}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator class="menu-separator" />
          <DropdownMenuItem
            class="menu-dropdown-item"
            :disabled="!store.projectOpened"
            @select="store.openImportSqlModal()"
          >
            <span>{{ $t('toolbar.importSql') }}</span>
            <span class="menu-shortcut">{{ isMac ? '⌘I' : 'Ctrl+I' }}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator class="menu-separator" />
          <DropdownMenuItem
            class="menu-dropdown-item"
            :disabled="!store.projectOpened"
            @select="store.reloadFromDisk()"
          >
            <span>{{ store.gitRepo ? $t('toolbar.reloadFromRepo') : $t('toolbar.reloadFromDisk') }}</span>
            <span class="menu-shortcut">{{ isMac ? '⌥R' : 'Alt+R' }}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenuRoot>

    <!-- Edit Menu -->
    <DropdownMenuRoot>
      <DropdownMenuTrigger class="menu-item" type="button">{{ $t('menu.edit') }}</DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent class="menu-dropdown" align="start" :side-offset="4">
          <DropdownMenuItem
            class="menu-dropdown-item"
            :disabled="!store.canUndo"
            @select="store.undo()"
          >
            <span>{{ $t('history.undo') }}</span>
            <span class="menu-shortcut">{{ isMac ? '⌘Z' : 'Ctrl+Z' }}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            class="menu-dropdown-item"
            :disabled="!store.canRedo"
            @select="store.redo()"
          >
            <span>{{ $t('history.redo') }}</span>
            <span class="menu-shortcut">{{ isMac ? '⌘⇧Z' : 'Ctrl+Shift+Z / Ctrl+Y' }}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenuRoot>

    <!-- Help Menu -->
    <DropdownMenuRoot>
      <DropdownMenuTrigger class="menu-item" type="button">{{ $t('menu.help') }}</DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent class="menu-dropdown" align="start" :side-offset="4">
          <DropdownMenuItem as-child class="menu-dropdown-item">
            <a :href="GITHUB_REPO_URL" target="_blank" rel="noopener noreferrer">{{ $t('toolbar.github') }}</a>
          </DropdownMenuItem>
          <DropdownMenuItem as-child class="menu-dropdown-item">
            <a :href="GITHUB_ISSUE_URL" target="_blank" rel="noopener noreferrer">{{ $t('toolbar.reportIssue') }}</a>
          </DropdownMenuItem>
          <DropdownMenuSeparator class="menu-separator" />
          <DropdownMenuItem as-child class="menu-dropdown-item">
            <a :href="changelogUrl(APP_VERSION)" target="_blank" rel="noopener noreferrer">{{ $t('toolbar.changelog') }}</a>
          </DropdownMenuItem>
          <DropdownMenuSeparator class="menu-separator" />
          <DropdownMenuItem class="menu-dropdown-item" @select="showAboutModal = true">
            {{ $t('toolbar.about') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenuRoot>

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
      <!-- Git 仓库模式：显示数据源仓库与分支，点击打开仓库页面 -->
      <a
        v-if="store.gitRepo"
        class="git-badge"
        :href="store.gitRepo.webUrl"
        target="_blank"
        rel="noopener noreferrer"
        :title="gitBadgeTitle"
      >{{ store.gitRepo.owner }}/{{ store.gitRepo.repo }}@{{ store.gitRepo.branch }}</a>

      <div v-if="store.projectOpened" class="save-switches">
        <label class="autosave-toggle" :title="store.gitRepo ? $t('toolbar.autoSaveUnsupported') : $t('toolbar.autoSaveTitle')">
          <input
            type="checkbox"
            :checked="!store.gitRepo && store.autoSaveEnabled"
            :disabled="!!store.gitRepo"
            @change="store.setAutoSave(($event.target as HTMLInputElement).checked)"
          />
          <span>{{ $t('toolbar.autoSave') }}</span>
        </label>
        <label class="autosave-toggle" :title="store.gitRepo ? $t('toolbar.autoSaveUnsupported') : $t('toolbar.autoSyncSqlTitle')">
          <input
            type="checkbox"
            :checked="!store.gitRepo && store.autoSyncOutputsEnabled"
            :disabled="!!store.gitRepo"
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
        &#128190;&#xFE0E; {{ store.gitRepo ? $t('toolbar.commit') : $t('toolbar.save') }}
      </button>

      <!-- 外观面板：主题 + 界面密度 -->
      <PopoverRoot>
        <PopoverTrigger class="appearance-btn" type="button" :title="$t('toolbar.theme')">
          <component :is="activeThemeIcon" />
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent class="appearance-popover" align="end" :side-offset="6">
            <div class="appearance-row">
              <span class="appearance-label">{{ $t('toolbar.theme') }}</span>
              <SegmentedSwitch
                :model-value="themePreference"
                :options="themeSegments"
                @update:model-value="onThemeChange"
              />
            </div>
            <div class="appearance-row">
              <span class="appearance-label">{{ $t('toolbar.density') }}</span>
              <SegmentedSwitch
                :model-value="densityPreference"
                :options="densitySegments"
                @update:model-value="onDensityChange"
              />
            </div>
          </PopoverContent>
        </PopoverPortal>
      </PopoverRoot>

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

/* Git 数据源徽章：仓库与分支 */
.git-badge {
  display: inline-flex;
  align-items: center;
  max-width: 220px;
  padding: 2px 8px;
  border: 1px solid var(--accent-border);
  border-radius: 999px;
  background: var(--accent-subtle);
  color: var(--accent);
  font-size: 11px;
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background .12s ease;
}

.git-badge:hover {
  background: var(--accent-subtle-2);
}

.autosave-toggle input:disabled {
  cursor: not-allowed;
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

/* ===== 最近打开文件夹 ===== */
.recent-folders-menu {
  min-width: 280px;
  max-width: 440px;
}

.recent-folder-item {
  gap: 10px;
  padding-right: 8px;
}

.recent-folder-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
}

.recent-folder-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-folder-path {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  color: var(--fg-subtle);
}

.recent-folder-remove {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--fg-subtle);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.recent-folder-remove:hover {
  background: var(--surface-3);
  color: var(--danger);
}

/* ===== 外观按钮（打开主题 / 密度面板） ===== */
.appearance-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--fg-muted);
  cursor: pointer;
  transition: background .12s ease, border-color .12s ease, color .12s ease;
}

.appearance-btn:hover,
.appearance-btn[data-state="open"] {
  background: var(--surface-3);
  border-color: var(--border-strong);
  color: var(--fg);
}
</style>
