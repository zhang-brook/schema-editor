import { ref, reactive, computed } from 'vue'
import { defineStore } from 'pinia'
import { useI18n } from 'vue-i18n'
import type {
  CommonConfig,
  Schema,
  InitialData,
} from 'schema-editor-core/types/schema'
import type { SettingsTab } from '@/types/settings'
import { isFileSystemAccessSupported, isNewStructure, isEmptyFolder } from 'schema-editor-core/utils/file-helpers'
import { checkVersion } from 'schema-editor-core/utils/structure-migrations/version-utils'
import { runStructureMigrations } from 'schema-editor-core/utils/structure-migrations'
import {
  CommandManager,
  affectedCommon,
  type Command,
  type AffectedFile,
} from 'schema-editor-core/core/history/command'
import { COMMON_FILE, CURRENT_DIR, CURRENT_STRUCT_VERSION } from 'schema-editor-core/core/workspace/layout'
import { buildSchemaExportData } from 'schema-editor-core/core/workspace/serialization'
import { BrowserWorkspaceWriter } from 'schema-editor-core/core/workspace/browser-workspace'
import { createDefaultCommonConfig, createWorkspaceSession, loadWorkspaceDocuments, type SessionWriter, type WorkspaceSession } from 'schema-editor-core/core/workspace/workspace-session'
import type { SaveState, StagedChange } from 'schema-editor-core/core/workspace/save-coordinator'
import { GitRepoError, type GitRepoInfo } from 'schema-editor-core/core/workspace/git/types'
import { normalizeSubdir, parseRepoUrl } from 'schema-editor-core/core/workspace/git/url'
import { connectGitWorkspace } from 'schema-editor-core/core/workspace/git/workspace'
import { readGitToken, storeGitToken } from 'schema-editor-core/core/workspace/git/credentials'
import { jsonContent } from 'schema-editor-core/core/workspace/project-documents'
import { loadGenerateAiGuide, saveGenerateAiGuide } from 'schema-editor-core/utils/ai-guide'
import { ALL_SQL_DIALECTS, type SqlDialect } from 'schema-editor-core/utils/sql-generator/shared'
import type { UnifiedTypeDefinition } from 'schema-editor-core/types/schema'
import type { ParsedTable, ParseMessage } from 'schema-editor-core/utils/sql-parser'
import { createInitialDataActions } from './editor-initial-data'
import { createVersionActions } from './editor-version'
import { buildVersionChain } from 'schema-editor-core/core/version/chain'
import { createImportSqlActions } from './editor-import-sql'
import { createCommonConfigActions } from './editor-common-config'
import { createCrudActions } from './editor-crud'
import type {
  VersionSummary,
  VersionSnapshot,
  Migration,
  Environment,
} from 'schema-editor-core/core/version/types'
import { confirmDialog, chooseDialog, alertDialog } from '@/composables/useConfirm'

export const useEditorStore = defineStore('editor', () => {
  const { t } = useI18n()

  // ===== State =====
  const commonConfig = ref<CommonConfig | null>(null)
  const schemas = reactive<Schema[]>([])
  const selectedSchemaIdx = ref(-1)
  const selectedTableIdx = ref(-1)
  const expandedFields = reactive(new Set<string>())
  const expandedIndexes = reactive(new Set<string>())
  // ===== Project settings (VSCode style: left tab switch) =====
  const settingsTab = ref<SettingsTab>('structure')
  const toastMsg = ref('')
  const toastVisible = ref(false)
  const showAddFieldModal = ref(false)
  const addFieldMode = ref<'normal' | 'common'>('normal')
  const addFieldSchemaIdx = ref(-1)
  const addFieldTableIdx = ref(-1)
  const newFieldName = ref('')
  const newFieldSelectCommon = ref('')
  const newFieldSelectCommons = ref<string[]>([])
  const newFieldUnifiedType = ref('')

  // File System Access API handles (in-memory, same session)
  const rootDirHandle = ref<FileSystemDirectoryHandle | null>(null)
  const projectOpened = ref(false)

  // ===== Git repository mode: the remote branch is the data source, no local directory handle =====
  const gitRepo = ref<GitRepoInfo | null>(null)
  const showOpenGitModal = ref(false)
  const commitDialogVisible = ref(false)
  const commitPendingChanges = ref<StagedChange[]>([])
  const commitMessage = ref('')
  let commitResolve: ((confirmed: boolean) => void) | null = null

  // ===== Project setting: whether to generate/update the AI JSON structure guide in the user-opened folder =====
  // This setting is saved with the project to common.json (commonConfig.generate_ai_guide), defaults to false
  const generateAiGuide = ref<boolean>(false)

  // ===== Saving: changes are incrementally persisted through the workspace session =====
  const AUTO_SAVE_PREF = 'schema-editor.autosave'
  const AUTO_SYNC_OUTPUTS_PREF = 'schema-editor.autosave-outputs'

  function readBoolPref(key: string, fallback: boolean): boolean {
    if (typeof localStorage === 'undefined') return fallback
    const stored = localStorage.getItem(key)
    return stored === null ? fallback : stored !== 'off'
  }

  function writeBoolPref(key: string, value: boolean) {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, value ? 'on' : 'off')
  }

  /**
   * Live-save project files (browser-local preference, enabled by default). When off, changes stay in memory until the user saves.
   * Derived files (SQL under output/) are controlled by autoSyncOutputsEnabled and depend on this project-file switch.
   */
  const autoSaveEnabled = ref(readBoolPref(AUTO_SAVE_PREF, true))
  /** Sync SQL after changes: follows "live save" until set separately; always off when the project-file switch is off */
  const autoSyncOutputsEnabled = ref(autoSaveEnabled.value && readBoolPref(AUTO_SYNC_OUTPUTS_PREF, autoSaveEnabled.value))
  const saveState = ref<SaveState>({ dirty: false, saving: false, error: null, pendingFiles: 0 })
  const hasUnsavedChanges = computed(() => saveState.value.dirty)
  let session: WorkspaceSession | null = null
  /** Whether the last save actually produced a commit (Git mode); used to pick the save feedback message */
  let lastSaveCommitted = false

  // ===== Versions / Migrations =====
  const versions = ref<VersionSummary[]>([])
  const hasVersions = computed(() => versions.value.length > 0)
  const migrations = ref<Migration[]>([])
  const environments = ref<Environment[]>([])
  /** Version chain: a timeline linked by parent-child relations, marking migrations missing between adjacent versions */
  const versionChain = computed(() => buildVersionChain(versions.value, migrations.value))

  // Version preview state
  const selectedVersionSnapshot = ref<VersionSnapshot | null>(null)
  const versionPreviewLoading = ref(false)

  // Initial Data -- stored separately in initial-data/<schema>/<table>.json
  const initialDataMap = reactive(new Map<string, InitialData>())
  const initialDataDeletedKeys = reactive(new Set<string>())

  // ===== Undo/Redo (command pattern) =====
  const history = new CommandManager()
  const canUndo = ref(false)
  const canRedo = ref(false)
  const undoLabel = ref<string | null>(null)
  const redoLabel = ref<string | null>(null)

  /** Sync undo/redo availability to the UI */
  function refreshHistoryFlags() {
    canUndo.value = history.canUndo
    canRedo.value = history.canRedo
    undoLabel.value = history.undoLabel
    redoLabel.value = history.redoLabel
  }

  // ===== Import SQL State =====
  const showImportSqlModal = ref(false)
  const importSqlText = ref('')
  const importSqlDialect = ref<'auto' | SqlDialect>('auto')
  const importSqlParsedTables = ref<ParsedTable[]>([])
  const importSqlErrors = ref<ParseMessage[]>([])
  const importSqlTargetMode = ref<'new' | 'existing'>('new')
  const importSqlTargetSchemaIdx = ref(-1)
  const importSqlNewSchemaName = ref('')
  const importSqlDetectedSchema = ref<string | null>(null)
  /** Table names edited by the user; the key is the index in parsedTables */
  const importSqlTableNameEdits = reactive<Record<number, string>>({})

  // ===== Computed =====
  const currentSchema = computed(() => {
    if (selectedSchemaIdx.value >= 0 && selectedSchemaIdx.value < schemas.length) {
      return schemas[selectedSchemaIdx.value]
    }
    return null
  })

  const currentTable = computed(() => {
    if (currentSchema.value && selectedTableIdx.value >= 0 && selectedTableIdx.value < currentSchema.value.tables.length) {
      return currentSchema.value.tables[selectedTableIdx.value]
    }
    return null
  })

  const commonFieldNames = computed(() => {
    if (!commonConfig.value) return []
    return Object.keys(commonConfig.value.common_used_fields || {})
  })

  const unifiedTypeNames = computed(() => {
    if (!commonConfig.value?.unified_types) return []
    return commonConfig.value.unified_types.map(ut => ut.name)
  })

  const unifiedTypeMap = computed(() => {
    const map = new Map<string, UnifiedTypeDefinition>()
    if (!commonConfig.value?.unified_types) return map
    for (const ut of commonConfig.value.unified_types) {
      map.set(ut.name, ut)
    }
    return map
  })

  // ===== Project info (common.json): the name is shown in the page title and the top menu bar =====
  const projectName = computed(() => commonConfig.value?.project_name ?? '')
  const projectDescription = computed(() => commonConfig.value?.project_description ?? '')

  // One-shot request when the menu bar title is clicked: open "Project settings -> Project info"
  const projectInfoTabRequest = ref(false)

  function openProjectInfoSettings() {
    settingsTab.value = 'project'
    projectInfoTabRequest.value = true
  }

  /** Read and clear the one-shot request; called when ProjectConfigPage mounts, falls back to "global config" when not requested */
  function consumeProjectInfoTabRequest(): boolean {
    if (!projectInfoTabRequest.value) return false
    projectInfoTabRequest.value = false
    return true
  }

  // ===== Enabled SQL dialects (project level, stored in common.json.enabled_dialects) =====

  /** Currently enabled and supported dialects (in supported order); unset or empty means all enabled */
  const enabledDialects = computed<SqlDialect[]>(() => {
    const list = commonConfig.value?.enabled_dialects
    if (!list || list.length === 0) return [...ALL_SQL_DIALECTS]
    return ALL_SQL_DIALECTS.filter(d => list.includes(d))
  })

  function isDialectEnabled(dialect: SqlDialect): boolean {
    return enabledDialects.value.includes(dialect)
  }

  /**
   * Toggle a dialect: write it to common.json and declare the affected files.
   * Unchecking deletes the generated SQL for that dialect under output/ (the dialect config in json is kept); at least one dialect must remain.
   */
  function setDialectEnabled(dialect: SqlDialect, enabled: boolean) {
    if (!commonConfig.value) return
    const stored = commonConfig.value.enabled_dialects
    const list = stored && stored.length ? [...stored] : [...ALL_SQL_DIALECTS]
    const idx = list.indexOf(dialect)
    if (enabled) {
      if (idx === -1) list.push(dialect)
    } else {
      if (idx === -1) return
      if (list.length <= 1) {
        showToast(t('dialectConfig.keepOne'))
        return
      }
      list.splice(idx, 1)
    }
    commonConfig.value.enabled_dialects = list
    markChanged([affectedCommon()])
  }

  // ===== Toast =====
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  function showToast(msg: string) {
    toastMsg.value = msg
    toastVisible.value = true
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toastVisible.value = false }, 2000)
  }

  // ===== Open Project Folder =====

  /** Upgrade confirmation dialog state (migration is triggered manually by the user when opening a legacy-structure project) */
  const pendingUpgradeRootHandle = ref<FileSystemDirectoryHandle | null>(null)
  /** Global loading overlay: shown while upgrading a legacy structure / opening a project; a single global instance */
  const overlayVisible = ref(false)
  const overlayText = ref('')

  function showOverlay(text: string) {
    overlayText.value = text
    overlayVisible.value = true
  }

  /** The overlay must be removed before waiting for user decisions (it means "loading"), hence a separate helper */
  function hideOverlay() {
    overlayVisible.value = false
    overlayText.value = ''
  }

  /** Pick a project folder and load its content, then persist incrementally per the auto-save setting */
  async function openProject() {
    if (!isFileSystemAccessSupported()) {
      // showToast(t('toast.browserNotSupported'))
      await alertDialog({ title: t('alertTitle'), message: t('toast.browserNotSupported') })
      return
    }
    if (projectOpened.value && !(await confirmLeaveUnsaved())) return
    try {
      const rootHandle: FileSystemDirectoryHandle = await window.showDirectoryPicker()
      showOverlay(t('app.loadingOpenProject'))
      await _openRootHandle(rootHandle)
    } catch {
      // User cancelled the directory picker — do nothing
    } finally {
      hideOverlay()
    }
  }

  /** Open a project directly from a dropped folder handle (skipping the directory picker) */
  async function openProjectFromHandle(handle: FileSystemDirectoryHandle) {
    if (!isFileSystemAccessSupported()) {
      await alertDialog({ title: t('alertTitle'), message: t('toast.browserNotSupported') })
      return
    }
    if (projectOpened.value && !(await confirmLeaveUnsaved())) return
    try {
      showOverlay(t('app.loadingOpenProject'))
      await _openRootHandle(handle)
    } catch (e) {
      console.error('[openProjectFromHandle] Failed:', e)
      showToast(t('toast.dropNotSupported'))
    } finally {
      hideOverlay()
    }
  }

  /** Unified open entry: detect new/legacy structure; load the new one directly, show the upgrade dialog for the legacy one */
  async function _openRootHandle(rootHandle: FileSystemDirectoryHandle) {
    rootDirHandle.value = rootHandle

    const isNew = await isNewStructure(rootHandle)
    if (isNew) {
      await _loadNewStructure(rootHandle)
      return
    }

    // Empty folder: treat as a brand-new project, initialize with the new structure (write default common.json), no upgrade prompt
    if (await isEmptyFolder(rootHandle)) {
      const writer = new BrowserWorkspaceWriter(rootHandle)
      await writer.save([{ path: COMMON_FILE, content: jsonContent(createDefaultCommonConfig()) }])
      await _loadNewStructure(rootHandle)
      return
    }

    // Legacy structure: show the upgrade confirmation dialog; do not load (or allow editing) without confirmation
    // Remove the "opening project" overlay first: waiting for the user is not loading, and the overlay would cover the confirmation dialog
    hideOverlay()
    pendingUpgradeRootHandle.value = rootHandle
    const upgraded = await confirmDialog({
      title: t('upgrade.title'),
      message: t('upgrade.message'),
      confirmText: t('upgrade.confirm'),
      cancelText: t('upgrade.cancel'),
    })
    if (upgraded) {
      await confirmUpgradeStructure()
    } else {
      cancelUpgradeStructure()
    }
  }

  /** User confirmed the upgrade: migrate the legacy structure to the new one, then load */
  async function confirmUpgradeStructure() {
    const rootHandle = pendingUpgradeRootHandle.value
    if (!rootHandle) return
    pendingUpgradeRootHandle.value = null
    showOverlay(t('upgrade.loading'))
    try {
      await _migrateAndLoad(rootHandle)
    } catch (e) {
      console.error('[confirmUpgradeStructure] migration failed:', e)
      showToast(t('toast.upgradeFailed'))
    } finally {
      hideOverlay()
    }
  }

  /** Upgrade cancelled: close the project and return to the empty state (keep no legacy open state, no close toast) */
  function cancelUpgradeStructure() {
    pendingUpgradeRootHandle.value = null
    void closeProject(true)
  }

  // ===== Git repository data source =====

  /** Open the "Open Git repository" dialog */
  function openGitRepoModal() {
    if (projectOpened.value) return
    showOpenGitModal.value = true
  }

  /** Map load-time exceptions to repository errors with a code (network failure, missing documents, etc.) */
  function _asRepoError(error: unknown): GitRepoError {
    if (error instanceof GitRepoError) return error
    if (error instanceof TypeError) return new GitRepoError('network', error.message, error)
    return new GitRepoError('notProject', error instanceof Error ? error.message : String(error), error)
  }

  /**
   * Connect a Git repository and mount it as the current project: parse URL -> resolve default branch -> build file snapshot -> load documents.
   * Throws GitRepoError on failure; the dialog shows the error message by code. Returns false when the version check fails.
   */
  async function openGitRepository(input: { url: string; branch: string; subdir: string; token: string; remember: boolean }): Promise<boolean> {
    if (projectOpened.value && !(await confirmLeaveUnsaved())) return false
    showOverlay(t('app.loadingOpenProject'))
    try {
      const parsed = parseRepoUrl(input.url)
      const target = {
        ...parsed,
        branch: input.branch.trim() || parsed.branch,
        subdir: input.subdir.trim() ? normalizeSubdir(input.subdir) : parsed.subdir,
      }
      const token = input.token.trim()
      const { writer, info } = await connectGitWorkspace(target, token)
      const ok = await _mountWorkspace(writer, 'git')
      if (!ok) return false
      gitRepo.value = info
      storeGitToken(info.host, token, input.remember)
      return true
    } catch (error) {
      throw _asRepoError(error)
    } finally {
      hideOverlay()
    }
  }

  /** Git-mode reload: re-fetch the branch snapshot from the remote (unsaved changes go through the leave guard first) */
  async function _reloadGitRepo() {
    const current = gitRepo.value
    if (!current) return
    showOverlay(t('app.loadingOpenProject'))
    try {
      const { writer, info } = await connectGitWorkspace(current, readGitToken(current.host))
      const closing = session
      session = null
      await closing?.coordinator.dispose()
      const ok = await _mountWorkspace(writer, 'git')
      if (!ok) {
        await closeProject(true)
        return
      }
      gitRepo.value = info
      showToast(t('toast.reloadedFromDisk'))
    } catch (e) {
      console.error('[reloadGitRepo] Failed:', e)
      const repoError = _asRepoError(e)
      showToast(t(`gitRepo.openError.${repoError.code}`))
    } finally {
      hideOverlay()
    }
  }

  /** Commit dialog: show the files to commit and wait for the user to confirm the commit message */
  function requestCommitMessage(staged: StagedChange[]): Promise<boolean> {
    commitPendingChanges.value = staged
    commitMessage.value = t('commitDialog.defaultMessage', { n: staged.length })
    commitDialogVisible.value = true
    return new Promise(resolve => { commitResolve = resolve })
  }

  /** Commit dialog: confirm (falls back to the default message when empty) */
  function confirmCommit() {
    const count = commitPendingChanges.value.length
    session?.setCommitMessage(commitMessage.value.trim() || t('commitDialog.defaultMessage', { n: count }))
    _closeCommitDialog(true)
  }

  /** Commit dialog: cancel this commit */
  function cancelCommit() {
    _closeCommitDialog(false)
  }

  function _closeCommitDialog(confirmed: boolean) {
    commitDialogVisible.value = false
    commitPendingChanges.value = []
    const resolve = commitResolve
    commitResolve = null
    resolve?.(confirmed)
  }

  // ===== Close Project =====

  /** Close the current project folder and clear all editing state. With silent=true no "project closed" toast is shown (e.g. when cancelling an upgrade) */
  async function closeProject(silent = false) {
    _stopFileObserver()
    const closing = session
    session = null
    rootDirHandle.value = null
    gitRepo.value = null
    projectOpened.value = false
    _resetMemory()
    saveState.value = { dirty: false, saving: false, error: null, pendingFiles: 0 }
    await closing?.coordinator.dispose()
    if (!silent) showToast(t('toast.projectClosed'))
  }

  /** Discard the current in-memory state when switching or closing projects; unsaved changes must be confirmed beforehand */
  function _resetMemory() {
    commonConfig.value = null
    generateAiGuide.value = false
    schemas.length = 0
    initialDataMap.clear()
    initialDataDeletedKeys.clear()
    versions.value = []
    migrations.value = []
    environments.value = []
    selectedVersionSnapshot.value = null
    selectedSchemaIdx.value = -1
    selectedTableIdx.value = -1
    settingsTab.value = 'structure'
    expandedFields.clear()
    expandedIndexes.clear()
    history.clear()
    refreshHistoryFlags()
  }

  // ===== Versions / Migrations (extracted) =====
  const {
    loadVersionsAndMigrations,
    createVersion,
    renameVersion,
    deleteVersionById,
    getVersionSnapshot,
    previewVersionById,
    clearVersionPreview,
    computeDiff,
    suggestRenameEntries,
    createMigration,
    updateMigration,
    deleteMigrationById,
    previewMigrationDdl,
    createEnvironment,
    updateEnvironment,
    deleteEnvironmentById,
  } = createVersionActions({
    getDocuments: () => session ? { files: session.coordinator.files, update: changes => session?.coordinator.update(changes) } : null,
    versions,
    migrations,
    environments,
    versionPreviewLoading,
    selectedVersionSnapshot,
    commonConfig,
    schemas,
    initialDataMap,
    showToast,
    t,
  })

  // ===== Load Project (current/) =====

  /**
   * Load and mount a workspace (shared by local folders and Git repositories):
   * read common.json / database.json / all schema, table and initial-data documents at once,
   * use the text read as the save baseline so the workspace session only writes files that actually changed.
   * Returns false when the version check fails.
   */
  async function _mountWorkspace(writer: SessionWriter, source: 'folder' | 'git'): Promise<boolean> {
    const { project, files } = await loadWorkspaceDocuments(writer)

    const versionResult = checkVersion(project.common)
    if (!versionResult.ok) {
      await alertDialog({ title: t('alertTitle'), message: versionResult.error ?? '' })
      return false
    }
    if (versionResult.needsUpgrade) {
      // Legacy upgrade is only supported for local folders (the upgrader needs a directory handle); in Git mode only notify
      if (source === 'git') await alertDialog({ title: t('alertTitle'), message: t('gitRepo.upgradeUnsupported') })
      return false
    }

    const previous = session
    session = null
    await previous?.coordinator.dispose()

    _resetMemory()
    commonConfig.value = project.common
    schemas.push(...project.schemas)
    for (const [key, data] of project.initialData) initialDataMap.set(key, data)
    generateAiGuide.value = loadGenerateAiGuide(commonConfig.value)

    // Auto-select the first schema
    if (schemas.length > 0) {
      selectedSchemaIdx.value = 0
      selectedTableIdx.value = schemas[0]!.tables.length > 0 ? 0 : -1
    }

    projectOpened.value = true
    session = createWorkspaceSession({
      writer,
      files,
      project: () => ({ common: commonConfig.value, schemas, initialData: initialDataMap }),
      autoSave: { docs: autoSaveEnabled.value, outputs: autoSyncOutputsEnabled.value },
      onStateChange: state => { saveState.value = state },
    })
    // A new session reports state only on the first change; align once here to avoid a stale save-error flag from the previous project
    saveState.value = session.coordinator.state

    // Load version/migration lists (metadata only, no full snapshots)
    await loadVersionsAndMigrations()
    const parts: string[] = []
    if (schemas.length > 0) parts.push(`${schemas.length} schema(s)`)
    if (commonConfig.value) parts.push('common.json')
    showToast(t('toast.opened', { summary: parts.join(' + ') }))
    return true
  }

  /** Open a local folder: start file observation after mounting (Git mode has no local files to observe) */
  async function _loadNewStructure(rootHandle: FileSystemDirectoryHandle): Promise<boolean> {
    const ok = await _mountWorkspace(new BrowserWorkspaceWriter(rootHandle), 'folder')
    if (ok) await _startFileObserver()
    return ok
  }

  /**
   * Legacy project upgrade: read old disk -> run the upgrader -> write the new structure -> clean up migrated old files -> load the new structure.
   * No rollback to the legacy structure is allowed after upgrading (fields added by the new structure would be lost); the migration scripts clean up the corresponding old files.
   */
  async function _migrateAndLoad(rootHandle: FileSystemDirectoryHandle): Promise<void> {
    // Read the root common.json for the version check
    let oldCommon: CommonConfig | null = null
    try {
      const commonText = await new BrowserWorkspaceWriter(rootHandle).read(COMMON_FILE)
      oldCommon = commonText === null ? null : JSON.parse(commonText)
    } catch {
      oldCommon = null
    }

    const versionResult = checkVersion(oldCommon)
    if (!versionResult.ok) {
      await alertDialog({ title: t('alertTitle'), message: versionResult.error ?? '' })
      return
    }
    if (!versionResult.needsUpgrade) {
      // No upgrade needed (should not happen in theory, since _openRootHandle already routes by version)
      await _loadNewStructure(rootHandle)
      return
    }

    console.log('[migrateAndLoad] upgrading structure', versionResult.fromVersion, '→', CURRENT_STRUCT_VERSION)

    // Run structure migrations version by version from the registry (laggards run 1.0->1.1, 1.1->1.2, ... in order)
    await runStructureMigrations(
      rootHandle,
      versionResult.fromVersion!,
      {
        transformTable: (_schema, table) =>
          buildSchemaExportData({ schema: _schema.schema, tables: [table] }).tables[0]!,
      },
      CURRENT_STRUCT_VERSION,
    )

    console.log('[migrateAndLoad] structure migrated to latest on disk')

    await _loadNewStructure(rootHandle)
  }

  // ===== Reload from Disk =====

  /** User entry: discard edits in the page and reload all data from the data source (unsaved changes go through the leave guard first) */
  async function reloadFromDisk() {
    if (gitRepo.value) {
      if (!(await confirmLeaveUnsaved())) return
      await _reloadGitRepo()
      return
    }
    if (!rootDirHandle.value) return
    if (!(await confirmLeaveUnsaved())) return
    await _reloadFromDisk()
  }

  let _reloading = false

  async function _reloadFromDisk() {
    const rootH = rootDirHandle.value
    if (!rootH) return

    _reloading = true
    _stopFileObserver()
    const closing = session
    session = null

    try {
      await closing?.coordinator.dispose()
      const ok = await _loadNewStructure(rootH)
      if (!ok) {
        // Version mismatch (disk structure version is newer/older than this editor supports):
        // reloading is equivalent to "close the project and open it again", so close and re-run the open flow,
        // letting _openRootHandle route naturally: legacy structure shows the upgrade dialog, too-new shows an editor upgrade hint.
        await closeProject(true)
        await _openRootHandle(rootH)
        return
      }
      showToast(t('toast.reloadedFromDisk'))
    } catch (e) {
      console.error('[reloadFromDisk] Failed:', e)
      showToast(t('toast.failedReloadFromDisk'))
    } finally {
      _reloading = false
    }
  }

  // ===== External file change detection (FileSystemObserver) =====
  let _fileObserver: FileSystemObserver | null = null
  let _observerSetup = false
  let _popupDebounceTimer: ReturnType<typeof setTimeout> | null = null

  /** Start FileSystemObserver to watch for file changes in the root directory */
  async function _startFileObserver() {
    if (_observerSetup) return
    _observerSetup = true

    if (typeof FileSystemObserver === 'undefined' || !rootDirHandle.value) {
      console.log('[FileSystemObserver] not supported in this browser, disk file change detection is not available')
      return
    }

    try {
      _fileObserver = new FileSystemObserver((records) => {
        if (_reloading || !projectOpened.value || !session) return

        // Only care about common.json and source documents under current/; ignore derived files such as output/
        const paths = [...new Set(records.map(r => r.relativePathComponents.join('/')))]
          .filter(path => path === COMMON_FILE || path.startsWith(`${CURRENT_DIR}/`))
        if (paths.length === 0) return
        // Ignore while our own write is in flight: the written content matches the baseline, so it is not an external change
        if (session.coordinator.state.saving) return
        console.log('[FileSystemObserver] relevant changes:', paths.join(', '))

        // Debounce: one external edit may fire multiple callbacks; show the dialog only once
        if (_popupDebounceTimer) clearTimeout(_popupDebounceTimer)
        _popupDebounceTimer = setTimeout(() => { void _handleExternalChanges(paths) }, 400)
      })

      // recursive: true ensures changes in subdirectories such as schemas/ are observed
      await _fileObserver.observe(rootDirHandle.value, { recursive: true })
      console.log('[FileSystemObserver] now observing root directory (recursive)')
    } catch (e) {
      console.warn('[FileSystemObserver] failed to observe:', e)
      _fileObserver = null
    }
  }

  /** Compare disk content with the save baseline and prompt to reload only when an external change is confirmed */
  async function _handleExternalChanges(paths: string[]) {
    const current = session
    if (_reloading || !projectOpened.value || !current) return
    if (current.coordinator.state.saving) return
    if (!(await current.hasExternalChanges(paths))) return

    if (hasUnsavedChanges.value) {
      // Changes on disk and in memory: decide whether to keep the in-memory changes first, then reload
      if (!(await confirmLeaveUnsaved())) return
      await _reloadFromDisk()
      return
    }
    const ok = await confirmDialog({
      title: t('confirm.title'),
      message: t('toast.diskFileChanged'),
      confirmText: t('confirm.ok'),
      cancelText: t('confirm.cancel'),
    })
    if (ok) await _reloadFromDisk()
  }

  /** Stop FileSystemObserver */
  function _stopFileObserver() {
    if (_fileObserver) {
      _fileObserver.disconnect()
      _fileObserver = null
    }
    _observerSetup = false
    if (_popupDebounceTimer) {
      clearTimeout(_popupDebounceTimer)
      _popupDebounceTimer = null
    }
  }

  // ===== Undo/Redo wiring =====

  /** Declare affected files after command execute/undo/redo; the workspace session persists them on demand */
  history.setPersistHook((files) => { markChanged(files) })

  /** Execute a command through the command manager (apply + push to stack + persist on demand) */
  function executeCommand(cmd: Command) {
    history.execute(cmd)
    refreshHistoryFlags()
  }

  /** Undo */
  function undo() {
    if (!history.canUndo) return
    history.undo()
    refreshHistoryFlags()
    showToast(t('toast.undo'))
  }

  /** Redo */
  function redo() {
    if (!history.canRedo) return
    history.redo()
    refreshHistoryFlags()
    showToast(t('toast.redo'))
  }

  // ===== Save =====

  /**
   * Declare the set of files touched by this change; the workspace session persists them incrementally.
   * With auto-save on, the coordinator writes only these files (and their derived SQL) after debouncing; with it off, they are only marked unsaved.
   */
  function markChanged(files: AffectedFile[]) {
    session?.changed(files)
  }

  /**
   * Manual save: write the in-memory project documents as a batch and rebuild every derived file (SQL under output/, AI guide).
   * So saving works even with no pending changes: it restores derived files that were deleted externally from disk.
   * In Git mode, first show the commit dialog to collect the commit message, then commit all changes at once after confirmation.
   */
  async function saveProject() {
    lastSaveCommitted = false
    if (!session) return
    if (gitRepo.value) {
      const staged = session.previewCommitChanges()
      if (staged.length === 0) {
        showToast(t('toast.noChange'))
        return
      }
      if (!(await requestCommitMessage(staged))) return
    }
    try {
      await session.saveAll()
      lastSaveCommitted = Boolean(gitRepo.value)
    } catch (e) {
      console.error('[saveProject] failed:', e)
      const message = e instanceof GitRepoError ? t(`gitRepo.openError.${e.code}`) : t('toast.failedSaveChanges')
      showToast(message)
    }
  }

  /** Save button click: report the result after saving (on failure/cancel saveProject already reported and the unsaved state is unchanged) */
  async function saveProjectWithFeedback() {
    if (!session) return
    await saveProject()
    if (hasUnsavedChanges.value) return
    if (gitRepo.value) {
      if (lastSaveCommitted) showToast(t('gitRepo.committed'))
    } else {
      showToast(t('toast.saved'))
    }
  }

  /** Only change state and preference, without touching the session; reused when the two switches affect each other */
  function writeAutoSavePref(enabled: boolean) {
    autoSaveEnabled.value = enabled
    writeBoolPref(AUTO_SAVE_PREF, enabled)
  }

  function writeAutoSyncOutputsPref(enabled: boolean) {
    autoSyncOutputsEnabled.value = enabled
    writeBoolPref(AUTO_SYNC_OUTPUTS_PREF, enabled)
  }

  /** Toggle "live-save project files": derived files depend on it, so turning it off also turns off "sync SQL" */
  function setAutoSave(enabled: boolean) {
    writeAutoSavePref(enabled)
    if (!enabled) writeAutoSyncOutputsPref(false)
    session?.coordinator.setAutoSave({ docs: enabled })
  }

  /** Toggle "sync SQL after changes": covers only derived files under output/, and turning it on also turns on project-file saving */
  function setAutoSyncOutputs(enabled: boolean) {
    writeAutoSyncOutputsPref(enabled)
    if (enabled) writeAutoSavePref(true)
    session?.coordinator.setAutoSave({ outputs: enabled })
  }

  /**
   * Leave guard: with unsaved changes, ask "save / discard / cancel".
   * Returns false when the user cancels or saving fails; callers (close project, switch folder, reload) should abort.
   */
  async function confirmLeaveUnsaved(): Promise<boolean> {
    if (!hasUnsavedChanges.value) return true
    const choice = await chooseDialog({
      title: t('confirm.title'),
      message: t('confirm.unsavedChanges'),
      confirmText: t('confirm.save'),
      secondaryText: t('confirm.discard'),
      cancelText: t('confirm.cancel'),
    })
    if (choice === 'cancel') return false
    if (choice === 'secondary') return true
    await saveProject()
    return !hasUnsavedChanges.value
  }

  /** User entry: handle unsaved changes before closing the project; returns false when the user cancels */
  async function requestCloseProject(silent = false): Promise<boolean> {
    if (!(await confirmLeaveUnsaved())) return false
    await closeProject(silent)
    return true
  }

  /** Toggle "generate AI guide": writes to common.json; the guide file is created or deleted with this change */
  function setGenerateAiGuide(enabled: boolean) {
    generateAiGuide.value = enabled
    saveGenerateAiGuide(commonConfig.value, enabled)
    markChanged([affectedCommon()])
  }

  // ===== Initial Data Actions (extracted) =====
  const {
    initialDataKey,
    addInitialData,
    currentInitialDataKey,
    currentInitialData,
    setInitialDataObject,
    deleteInitialData,
    addInitialDataRow,
    deleteInitialDataRow,
    moveInitialDataRow,
    clearInitialDataRows,
    setInitialDataRowSkip,
    setInitialDataFieldComment,
    setInitialDataCell,
    setInitialDataRowComment,
    setInitialDataCellExpr,
    setInitialDataInsertMode,
    setInitialDataPreSql,
    setInitialDataPostSql,
    clearInitialDataPrePostSql,
  } = createInitialDataActions({
    initialDataMap,
    initialDataDeletedKeys,
    schemas,
    currentSchema,
    currentTable,
    executeCommand,
    t,
  })

  // ===== CRUD Actions (extracted) =====
  const {
    syncSchemaOrder,
    moveSchema,
    addSchema,
    deleteSchema,
    copySchema,
    renameSchema,
    selectTable,
    selectSchemaOnly,
    selectSettingsTab,
    addTable,
    renameTable,
    deleteTable,
    copyTable,
    moveTable,
    moveTableToSchema,
    updateTable,
    isCommonField,
    getResolvedField,
    getResolvedFieldTypeForDb,
    getResolvedIndexNameForDb,
    fieldTypeDisplay,
    hasFieldOverrides,
    quoteDefaultForField,
    fieldKey,
    indexKey,
    toggleFieldExpand,
    toggleIndexExpand,
    commentBeforeTableText,
    setCommentBeforeTable,
    commentBeforeFieldText,
    setCommentBeforeField,
    openAddFieldModal,
    confirmAddField,
    directAddField,
    deleteField,
    updateFieldProp,
    updateFieldProps,
    updateFieldName,
    moveField,
    moveFieldUp,
    moveFieldDown,
    addIndex,
    deleteIndex,
    moveIndex,
    moveIndexUp,
    moveIndexDown,
    updateIndex,
    syncFieldNameInIndexes,
    indexColumnsText,
    setIndexColumns,
    getTableMysqlEngine,
    getTableMysqlCharset,
    getTableMysqlCollation,
    setTableMysqlEngine,
    setTableMysqlCharset,
    setTableMysqlCollation,
    getTablePartition,
    setTablePartition,
    setTablePreSql,
    setTablePostSql,
    setSchemaPreSql,
    setSchemaPostSql,
    getFieldOverrideValue,
    setFieldOverrideValue,
    setFieldCommentOptionsEnabled,
    addFieldCommentOption,
    updateFieldCommentOption,
    removeFieldCommentOption,
    getIndexOverrideValue,
    setIndexOverrideValue,
  } = createCrudActions({
    schemas,
    commonConfig,
    selectedSchemaIdx,
    selectedTableIdx,
    expandedFields,
    expandedIndexes,
    settingsTab,
    addFieldSchemaIdx,
    addFieldTableIdx,
    addFieldMode,
    newFieldName,
    newFieldSelectCommon,
    newFieldSelectCommons,
    newFieldUnifiedType,
    showAddFieldModal,
    initialDataMap,
    initialDataDeletedKeys,
    currentSchema,
    initialDataKey,
    executeCommand,
    showToast,
    t,
  })

  // ===== Common Config Actions (extracted) =====
  const {
    setGlobalPreSql,
    setGlobalPostSql,
    setProjectName,
    setProjectDescription,
    getCommonMysqlEngine,
    getCommonMysqlCharset,
    getCommonMysqlCollation,
    setCommonMysqlEngine,
    setCommonMysqlCharset,
    setCommonMysqlCollation,
    getCommonPostgresqlQuoteIdentifiers,
    setCommonPostgresqlQuoteIdentifiers,
    getCommonSqliteQuoteIdentifiers,
    setCommonSqliteQuoteIdentifiers,
    getTableDdlMode,
    setTableDdlMode,
    getLogicalDelete,
    setLogicalDelete,
    getCommonTypeCase,
    setCommonTypeCase,
    addCommonUsedField,
    deleteCommonUsedField,
    updateCommonUsedFieldName,
    updateCommonUsedField,
    setCommonUsedFieldOverrideValue,
    moveCommonUsedField,
    getOrderedCommonUsedFields,
    addUnifiedType,
    deleteUnifiedType,
    renameUnifiedType,
    updateUnifiedType,
    setUnifiedTypeMappingValue,
    moveUnifiedType,
  } = createCommonConfigActions({
    commonConfig,
    schemas,
    initialDataMap,
    executeCommand,
    showToast,
    t,
  })

  // ===== Import SQL (extracted) =====
  const {
    openImportSqlModal,
    parseImportSql,
    confirmImportSql,
  } = createImportSqlActions({
    showImportSqlModal,
    importSqlText,
    importSqlDialect,
    importSqlParsedTables,
    importSqlErrors,
    importSqlTargetMode,
    importSqlTargetSchemaIdx,
    importSqlNewSchemaName,
    importSqlDetectedSchema,
    importSqlTableNameEdits,
    commonConfig,
    schemas,
    selectedSchemaIdx,
    selectedTableIdx,
    syncSchemaOrder,
    executeCommand,
    showToast,
    t,
  })

  return {
    // State
    commonConfig,
    schemas,
    selectedSchemaIdx,
    selectedTableIdx,
    settingsTab,
    projectOpened,
    generateAiGuide,
    setGenerateAiGuide,
    toastMsg,
    toastVisible,
    showAddFieldModal,
    addFieldMode,
    newFieldName,
    newFieldSelectCommon,
    newFieldSelectCommons,
    newFieldUnifiedType,

    // Import SQL State
    showImportSqlModal,
    importSqlText,
    importSqlDialect,
    importSqlParsedTables,
    importSqlErrors,
    importSqlTargetMode,
    importSqlTargetSchemaIdx,
    importSqlNewSchemaName,
    importSqlDetectedSchema,
    importSqlTableNameEdits,

    // Computed
    currentSchema,
    currentTable,
    commonFieldNames,
    unifiedTypeNames,
    unifiedTypeMap,
    projectName,
    projectDescription,
    currentInitialDataKey,
    currentInitialData,

    // Enabled SQL dialects
    enabledDialects,
    isDialectEnabled,
    setDialectEnabled,

    // Project
    openProject,
    openProjectFromHandle,
    closeProject,
    requestCloseProject,
    reloadFromDisk,
    setProjectName,
    setProjectDescription,
    projectInfoTabRequest,
    openProjectInfoSettings,
    consumeProjectInfoTabRequest,
    overlayVisible,
    overlayText,
    confirmUpgradeStructure,
    cancelUpgradeStructure,

    // Git repository data source
    gitRepo,
    openGitRepoModal,
    showOpenGitModal,
    openGitRepository,
    commitDialogVisible,
    commitPendingChanges,
    commitMessage,
    confirmCommit,
    cancelCommit,

    // Saving: two independent switches for project files / derived SQL, unsaved state and manual full save
    autoSaveEnabled,
    setAutoSave,
    autoSyncOutputsEnabled,
    setAutoSyncOutputs,
    saveState,
    hasUnsavedChanges,
    saveProjectWithFeedback,
    confirmLeaveUnsaved,

    // Initial Data
    initialDataMap,
    initialDataKey,
    addInitialData,
    setInitialDataObject,
    deleteInitialData,
    addInitialDataRow,
    deleteInitialDataRow,
    moveInitialDataRow,
    clearInitialDataRows,
    setInitialDataRowSkip,
    setInitialDataFieldComment,
    setInitialDataCell,
    setInitialDataRowComment,
    setInitialDataCellExpr,

    setInitialDataInsertMode,

    // Initial Data Pre/Post SQL
    setInitialDataPreSql,
    setInitialDataPostSql,
    clearInitialDataPrePostSql,

    // Navigation
    selectTable,
    selectSchemaOnly,
    selectSettingsTab,

    // Schema CRUD
    addSchema,
    deleteSchema,
    copySchema,
    renameSchema,
    moveSchema,

    // Table CRUD
    addTable,
    deleteTable,
    copyTable,
    renameTable,
    moveTable,
    moveTableToSchema,
    updateTable,

    // Field Helpers
    isCommonField,
    getResolvedField,
    getResolvedFieldTypeForDb,
    getResolvedIndexNameForDb,
    fieldTypeDisplay,
    hasFieldOverrides,
    quoteDefaultForField,
    fieldKey,
    indexKey,
    toggleFieldExpand,
    toggleIndexExpand,
    expandedFields,
    expandedIndexes,

    // Comment editing
    commentBeforeTableText,
    setCommentBeforeTable,
    commentBeforeFieldText,
    setCommentBeforeField,

    // Field CRUD
    openAddFieldModal,
    confirmAddField,
    directAddField,
    deleteField,
    moveField,
    moveFieldUp,
    moveFieldDown,
    updateFieldProp,
    updateFieldProps,
    updateFieldName,

    // Undo/Redo
    undo,
    redo,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,

    // Index CRUD
    addIndex,
    deleteIndex,
    moveIndex,
    moveIndexUp,
    moveIndexDown,
    updateIndex,
    syncFieldNameInIndexes,
    indexColumnsText,
    setIndexColumns,

    // Table MySQL
    getTableMysqlEngine,
    getTableMysqlCharset,
    getTableMysqlCollation,
    setTableMysqlEngine,
    setTableMysqlCharset,
    setTableMysqlCollation,

    // Table Partition (per dialect)
    getTablePartition,
    setTablePartition,

    // Table Pre/Post SQL
    setTablePreSql,
    setTablePostSql,

    // Schema Pre/Post SQL
    setSchemaPreSql,
    setSchemaPostSql,

    // Field overrides
    getFieldOverrideValue,
    setFieldOverrideValue,
    setFieldCommentOptionsEnabled,
    addFieldCommentOption,
    updateFieldCommentOption,
    removeFieldCommentOption,

    // Index overrides
    getIndexOverrideValue,
    setIndexOverrideValue,

    // Common config
    getCommonMysqlEngine,
    getCommonMysqlCharset,
    getCommonMysqlCollation,
    setCommonMysqlEngine,
    setCommonMysqlCharset,
    setCommonMysqlCollation,
    getCommonPostgresqlQuoteIdentifiers,
    setCommonPostgresqlQuoteIdentifiers,
    getCommonSqliteQuoteIdentifiers,
    setCommonSqliteQuoteIdentifiers,
    getTableDdlMode,
    setTableDdlMode,
    getLogicalDelete,
    setLogicalDelete,
    getCommonTypeCase,
    setCommonTypeCase,

    // Global Pre/Post SQL
    setGlobalPreSql,
    setGlobalPostSql,

    // Common Used Fields CRUD
    addCommonUsedField,
    deleteCommonUsedField,
    updateCommonUsedFieldName,
    updateCommonUsedField,
    setCommonUsedFieldOverrideValue,
    moveCommonUsedField,
    getOrderedCommonUsedFields,

    // Unified Types CRUD
    addUnifiedType,
    deleteUnifiedType,
    renameUnifiedType,
    updateUnifiedType,
    setUnifiedTypeMappingValue,
    moveUnifiedType,

    // Import SQL
    openImportSqlModal,
    parseImportSql,
    confirmImportSql,

    // Toast
    showToast,

    // Versions / Migrations
    versions,
    hasVersions,
    versionChain,
    migrations,
    environments,
    selectedVersionSnapshot,
    versionPreviewLoading,
    loadVersionsAndMigrations,
    createVersion,
    renameVersion,
    deleteVersionById,
    getVersionSnapshot,
    previewVersionById,
    clearVersionPreview,
    computeDiff,
    suggestRenameEntries,
    createMigration,
    updateMigration,
    deleteMigrationById,
    previewMigrationDdl,
    createEnvironment,
    updateEnvironment,
    deleteEnvironmentById,
  }
})
