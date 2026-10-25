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
import logoUrl from '@/assets/logo.svg'
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
import {
  appliedTitleBarMode,
  desktopPlatform,
  isDesktop,
  restartApp,
  selectedTitleBarMode,
  setTitleBarMode,
  titleBarRestartRequired,
} from '@/composables/useWindowChrome'
import type { DesktopTitleBarMode } from 'schema-editor-bridge'

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

/** Theme options: follow system / light / dark */
const themeOptions = [
  { value: 'system' as const, labelKey: 'toolbar.themeSystem', icon: MonitorIcon },
  { value: 'light' as const, labelKey: 'toolbar.themeLight', icon: SunIcon },
  { value: 'dark' as const, labelKey: 'toolbar.themeDark', icon: MoonIcon },
]

/** Trigger button icon follows the current theme preference */
const activeThemeIcon = computed(
  () => themeOptions.find(opt => opt.value === themePreference.value)?.icon ?? MonitorIcon,
)

const themeSegments = computed(() =>
  themeOptions.map(opt => ({ value: opt.value, label: t(opt.labelKey) })),
)

/** Density options: compact / normal / relaxed */
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

/** Desktop chrome: the integrated mode merges the caption controls into this menu bar */
const integratedChrome = computed(
  () => isDesktop.value && appliedTitleBarMode.value === 'integrated',
)
const integratedMac = computed(() => integratedChrome.value && desktopPlatform.value === 'darwin')
const overlayControls = computed(
  () => integratedChrome.value && desktopPlatform.value !== 'darwin',
)

const titleBarOptions = computed(() => [
  { value: 'integrated', label: t('toolbar.titleBarIntegrated') },
  { value: 'native', label: t('toolbar.titleBarNative') },
])

const restarting = ref(false)

function onTitleBarModeChange(value: string) {
  void setTitleBarMode(value as DesktopTitleBarMode)
}

async function onRestartApp() {
  if (store.hasUnsavedChanges || restarting.value) return
  restarting.value = true
  try {
    await restartApp()
  } finally {
    restarting.value = false
  }
}

const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '')

const showAboutModal = ref(false)

/** Centered title in the top menu bar: shows the project name, empty when unset */
const displayTitle = computed(() => store.projectName.trim())

/** Page title: project name - app name; app name only when no project name is set. A dot marker is added for unsaved changes */
watchEffect(() => {
  const base = displayTitle.value
    ? `${displayTitle.value} - ${t('app.title')}`
    : t('app.title')
  document.title = store.hasUnsavedChanges ? `● ${base}` : base
})

/** Save state at top right: saving / save failed / N unsaved / saved */
const saveBadge = computed(() => {
  const state = store.saveState
  if (state.saving) return t('toolbar.saving')
  if (state.error) return t('toolbar.saveFailed')
  if (state.dirty) return t('toolbar.unsaved', { n: state.pendingFiles })
  return t('toolbar.saved')
})

/** Git badge tooltip: repository URL + subdirectory used as the data source */
const gitBadgeTitle = computed(() => {
  const repo = store.gitRepo
  if (!repo) return ''
  return repo.subdir ? `${repo.webUrl} (${repo.subdir})` : repo.webUrl
})

/** Refresh the recent list when the menu opens, ensuring folders opened in this session appear immediately */
function onFileMenuOpen(open: boolean) {
  if (open) void refreshRecentFolders()
}

function switchLocale(newLocale: SupportedLocale) {
  locale.value = newLocale
  persistLocale(newLocale)
  document.documentElement.lang = newLocale
}

/** Check whether the event target is an editable element (input/textarea/contenteditable); native undo/redo should be used in such cases */
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

  // Reload from disk (Alt/Option+R, only when a project is open)
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyR') {
    if (store.projectOpened) {
      e.preventDefault()
      store.reloadFromDisk()
    }
    return
  }
  // Open folder (common Ctrl/Cmd+O convention), invokes the directory picker
  if (mod && (e.key === 'o' || e.key === 'O')) {
    e.preventDefault()
    store.openProject()
    return
  }
  // Import via SQL (Ctrl/Cmd+I, only when a project is open)
  if (mod && !e.altKey && e.code === 'KeyI') {
    if (store.projectOpened) {
      e.preventDefault()
      store.openImportSqlModal()
    }
    return
  }
  // Save to disk (Ctrl/Cmd+S, overrides the browser "Save page" shortcut)
  if (mod && !e.altKey && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
    if (store.projectOpened) {
      e.preventDefault()
      void store.saveProjectWithFeedback()
    }
    return
  }
  // Close folder (Ctrl/Cmd+E, avoiding the browser-reserved Ctrl+W / Ctrl+Shift+W)
  if (mod && (e.key === 'e' || e.key === 'E')) {
    if (store.projectOpened) {
      e.preventDefault()
      void store.requestCloseProject()
    }
    return
  }
  // Undo/Redo shortcuts (only active when a project is open).
  // When focus is in an editable element such as an input/textarea, let the browser handle native undo/redo,
  // to avoid interception breaking undo/redo in scenarios such as the import SQL dialog.
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

// Before closing the tab / refreshing: let the browser confirm natively when there are unsaved changes
// (with autosave off, disk contents lag behind the page, so leaving silently loses changes)
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
  <div
    class="menu-bar"
    :class="{
      'is-integrated': integratedChrome,
      'is-integrated-mac': integratedMac,
      'has-overlay-controls': overlayControls,
    }"
  >
    <img :src="logoUrl" alt="Logo" class="menu-bar-logo" />
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

    <!-- Centered title: click to open "Project Settings → Project Info" -->
    <button
      v-if="displayTitle"
      class="menu-bar-title"
      type="button"
      :title="`${displayTitle} — ${t('settings.tabs.project')}`"
      @click="store.openProjectInfoSettings()"
    >{{ displayTitle }}</button>

    <!-- Right Side -->
    <div class="menu-bar-right">
      <!-- Git repository mode: shows the data source repository and branch, click to open the repository page -->
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

      <!-- Appearance panel: theme + interface density -->
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
            <div v-if="isDesktop" class="appearance-block">
              <div class="appearance-row">
                <span class="appearance-label">{{ $t('toolbar.titleBar') }}</span>
                <SegmentedSwitch
                  :model-value="selectedTitleBarMode"
                  :options="titleBarOptions"
                  @update:model-value="onTitleBarModeChange"
                />
              </div>
              <p class="appearance-hint">{{ $t('toolbar.titleBarHint') }}</p>
              <div v-if="titleBarRestartRequired" class="appearance-restart">
                <span class="appearance-restart-text">
                  {{ store.hasUnsavedChanges ? $t('toolbar.titleBarRestartUnsaved') : $t('toolbar.titleBarRestartNotice') }}
                </span>
                <button
                  type="button"
                  class="appearance-restart-btn"
                  :disabled="store.hasUnsavedChanges || restarting"
                  @click="onRestartApp"
                >{{ $t('toolbar.restartApp') }}</button>
              </div>
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

/* Integrated desktop chrome: the bar doubles as the window drag region and reserves space for caption controls */
.menu-bar.is-integrated {
  -webkit-app-region: drag;
}

.menu-bar.is-integrated button,
.menu-bar.is-integrated a,
.menu-bar.is-integrated input,
.menu-bar.is-integrated select,
.menu-bar.is-integrated label {
  -webkit-app-region: no-drag;
}

.menu-bar.is-integrated-mac {
  padding-left: 66px;
}

.menu-bar.has-overlay-controls {
  padding-right: 150px;
}

.menu-bar-logo {
  height: 20px;
  aspect-ratio: 1;
  margin: 0 6px 0 12px;
}

/* Brand name: fixed at the top left, does not change with the project */
.menu-bar-brand {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  margin-right: 16px;
  white-space: nowrap;
}

/* Project name: absolutely positioned in the center of the menu bar (unaffected by side widths), understated and clickable */
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

/* Git data source badge: repository and branch */
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

/* ===== Recently Opened Folders ===== */
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

/* ===== Appearance button (opens theme / density panel) ===== */
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
