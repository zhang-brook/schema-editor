import { ref, reactive, computed } from 'vue'
import { defineStore } from 'pinia'
import { useI18n } from 'vue-i18n'
import type {
  CommonConfig,
  Schema,
  InitialData,
} from '@/types/schema'
import type { SettingsTab } from '@/types/settings'
import { isFileSystemAccessSupported, isNewStructure, isEmptyFolder } from '@/utils/file-helpers'
import { checkVersion } from '@/utils/structure-migrations/version-utils'
import { runStructureMigrations } from '@/utils/structure-migrations'
import {
  CommandManager,
  affectedCommon,
  type Command,
  type AffectedFile,
} from '@/core/history/command'
import { COMMON_FILE, CURRENT_DIR, CURRENT_STRUCT_VERSION } from '@/core/workspace/layout'
import { buildSchemaExportData } from '@/core/workspace/serialization'
import { BrowserWorkspaceWriter } from '@/core/workspace/browser-workspace'
import { createDefaultCommonConfig, createWorkspaceSession, loadWorkspaceDocuments, type SessionWriter, type WorkspaceSession } from '@/core/workspace/workspace-session'
import type { SaveState, StagedChange } from '@/core/workspace/save-coordinator'
import { GitRepoError, type GitRepoInfo } from '@/core/workspace/git/types'
import { normalizeSubdir, parseRepoUrl } from '@/core/workspace/git/url'
import { connectGitWorkspace } from '@/core/workspace/git/workspace'
import { readGitToken, storeGitToken } from '@/core/workspace/git/credentials'
import { jsonContent } from '@/core/workspace/project-documents'
import { loadGenerateAiGuide, saveGenerateAiGuide } from '@/utils/ai-guide'
import { ALL_SQL_DIALECTS, type SqlDialect } from '@/utils/sql-generator/shared'
import type { UnifiedTypeDefinition } from '@/types/schema'
import type { ParsedTable, ParseMessage } from '@/utils/sql-parser'
import { createInitialDataActions } from './editor-initial-data'
import { createVersionActions } from './editor-version'
import { buildVersionChain } from '@/core/version/chain'
import { createImportSqlActions } from './editor-import-sql'
import { createCommonConfigActions } from './editor-common-config'
import { createCrudActions } from './editor-crud'
import type {
  VersionSummary,
  VersionSnapshot,
  Migration,
  Environment,
} from '@/core/version/types'
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
  // ===== 项目设置（VSCode 风格：左侧 tab 切换） =====
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
  const rootDirHandle = ref<any>(null)
  const projectOpened = ref(false)

  // ===== Git 仓库模式：远端分支即数据源，无本地目录句柄 =====
  const gitRepo = ref<GitRepoInfo | null>(null)
  const showOpenGitModal = ref(false)
  const commitDialogVisible = ref(false)
  const commitPendingChanges = ref<StagedChange[]>([])
  const commitMessage = ref('')
  let commitResolve: ((confirmed: boolean) => void) | null = null

  // ===== 项目设置：是否在用户打开的文件夹中生成/更新 AI JSON 结构指南 =====
  // 该设置随项目保存到 common.json（commonConfig.generate_ai_guide），缺省为 false
  const generateAiGuide = ref<boolean>(false)

  // ===== 保存：改动经工作区会话增量落盘 =====
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
   * 实时保存项目文件（浏览器本地偏好，默认开启）。关闭后改动只留在内存，等用户点保存。
   * 派生文件（output/ 下的 SQL）由 autoSyncOutputsEnabled 控制，且依赖本项目文件开关。
   */
  const autoSaveEnabled = ref(readBoolPref(AUTO_SAVE_PREF, true))
  /** 变更后同步更新 SQL：未单独设置过时跟随「实时保存」，项目文件开关关闭时恒为关闭 */
  const autoSyncOutputsEnabled = ref(autoSaveEnabled.value && readBoolPref(AUTO_SYNC_OUTPUTS_PREF, autoSaveEnabled.value))
  const saveState = ref<SaveState>({ dirty: false, saving: false, error: null, pendingFiles: 0 })
  const hasUnsavedChanges = computed(() => saveState.value.dirty)
  let session: WorkspaceSession | null = null
  /** 最近一次保存是否真正产生了提交（Git 模式），供保存反馈选择文案 */
  let lastSaveCommitted = false

  // ===== Versions / Migrations =====
  const versions = ref<VersionSummary[]>([])
  const hasVersions = computed(() => versions.value.length > 0)
  const migrations = ref<Migration[]>([])
  const environments = ref<Environment[]>([])
  /** 版本链：按父子关系串成的时间轴，并标注相邻版本之间缺失的迁移 */
  const versionChain = computed(() => buildVersionChain(versions.value, migrations.value))

  // 版本预览状态
  const selectedVersionSnapshot = ref<VersionSnapshot | null>(null)
  const versionPreviewLoading = ref(false)

  // Initial Data —— 独立存储在 initial-data/<schema>/<table>.json
  const initialDataMap = reactive(new Map<string, InitialData>())
  const initialDataDeletedKeys = reactive(new Set<string>())

  // ===== Undo/Redo (命令模式) =====
  const history = new CommandManager()
  const canUndo = ref(false)
  const canRedo = ref(false)
  const undoLabel = ref<string | null>(null)
  const redoLabel = ref<string | null>(null)

  /** 同步 undo/redo 可用态到 UI */
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
  /** 用户修改后的表名，key 为 parsedTables 中的索引 */
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

  // ===== 项目信息（common.json）：名称展示在网页标题与顶部菜单栏 =====
  const projectName = computed(() => commonConfig.value?.project_name ?? '')
  const projectDescription = computed(() => commonConfig.value?.project_description ?? '')

  // 菜单栏标题点击后的一次性请求：打开「项目设置 → 项目信息」
  const projectInfoTabRequest = ref(false)

  function openProjectInfoSettings() {
    settingsTab.value = 'project'
    projectInfoTabRequest.value = true
  }

  /** 读取并清除一次性请求；ProjectConfigPage 挂载时调用，未请求则回退到「全局配置」 */
  function consumeProjectInfoTabRequest(): boolean {
    if (!projectInfoTabRequest.value) return false
    projectInfoTabRequest.value = false
    return true
  }

  // ===== 启用的 SQL 方言（项目级，存于 common.json.enabled_dialects） =====

  /** 当前启用且受支持的方言（按支持顺序）；未配置或为空时视为全部启用 */
  const enabledDialects = computed<SqlDialect[]>(() => {
    const list = commonConfig.value?.enabled_dialects
    if (!list || list.length === 0) return [...ALL_SQL_DIALECTS]
    return ALL_SQL_DIALECTS.filter(d => list.includes(d))
  })

  function isDialectEnabled(dialect: SqlDialect): boolean {
    return enabledDialects.value.includes(dialect)
  }

  /**
   * 切换方言启用状态：写入 common.json 并声明受影响文件。
   * 取消勾选会删除 output/ 下该方言已生成的 SQL（json 中的方言配置保留）；至少保留一种方言。
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

  /** 升级确认弹窗状态（打开旧结构项目时由用户手动触发迁移） */
  const pendingUpgradeRootHandle = ref<any>(null)
  /** 全局加载遮罩：升级旧结构 / 打开项目加载期间展示，全局唯一实例 */
  const overlayVisible = ref(false)
  const overlayText = ref('')

  function showOverlay(text: string) {
    overlayText.value = text
    overlayVisible.value = true
  }

  /** 需要在等待用户决策前撤下遮罩（遮罩语义是「加载中」），故单独抽出 */
  function hideOverlay() {
    overlayVisible.value = false
    overlayText.value = ''
  }

  /** 选择项目文件夹并加载内容，之后按自动保存设置增量落盘 */
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

  /** 接收拖入的文件夹 handle 直接打开项目（跳过目录选择器） */
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

  /** 统一打开入口：检测新/旧结构，新结构直接加载，旧结构弹升级窗 */
  async function _openRootHandle(rootHandle: FileSystemDirectoryHandle) {
    rootDirHandle.value = rootHandle

    const isNew = await isNewStructure(rootHandle)
    if (isNew) {
      await _loadNewStructure(rootHandle)
      return
    }

    // 空文件夹：视作全新项目，直接以新结构初始化（写入默认 common.json），不提示升级
    if (await isEmptyFolder(rootHandle)) {
      const writer = new BrowserWorkspaceWriter(rootHandle)
      await writer.save([{ path: COMMON_FILE, content: jsonContent(createDefaultCommonConfig()) }])
      await _loadNewStructure(rootHandle)
      return
    }

    // 旧结构：弹升级确认窗，未确认不加载（也不允许编辑）
    // 先撤下「正在打开项目」遮罩：等待用户决策不算加载中，且遮罩会压住确认弹窗
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

  /** 用户确认升级：迁移旧结构到新结构，然后加载 */
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

  /** 取消升级：关闭项目，返回空状态（不再保留旧结构打开态，不弹关闭提示） */
  function cancelUpgradeStructure() {
    pendingUpgradeRootHandle.value = null
    void closeProject(true)
  }

  // ===== Git 仓库数据源 =====

  /** 打开「打开 Git 仓库」弹窗 */
  function openGitRepoModal() {
    if (projectOpened.value) return
    showOpenGitModal.value = true
  }

  /** 把加载期的异常统一映射为带 code 的仓库错误（网络失败、文档缺失等） */
  function _asRepoError(error: unknown): GitRepoError {
    if (error instanceof GitRepoError) return error
    if (error instanceof TypeError) return new GitRepoError('network', error.message, error)
    return new GitRepoError('notProject', error instanceof Error ? error.message : String(error), error)
  }

  /**
   * 连接 Git 仓库并挂载为当前项目：解析地址 → 解析默认分支 → 建立文件快照 → 加载文档。
   * 失败抛 GitRepoError，由弹窗按 code 展示错误文案；返回 false 表示版本检查未通过。
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

  /** Git 模式重新加载：从远端重新拉取分支快照（未保存改动先经离开保护） */
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

  /** 提交弹窗：展示待提交文件并等待用户确认提交信息 */
  function requestCommitMessage(staged: StagedChange[]): Promise<boolean> {
    commitPendingChanges.value = staged
    commitMessage.value = t('commitDialog.defaultMessage', { n: staged.length })
    commitDialogVisible.value = true
    return new Promise(resolve => { commitResolve = resolve })
  }

  /** 提交弹窗：确认（信息为空时回退默认文案） */
  function confirmCommit() {
    const count = commitPendingChanges.value.length
    session?.setCommitMessage(commitMessage.value.trim() || t('commitDialog.defaultMessage', { n: count }))
    _closeCommitDialog(true)
  }

  /** 提交弹窗：取消本次提交 */
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

  /** 关闭当前项目文件夹，清空所有编辑状态。silent=true 时不弹「项目已关闭」提示（如取消升级场景） */
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

  /** 换项目或关闭时丢弃当前内存态；调用前必须已确认未保存改动 */
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
   * 加载并挂载工作区（本地文件夹与 Git 仓库共用）：
   * 一次性读出 common.json / database.json / 各 schema、table、initial-data 文档，
   * 用读到的原文建立保存基线，之后由工作区会话只写真正变化的文件。
   * 返回 false 表示版本检查未通过。
   */
  async function _mountWorkspace(writer: SessionWriter, source: 'folder' | 'git'): Promise<boolean> {
    const { project, files } = await loadWorkspaceDocuments(writer)

    const versionResult = checkVersion(project.common)
    if (!versionResult.ok) {
      await alertDialog({ title: t('alertTitle'), message: versionResult.error ?? '' })
      return false
    }
    if (versionResult.needsUpgrade) {
      // 旧结构升级仅支持本地文件夹（升级器依赖目录句柄）；Git 模式只能提示
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

    // 自动选中第一个 schema
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
    // 新会话只在首次变更时上报状态，这里先对齐一次，避免残留上一个项目的保存失败标记
    saveState.value = session.coordinator.state

    // 加载版本/迁移列表（只读元数据，不加载完整快照）
    await loadVersionsAndMigrations()
    const parts: string[] = []
    if (schemas.length > 0) parts.push(`${schemas.length} schema(s)`)
    if (commonConfig.value) parts.push('common.json')
    showToast(t('toast.opened', { summary: parts.join(' + ') }))
    return true
  }

  /** 打开本地文件夹：挂载后启动文件监听（Git 模式无本地文件可监听） */
  async function _loadNewStructure(rootHandle: FileSystemDirectoryHandle): Promise<boolean> {
    const ok = await _mountWorkspace(new BrowserWorkspaceWriter(rootHandle), 'folder')
    if (ok) await _startFileObserver()
    return ok
  }

  /**
   * 旧结构项目升级：读旧盘 → 经升级器处理 → 写新结构 → 清理已迁移的旧文件 → 加载新结构。
   * 升级后不允许回退旧结构（新结构新增字段回退会丢失），迁移脚本内部会清理对应的旧文件。
   */
  async function _migrateAndLoad(rootHandle: FileSystemDirectoryHandle): Promise<void> {
    // 读取根 common.json 用于版本判定
    let oldCommon: any = null
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
      // 无需升级（理论不会走到这里，因为 _openRootHandle 已按版本分流）
      await _loadNewStructure(rootHandle)
      return
    }

    console.log('[migrateAndLoad] upgrading structure', versionResult.fromVersion, '→', CURRENT_STRUCT_VERSION)

    // 按注册表逐版本执行结构迁移（落后者会依次跑 1.0→1.1、1.1→1.2……）
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

  /** 用户入口：放弃网页中的编辑，从数据源重新读取所有数据（未保存改动先经离开保护） */
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
        // 版本不匹配（磁盘结构版本高于/低于当前编辑器支持版本）：
        // 重新加载本质等价于「关闭项目后重新打开」，因此关闭后重新走打开流程，
        // 由 _openRootHandle 自然分流——旧结构弹升级窗、版本过高则提示升级编辑器。
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

  /** 启动 FileSystemObserver 监听根目录文件变化 */
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

        // 只关注 common.json 与 current/ 下的源文档，忽略 output/ 等派生文件
        const paths = [...new Set(records.map(r => r.relativePathComponents.join('/')))]
          .filter(path => path === COMMON_FILE || path.startsWith(`${CURRENT_DIR}/`))
        if (paths.length === 0) return
        // 自身写入尚未结束时忽略：写完后的内容与基线一致，不构成外部改动
        if (session.coordinator.state.saving) return
        console.log('[FileSystemObserver] relevant changes:', paths.join(', '))

        // 防抖：同一次外部修改可能触发多次回调，只弹一次窗
        if (_popupDebounceTimer) clearTimeout(_popupDebounceTimer)
        _popupDebounceTimer = setTimeout(() => { void _handleExternalChanges(paths) }, 400)
      })

      // recursive: true 确保监听 schemas/ 等子目录下的文件变更
      await _fileObserver.observe(rootDirHandle.value, { recursive: true })
      console.log('[FileSystemObserver] now observing root directory (recursive)')
    } catch (e) {
      console.warn('[FileSystemObserver] failed to observe:', e)
      _fileObserver = null
    }
  }

  /** 比对磁盘内容与保存基线，确认确有外部改动后再提示重新加载 */
  async function _handleExternalChanges(paths: string[]) {
    const current = session
    if (_reloading || !projectOpened.value || !current) return
    if (current.coordinator.state.saving) return
    if (!(await current.hasExternalChanges(paths))) return

    if (hasUnsavedChanges.value) {
      // 磁盘和内存同时有改动：先决定内存改动是否保留，再重新加载
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

  /** 停止 FileSystemObserver */
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

  // ===== Undo/Redo 接入 =====

  /** 命令执行/撤销/重做后声明受影响文件，由工作区会话按需落盘 */
  history.setPersistHook((files) => { markChanged(files) })

  /** 经命令管理器执行一个命令（apply + 入栈 + 按需写盘） */
  function executeCommand(cmd: Command) {
    history.execute(cmd)
    refreshHistoryFlags()
  }

  /** 撤销 */
  function undo() {
    if (!history.canUndo) return
    history.undo()
    refreshHistoryFlags()
    showToast(t('toast.undo'))
  }

  /** 重做 */
  function redo() {
    if (!history.canRedo) return
    history.redo()
    refreshHistoryFlags()
    showToast(t('toast.redo'))
  }

  // ===== Save =====

  /**
   * 声明本次改动涉及的文件集合，交由工作区会话增量落盘。
   * 自动保存开启时协调器防抖后只写这些文件（及其派生 SQL）；关闭时仅标记为未保存。
   */
  function markChanged(files: AffectedFile[]) {
    session?.changed(files)
  }

  /**
   * 手动保存：整批写出内存里的项目文档，并重建全部派生文件（output/ 下的 SQL、AI 指南）。
   * 因此即使当前没有改动也可以保存——磁盘上的派生文件被外部删除后，靠它恢复。
   * Git 模式先弹提交弹窗收集提交信息，确认后连同全部改动提交一次。
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

  /** 点击保存按钮：保存完成后提示结果（失败或取消时 saveProject 已提示，且未保存态保持不变） */
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

  /** 只改状态与偏好，不触碰会话；供两个开关互相连带时复用 */
  function writeAutoSavePref(enabled: boolean) {
    autoSaveEnabled.value = enabled
    writeBoolPref(AUTO_SAVE_PREF, enabled)
  }

  function writeAutoSyncOutputsPref(enabled: boolean) {
    autoSyncOutputsEnabled.value = enabled
    writeBoolPref(AUTO_SYNC_OUTPUTS_PREF, enabled)
  }

  /** 切换「实时保存项目文件」：派生文件依赖它，关闭时连带关闭「同步 SQL」 */
  function setAutoSave(enabled: boolean) {
    writeAutoSavePref(enabled)
    if (!enabled) writeAutoSyncOutputsPref(false)
    session?.coordinator.setAutoSave({ docs: enabled })
  }

  /** 切换「变更后同步更新 SQL」：只覆盖 output/ 下的派生文件，开启时连带开启项目文件保存 */
  function setAutoSyncOutputs(enabled: boolean) {
    writeAutoSyncOutputsPref(enabled)
    if (enabled) writeAutoSavePref(true)
    session?.coordinator.setAutoSave({ outputs: enabled })
  }

  /**
   * 离开保护：有未保存改动时询问「保存 / 不保存 / 取消」。
   * 返回 false 表示用户取消或保存失败，调用方（关闭项目、换目录、重新加载）应中止。
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

  /** 用户入口：关闭项目前先处理未保存改动；返回 false 表示用户取消 */
  async function requestCloseProject(silent = false): Promise<boolean> {
    if (!(await confirmLeaveUnsaved())) return false
    await closeProject(silent)
    return true
  }

  /** 切换「是否生成 AI 指南」开关：写入 common.json，指南文件随本次改动生成或删除 */
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

    // 启用的 SQL 方言
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

    // Git 仓库数据源
    gitRepo,
    openGitRepoModal,
    showOpenGitModal,
    openGitRepository,
    commitDialogVisible,
    commitPendingChanges,
    commitMessage,
    confirmCommit,
    cancelCommit,

    // 保存：项目文件 / 派生 SQL 两个独立开关、未保存态与手动全量保存
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

    // Table Partition（按方言）
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
