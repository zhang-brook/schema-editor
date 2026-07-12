import { ref, reactive, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { useI18n } from 'vue-i18n'
import type {
  CommonConfig,
  Schema,
  InitialData,
} from '@/types/schema'
import {
  isFileSystemAccessSupported,
  writeCommonToHandle,
  deleteSqlFromOutput,
  writeSqlToOutput,
  // ===== 新结构（current/）读写 =====
  openProjectFolderNew,
  isNewStructure,
  isEmptyFolder,
  writeDatabaseToHandle,
  writeSchemaJsonToHandle,
  writeTableToHandle,
  deleteTableDirFromHandle,
  deleteSchemaDirFromHandle,
  pruneTableDirsFromHandle,
} from '@/utils/file-helpers'
import {
  writeInitialDataToNewStructure,
  deleteInitialDataFromNewStructure,
} from '@/utils/initial-data-io'
import {
  generateSchemaMySQL,
  generateInitialDataAllMySQL,
} from '@/utils/sql-generator/mysql'
import {
  generateSchemaPostgreSQL,
  generateInitialDataAllPostgreSQL,
} from '@/utils/sql-generator/postgresql'
import { checkVersion } from '@/utils/structure-migrations/version-utils'
import { runStructureMigrations } from '@/utils/structure-migrations'
import {
  CommandManager,
  mergeAffectedFiles,
  type Command,
  type AffectedFile,
} from '@/core/history/command'
import { DEFAULT_UNIFIED_TYPES } from '@/utils/unified-types'
import { getCommonFileHandle, getCurrentDir } from '@/core/workspace/paths'
import { readJsonFile } from '@/core/workspace/handles'
import { COMMON_FILE, CURRENT_DIR, CURRENT_STRUCT_VERSION, sanitizeName } from '@/core/workspace/layout'
import {
  AI_GUIDE_FILE,
  loadGenerateAiGuide,
  saveGenerateAiGuide,
  generateAiGuideMarkdown,
} from '@/utils/ai-guide'
import { writeTextFile, removeEntry, getFileHandleSafe } from '@/core/workspace/handles'
import { fmtPrePostSql, getGlobalPostSql, getGlobalPreSql } from '@/utils/sql-generator/shared'
import type { SqlDialect } from '@/utils/sql-generator/shared'
import type { UnifiedTypeDefinition } from '@/types/schema'
import type { ParsedTable, ParseMessage } from '@/utils/sql-parser'
import { createInitialDataActions } from './editor-initial-data'
import { createVersionActions } from './editor-version'
import { createImportSqlActions } from './editor-import-sql'
import { createCommonConfigActions } from './editor-common-config'
import { createCrudActions } from './editor-crud'
import type {
  VersionSummary,
  VersionSnapshot,
  Migration,
} from '@/core/version/types'

export const useEditorStore = defineStore('editor', () => {
  const { t } = useI18n()

  // ===== State =====
  const commonConfig = ref<CommonConfig | null>(null)
  const schemas = reactive<Schema[]>([])
  const selectedSchemaIdx = ref(-1)
  const selectedTableIdx = ref(-1)
  const expandedFields = reactive(new Set<string>())
  const expandedIndexes = reactive(new Set<string>())
  const showCommonPanel = ref(false)
  // ===== 项目设置（VSCode 风格：左侧 tab 切换） =====
  const settingsTab = ref<'global' | 'structure' | 'version' | 'project'>('structure')
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
  const currentDirHandle = ref<any>(null)
  const projectOpened = ref(false)

  // ===== 项目设置：是否在用户打开的文件夹中生成/更新 AI JSON 结构指南 =====
  // 该设置随项目保存到 common.json（commonConfig.generate_ai_guide），缺省为 false
  const generateAiGuide = ref<boolean>(false)

  // ===== Versions / Migrations =====
  const versions = ref<VersionSummary[]>([])
  const hasVersions = computed(() => versions.value.length > 0)
  const migrations = ref<Migration[]>([])

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
  const showUpgradeModal = ref(false)
  const pendingUpgradeRootHandle = ref<any>(null)
  /** 全局加载遮罩：升级旧结构 / 打开项目加载期间展示，全局唯一实例 */
  const overlayVisible = ref(false)
  const overlayText = ref('')

  /** 选择项目文件夹并加载内容，之后所有编辑实时自动同步 */
  async function openProject() {
    if (!isFileSystemAccessSupported()) {
      // showToast(t('toast.browserNotSupported'))
      alert(t('toast.browserNotSupported'))
      return
    }
    try {
      const rootHandle: FileSystemDirectoryHandle = await window.showDirectoryPicker()
      overlayText.value = t('app.loadingOpenProject')
      overlayVisible.value = true
      await _openRootHandle(rootHandle)
    } catch {
      // User cancelled the directory picker — do nothing
    } finally {
      overlayVisible.value = false
    }
  }

  /** 接收拖入的文件夹 handle 直接打开项目（跳过目录选择器） */
  async function openProjectFromHandle(handle: FileSystemDirectoryHandle) {
    if (!isFileSystemAccessSupported()) {
      alert(t('toast.browserNotSupported'))
      return
    }
    try {
      overlayText.value = t('app.loadingOpenProject')
      overlayVisible.value = true
      await _openRootHandle(handle)
    } catch (e) {
      console.error('[openProjectFromHandle] Failed:', e)
      showToast(t('toast.dropNotSupported'))
    } finally {
      overlayVisible.value = false
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
      const defaultCommon = _createDefaultCommonConfig()
      await writeCommonToHandle(rootHandle, defaultCommon)
      await _loadNewStructure(rootHandle)
      return
    }

    // 旧结构：弹升级确认窗，未确认不加载（也不允许编辑）
    pendingUpgradeRootHandle.value = rootHandle
    showUpgradeModal.value = true
  }

  /** 用户确认升级：迁移旧结构到新结构，然后加载 */
  async function confirmUpgradeStructure() {
    const rootHandle = pendingUpgradeRootHandle.value
    if (!rootHandle) return
    showUpgradeModal.value = false
    pendingUpgradeRootHandle.value = null
    overlayText.value = t('upgrade.loading')
    overlayVisible.value = true
    try {
      await _migrateAndLoad(rootHandle)
    } catch (e) {
      console.error('[confirmUpgradeStructure] migration failed:', e)
      showToast(t('toast.upgradeFailed'))
    } finally {
      overlayVisible.value = false
    }
  }

  /** 取消升级：关闭项目，返回空状态（不再保留旧结构打开态，不弹关闭提示） */
  function cancelUpgradeStructure() {
    showUpgradeModal.value = false
    pendingUpgradeRootHandle.value = null
    closeProject(true)
  }

  // ===== Close Project =====

  /** 关闭当前项目文件夹，清空所有编辑状态。silent=true 时不弹「项目已关闭」提示（如取消升级场景） */
  function closeProject(silent = false) {
    _stopFileObserver()
    rootDirHandle.value = null
    currentDirHandle.value = null
    projectOpened.value = false
    commonConfig.value = null
    generateAiGuide.value = false
    schemas.length = 0
    initialDataMap.clear()
    initialDataDeletedKeys.clear()
    versions.value = []
    migrations.value = []
    selectedSchemaIdx.value = -1
    selectedTableIdx.value = -1
    showCommonPanel.value = false
    settingsTab.value = 'structure'
    expandedFields.clear()
    expandedIndexes.clear()
    if (_syncTimer) {
      clearTimeout(_syncTimer)
      _syncTimer = null
    }
    _autoSyncSetup = false
    history.clear()
    refreshHistoryFlags()
    if (!silent) showToast(t('toast.projectClosed'))
  }

  // ===== Versions / Migrations (extracted) =====
  const {
    loadVersionsAndMigrations,
    ensureIdsForCurrent,
    createVersion,
    deleteVersionById,
    getVersionSnapshot,
    previewVersionById,
    clearVersionPreview,
    computeDiff,
    createMigration,
    updateMigration,
    deleteMigrationById,
    previewMigrationDdl,
  } = createVersionActions({
    rootDirHandle,
    versions,
    migrations,
    versionPreviewLoading,
    selectedVersionSnapshot,
    commonConfig,
    schemas,
    initialDataMap,
    syncAllToDisk,
    showToast,
    t,
  })

  // ===== Load New Structure (current/) =====

  /** 构造默认根 common.json（新结构） */
  function _createDefaultCommonConfig(): any {
    return {
      struct_version: CURRENT_STRUCT_VERSION,
      default_config: {
        mysql: {
          database: {},
          table: {
            mysql_engine: 'InnoDB',
            mysql_charset: 'utf8mb4',
            mysql_collation: 'utf8mb4_0900_ai_ci',
          }
        },
        postgresql: {
          quote_identifiers: true,
        }
      },
      common_used_fields: {},
      type_case: 'keep',
      generate_ai_guide: false,
    }
  }

  /**
   * 加载新结构项目：从 current/database.json + 各 table.json + 各 initial-data.json 还原内存态。
   * 同时完成 projectOpened / toast / auto-sync / observer 的收尾。
   * 返回 false 表示版本检查未通过。
   */
  async function _loadNewStructure(rootHandle: FileSystemDirectoryHandle): Promise<boolean> {
    const newProj = await openProjectFolderNew(rootHandle)
    currentDirHandle.value = await getCurrentDir(rootHandle)

    // 清空内存状态
    commonConfig.value = null
    schemas.length = 0
    initialDataMap.clear()
    initialDataDeletedKeys.clear()
    selectedSchemaIdx.value = -1
    selectedTableIdx.value = -1
    showCommonPanel.value = false
    expandedFields.clear()
    expandedIndexes.clear()

    // 加载根 common.json（与版本无关的配置）
    let common: any = null
    try {
      const commonHandle = await getCommonFileHandle(rootHandle, false)
      const data = await readJsonFile(commonHandle) as any
      if (data?.default_config && data?.common_used_fields) {
        if (!data.default_config.postgresql) {
          data.default_config.postgresql = { quote_identifiers: true }
        }
        common = data
      }
    } catch {
      common = null
    }
    if (!common) common = _createDefaultCommonConfig()
    commonConfig.value = common
    // 从 common.json 恢复 AI 指南开关（缺省 true）
    generateAiGuide.value = loadGenerateAiGuide(commonConfig.value)

    // commonConfig.value 已确定非 null，使用本地常量避免 TS 窄化失败
    const cc = commonConfig.value!

    // 版本检查
    const versionResult = checkVersion(cc)
    if (!versionResult.ok) {
      alert(versionResult.error)
      return false
    }
    if (versionResult.needsUpgrade) {
      return false
    }

    // 加载 schema_order 与各表定义
    cc.schema_order = newProj.databaseData?.schema_order
    for (const s of newProj.schemas) {
      schemas.push({ schema: s.schema, tables: s.tables } as Schema)
    }
    applySchemaOrder()

    // 初始化 unified_types（若缺失或为空，则填充内置默认集）
    if (!cc.unified_types || cc.unified_types.length === 0) {
      cc.unified_types = JSON.parse(JSON.stringify(DEFAULT_UNIFIED_TYPES))
    }

    // 加载 initial-data（行内化在各 table 目录）
    for (const { key, data } of newProj.initialData) {
      initialDataMap.set(key, data)
    }

    // 补齐磁盘上已有对象缺失的 id（无论是否已创建版本，保证全部带 id 以跨版本识别）
    if (ensureIdsForCurrent()) {
      await syncAllToDisk()
    }

    // 自动选中第一个 schema
    if (schemas.length > 0) {
      selectedSchemaIdx.value = 0
      selectedTableIdx.value = schemas[0]!.tables.length > 0 ? 0 : -1
    }

    projectOpened.value = true
    // 打开项目后确保 AI 指南按需生成（空文件夹未触发任何写盘时也要生成）
    await syncAiGuideToDisk()
    // 打开项目后默认选中「库结构设计」tab
    settingsTab.value = 'structure'
    showCommonPanel.value = false
    // 加载版本/迁移列表（只读元数据，不加载完整快照）
    await loadVersionsAndMigrations()
    const parts: string[] = []
    if (schemas.length > 0) parts.push(`${schemas.length} schema(s)`)
    if (commonConfig.value) parts.push('common.json')
    showToast(t('toast.opened', { summary: parts.join(' + ') }))

    setupAutoSync()
    await _startFileObserver()
    return true
  }

  /**
   * 旧结构项目升级：读旧盘 → 经升级器处理 → 写新结构 → 清理已迁移的旧文件 → 加载新结构。
   * 升级后不允许回退旧结构（新结构新增字段回退会丢失），迁移脚本内部会清理对应的旧文件。
   */
  async function _migrateAndLoad(rootHandle: FileSystemDirectoryHandle): Promise<void> {
    // 读取根 common.json 用于版本判定
    let oldCommon: any = null
    try {
      const commonHandle = await getCommonFileHandle(rootHandle, false)
      oldCommon = await readJsonFile(commonHandle)
    } catch {
      oldCommon = null
    }

    const versionResult = checkVersion(oldCommon)
    if (!versionResult.ok) {
      alert(versionResult.error)
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

  /** 放弃网页中的编辑，从本地文件重新读取所有数据 */
  async function reloadFromDisk() {
    if (!rootDirHandle.value || !currentDirHandle.value) return

    const rootH = rootDirHandle.value

    _enterWriteScope()
    _reloading = true
    if (_syncTimer) {
      clearTimeout(_syncTimer)
      _syncTimer = null
    }

    try {
      const ok = await _loadNewStructure(rootH)
      if (!ok) {
        // 版本不匹配（磁盘结构版本高于/低于当前编辑器支持版本）：
        // 重新加载本质等价于「关闭项目后重新打开」，因此关闭后重新走打开流程，
        // 由 _openRootHandle 自然分流——旧结构弹升级窗、版本过高则提示升级编辑器。
        closeProject(true)
        await _openRootHandle(rootH)
        return
      }
      showToast(t('toast.reloadedFromDisk'))
    } catch (e) {
      console.error('[reloadFromDisk] Failed:', e)
      showToast(t('toast.failedReloadFromDisk'))
    } finally {
      _reloading = false
      _leaveWriteScope()
    }
  }

  // ===== External file change detection (FileSystemObserver) =====
  let _fileObserver: FileSystemObserver | null = null
  let _observerSetup = false
  let _writeDepth = 0
  let _popupDebounceTimer: ReturnType<typeof setTimeout> | null = null

  /** 进入写保护作用域：observer 检查此计数器，大于 0 时忽略所有文件变更事件 */
  function _enterWriteScope() {
    _writeDepth++
  }

  /** 离开写保护作用域 */
  function _leaveWriteScope() {
    if (_writeDepth > 0) _writeDepth--
  }

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
        if (_reloading || !projectOpened.value || !rootDirHandle.value) return
        // 自身写入期间忽略所有文件变更
        if (_writeDepth > 0) return

        // 只关注 common.json 与新结构 current/ 下的文件，忽略 output/ 等
        const relevantRecords = records.filter(r => {
          const path = r.relativePathComponents.join('/')
          return path === COMMON_FILE || path.startsWith(`${CURRENT_DIR}/`)
        })
        if (relevantRecords.length === 0) return

        const changedNames = relevantRecords.map(r => r.relativePathComponents.join('/'))
        console.log('[FileSystemObserver] relevant changes:', changedNames.join(', '))

        // 防抖：同一次外部修改可能触发多次回调，只弹一次窗
        if (_popupDebounceTimer) clearTimeout(_popupDebounceTimer)
        _popupDebounceTimer = setTimeout(() => {
          if (_writeDepth > 0 || _reloading || !projectOpened.value) return
          if (confirm(t('toast.diskFileChanged'))) {
            reloadFromDisk()
          }
        }, 400)
      })

      // recursive: true 确保监听 schemas/ 等子目录下的文件变更
      await _fileObserver.observe(rootDirHandle.value, { recursive: true })
      console.log('[FileSystemObserver] now observing root directory (recursive)')
    } catch (e) {
      console.warn('[FileSystemObserver] failed to observe:', e)
      _fileObserver = null
    }
  }

  /** 停止 FileSystemObserver */
  function _stopFileObserver() {
    if (_fileObserver) {
      _fileObserver.disconnect()
      _fileObserver = null
    }
    _observerSetup = false
    _writeDepth = 0
    if (_popupDebounceTimer) {
      clearTimeout(_popupDebounceTimer)
      _popupDebounceTimer = null
    }
  }

  // ===== Undo/Redo 接入 & 按需写盘 =====

  /** 注入命令写盘回调：命令执行/undo/redo 后只写受影响文件 */
  history.setPersistHook((files) => {
    void persistAffectedFiles(files)
  })

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

  /**
   * 按需写盘：仅对命令声明的受影响文件集合写盘，不再全量遍历所有 schema。
   * SQL 因暂无部分更新能力，仍全量重新生成并写 output/（行为保持与重构前一致）。
   */
  async function persistAffectedFiles(files: AffectedFile[]) {
    if (!rootDirHandle.value || !currentDirHandle.value) return
    const merged = mergeAffectedFiles(files)
    const needSql = merged.some(f => f.kind === 'sql')

    _enterWriteScope()
    try {
      // common / database 仅当相关命令时写
      if (merged.some(f => f.kind === 'common')) {
        const commonToWrite: any = { ...commonConfig.value }
        delete commonToWrite.schema_order
        await writeCommonToHandle(rootDirHandle.value, commonToWrite)
      }
      if (merged.some(f => f.kind === 'database')) {
        await writeDatabaseToHandle(rootDirHandle.value, {
          schema_order: commonConfig.value?.schema_order ?? schemas.map(s => s.schema),
        })
      }

      // schema 级：写 schema.json（含表顺序）+ 清理失效表目录；schema 已删除则清理整个目录
      for (const f of merged.filter(x => x.kind === 'schema')) {
        const schema = schemas.find(s => s.schema === f.schema)
        if (schema) {
          const tableNames = schema.tables.map(t => t.name)
          await pruneTableDirsFromHandle(rootDirHandle.value, schema.schema, tableNames)
          await writeSchemaJsonToHandle(rootDirHandle.value, schema.schema, {
            schema: schema.schema,
            table_order: tableNames,
          })
          // 重命名 schema：清理旧名目录（旧名经 sanitize 不同于新名时）
          if (f.oldSchema && sanitizeName(f.oldSchema) !== sanitizeName(schema.schema)) {
            await deleteSchemaDirFromHandle(rootDirHandle.value, f.oldSchema)
          }
        } else if (rootDirHandle.value && f.schema) {
          // schema 已从内存移除：清理整个 schema 目录 + 其 initial-data + SQL output
          await deleteSchemaDirFromHandle(rootDirHandle.value, f.schema)
          for (const key of [...initialDataDeletedKeys]) {
            if (key.startsWith(`${f.schema}/`)) {
              const sep = key.indexOf('/')
              const tableName = key.substring(sep + 1)
              await deleteInitialDataFromNewStructure(rootDirHandle.value, f.schema, tableName)
              initialDataDeletedKeys.delete(key)
            }
          }
          try {
            await deleteSqlFromOutput(rootDirHandle.value, 'mysql', `${f.schema}.sql`)
          } catch { /* 忽略 */ }
          try {
            await deleteSqlFromOutput(rootDirHandle.value, 'postgresql', `${f.schema}.sql`)
          } catch { /* 忽略 */ }
        }
      }

      // table 级：表存在则写 table.json；表已被删除（如 undo 后的重做）则清理磁盘目录
      for (const f of merged.filter(x => x.kind === 'table')) {
        const schema = schemas.find(s => s.schema === f.schema)
        const table = schema?.tables.find(tb => tb.name === f.table)
        if (table) {
          await writeTableToHandle(rootDirHandle.value, schema!.schema, buildTableExportData(table))
        } else if (rootDirHandle.value && f.schema && f.table) {
          // 表已从内存移除（删除命令生效）：清理磁盘对应目录 + initial-data + SQL output
          await deleteTableDirFromHandle(rootDirHandle.value, f.schema, f.table)
          await deleteInitialDataFromNewStructure(rootDirHandle.value, f.schema, f.table)
          try {
            await deleteSqlFromOutput(rootDirHandle.value, 'mysql', `${f.schema}.sql`)
          } catch { /* 忽略 */ }
          try {
            await deleteSqlFromOutput(rootDirHandle.value, 'postgresql', `${f.schema}.sql`)
          } catch { /* 忽略 */ }
        }
      }

      // initial-data 级：写对应 initial-data.json + 清理已标记删除的文件
      for (const f of merged.filter(x => x.kind === 'initial-data')) {
        const key = initialDataKey(f.schema!, f.table!)
        const data = initialDataMap.get(key)
        if (data) {
          await writeInitialDataToNewStructure(rootDirHandle.value, f.schema!, f.table!, data)
        }
      }
      for (const key of initialDataDeletedKeys) {
        const sep = key.indexOf('/')
        const schemaName = key.substring(0, sep)
        const tableName = key.substring(sep + 1)
        await deleteInitialDataFromNewStructure(rootDirHandle.value, schemaName, tableName)
      }
      initialDataDeletedKeys.clear()

      // SQL：全量重新生成并写 output/（保持与重构前一致）
      if (needSql) {
        await syncSqlToOutput()
      }
    } catch (e) {
      console.error('[persistAffectedFiles] failed:', e)
      showToast(t('toast.failedSaveChanges'))
    } finally {
      _leaveWriteScope()
    }
    // 标记命令写盘完成，抑制随后 watcher 触发的全量写（避免双写）
    _lastCommandPersist = Date.now()
  }

  // ===== Auto-sync (实时同步到本地文件) =====

  let _syncTimer: ReturnType<typeof setTimeout> | null = null
  let _autoSyncSetup = false
  let _reloading = false

  /** 命令写盘时间戳：命令执行后会经 persistAffectedFiles 按需写盘，
   *  此时抑制短时间内 watcher 触发全量写盘，避免双写与性能回归。 */
  let _lastCommandPersist = 0

  function debouncedSync(delay = 400) {
    if (_reloading) return
    if (_syncTimer) clearTimeout(_syncTimer)
    _syncTimer = setTimeout(() => {
      // 命令刚按需写盘，跳过本次全量写，避免双写
      if (Date.now() - _lastCommandPersist < 800) return
      void syncAllToDisk()
    }, delay)
  }

  async function syncAllToDisk() {
    if (!rootDirHandle.value || !currentDirHandle.value) return
    _enterWriteScope()
    try {
      if (commonConfig.value) {
        // 根 common.json：不再携带 schema_order（已迁入 current/database.json）
        const commonToWrite: any = { ...commonConfig.value }
        delete commonToWrite.schema_order
        await writeCommonToHandle(rootDirHandle.value, commonToWrite)
        // current/database.json：schema 排序
        await writeDatabaseToHandle(rootDirHandle.value, {
          schema_order: commonConfig.value.schema_order ?? schemas.map(s => s.schema),
        })
      }
      // 每 schema 目录 + 每表目录
      for (const schema of schemas) {
        const tableNames = schema.tables.map(t => t.name)
        // 先清理磁盘上已失效的旧表目录（如改名后残留的旧 table.json 目录），避免脏数据累积
        await pruneTableDirsFromHandle(rootDirHandle.value, schema.schema, tableNames)
        const tableOrder = tableNames
        await writeSchemaJsonToHandle(rootDirHandle.value, schema.schema, {
          schema: schema.schema,
          table_order: tableOrder,
        })
        for (const table of schema.tables) {
          await writeTableToHandle(rootDirHandle.value, schema.schema, buildTableExportData(table))
        }
      }
      // 同时生成 SQL 到 output 目录
      await syncSqlToOutput()
      // 同步 initial-data 文件
      await syncInitialDataToDisk()
      // 同步 AI JSON 结构指南（生成/更新或删除，取决于全局开关）
      await syncAiGuideToDisk()
    } catch (e) {
      console.error('Auto-sync failed:', e)
      showToast(t('toast.failedSaveChanges'))
    } finally {
      _leaveWriteScope()
    }
  }

  /**
   * 同步 AI JSON 结构指南到用户打开的文件夹根目录：
   * - 开关开启 → 写入/更新 AI_JSON_STRUCTURE_GUIDE.md
   * - 开关关闭 → 删除该文件（若存在）
   * 失败（如权限不足）静默忽略，不影响正常保存。
   */
  async function syncAiGuideToDisk() {
    if (!rootDirHandle.value) return
    if (generateAiGuide.value) {
      try {
        const handle = await getFileHandleSafe(rootDirHandle.value, AI_GUIDE_FILE)
        await writeTextFile(handle, generateAiGuideMarkdown())
      } catch (e) {
        console.warn('[syncAiGuideToDisk] failed to write guide:', e)
      }
    } else {
      try {
        await removeEntry(rootDirHandle.value, AI_GUIDE_FILE)
      } catch {
        // 文件不存在，静默忽略
      }
    }
  }

  /** 切换「是否生成 AI 指南」开关，写入 common.json 并立即同步文件状态 */
  async function setGenerateAiGuide(enabled: boolean) {
    generateAiGuide.value = enabled
    saveGenerateAiGuide(commonConfig.value, enabled)
    if (projectOpened.value) {
      // 立即写盘（common.json 含该开关），随后同步指南文件
      await syncAllToDisk()
    }
  }

  /** 生成 MySQL/PostgreSQL SQL 并写入 output/<dialect>/<schema>.sql */
  async function syncSqlToOutput() {
    if (!rootDirHandle.value) return
    try {
      const allMysql: { name: string; sql: string }[] = []
      const allPostgresql: { name: string; sql: string }[] = []

      // 生成每个 Schema 的建表 SQL
      for (const schema of schemas) {
        const mysqlSql = generateSchemaMySQL(schema, commonConfig.value)
        await writeSqlToOutput(rootDirHandle.value, 'mysql', `${schema.schema}.sql`, mysqlSql)
        allMysql.push({ name: schema.schema, sql: mysqlSql })

        const postgresqlSql = generateSchemaPostgreSQL(schema, commonConfig.value)
        await writeSqlToOutput(rootDirHandle.value, 'postgresql', `${schema.schema}.sql`, postgresqlSql)
        allPostgresql.push({ name: schema.schema, sql: postgresqlSql })
      }

      // 生成包含所有 schema 的汇总文件（按 schema_order 顺序排列）
      if (allMysql.length > 0) {
        // 全局前/后置 SQL
        const globalPreSql = getGlobalPreSql(commonConfig.value, 'mysql')
        const globalPostSql = getGlobalPostSql(commonConfig.value, 'mysql')

        const finalAllSchemaMySQL = [
          globalPreSql ? fmtPrePostSql(globalPreSql) + '\n' : '',
          allMysql.map(s => s.sql).join('\n\n'),
          globalPostSql ? fmtPrePostSql(globalPostSql) + '\n' : '',
        ].join('')
        await writeSqlToOutput(rootDirHandle.value, 'mysql', '__all_schemas__.sql', finalAllSchemaMySQL)
      }
      if (allPostgresql.length > 0) {
        // 全局前/后置 SQL
        const globalPreSql = getGlobalPreSql(commonConfig.value, 'postgresql')
        const globalPostSql = getGlobalPostSql(commonConfig.value, 'postgresql')

        const finalAllSchemaPostgreSQL = [
          globalPreSql ? fmtPrePostSql(globalPreSql) + '\n' : '',
          allPostgresql.map(s => s.sql).join('\n\n'),
          globalPostSql ? fmtPrePostSql(globalPostSql) + '\n' : '',
        ].join('')
        await writeSqlToOutput(rootDirHandle.value, 'postgresql', '__all_schemas__.sql', finalAllSchemaPostgreSQL)
      }

      // 生成 Initial Data 的 INSERT 语句汇总文件
      const initialDataMysql = generateInitialDataAllMySQL(schemas, initialDataMap, commonConfig.value)
      if (initialDataMysql.trim()) {
        await writeSqlToOutput(rootDirHandle.value, 'mysql', '__initial_data__.sql', initialDataMysql)
      }
      const initialDataPostgresql = generateInitialDataAllPostgreSQL(schemas, initialDataMap, commonConfig.value)
      if (initialDataPostgresql.trim()) {
        await writeSqlToOutput(rootDirHandle.value, 'postgresql', '__initial_data__.sql', initialDataPostgresql)
      }
    } catch (e) {
      console.error('SQL output sync failed:', e)
    }
  }

  /** 将初始数据同步到 initial-data/<schema>/<table>.json */
  async function syncInitialDataToDisk() {
    if (!rootDirHandle.value) return
    try {
      // 写入所有有数据的条目（行内化到各 table 目录）
      for (const [key, initialData] of initialDataMap.entries()) {
        const sep = key.indexOf('/')
        const schemaName = key.substring(0, sep)
        const tableName = key.substring(sep + 1)
        await writeInitialDataToNewStructure(rootDirHandle.value, schemaName, tableName, initialData)
      }

      // 删除标记为已删除的文件
      for (const key of initialDataDeletedKeys) {
        const sep = key.indexOf('/')
        const schemaName = key.substring(0, sep)
        const tableName = key.substring(sep + 1)
        await deleteInitialDataFromNewStructure(rootDirHandle.value, schemaName, tableName)
      }
      initialDataDeletedKeys.clear()
    } catch (e) {
      console.error('Initial data sync failed:', e)
    }
  }

  function setupAutoSync() {
    if (_autoSyncSetup) return
    _autoSyncSetup = true

    watch(commonConfig, () => {
      if (projectOpened.value) debouncedSync()
    }, { deep: true })

    watch(schemas, () => {
      if (projectOpened.value) debouncedSync()
    }, { deep: true })

    watch(initialDataMap, () => {
      if (projectOpened.value) debouncedSync()
    }, { deep: true })
  }

  // ===== Initial Data Actions (extracted) =====
  const {
    initialDataKey,
    findInitialDataOwner,
    currentInitialDataKey,
    currentInitialData,
    setInitialDataObject,
    deleteInitialData,
    setInitialDataRowSkip,
    setInitialDataFieldComment,
    setInitialDataCell,
    setInitialDataRowComment,
    setInitialDataPreSql,
    setInitialDataPostSql,
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
    applySchemaOrder,
    moveSchema,
    addSchema,
    deleteSchema,
    renameSchema,
    selectTable,
    selectCommonConfig,
    selectSchemaOnly,
    selectSettingsTab,
    addTable,
    renameTable,
    deleteTable,
    moveTable,
    moveTableToSchema,
    isCommonField,
    getResolvedField,
    getResolvedFieldTypeForDb,
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
    currentSchemaName,
    currentSchemaNameOfField,
    updateFieldProp,
    updateFieldProps,
    updateFieldName,
    moveFieldUp,
    moveFieldDown,
    addIndex,
    deleteIndex,
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
    getIndexOverrideValue,
    setIndexOverrideValue,
    buildTableExportData,
    buildSchemaExportData,
  } = createCrudActions({
    schemas,
    commonConfig,
    selectedSchemaIdx,
    selectedTableIdx,
    expandedFields,
    expandedIndexes,
    showCommonPanel,
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
    getCommonMysqlEngine,
    getCommonMysqlCharset,
    getCommonMysqlCollation,
    setCommonMysqlEngine,
    setCommonMysqlCharset,
    setCommonMysqlCollation,
    getCommonPostgresqlQuoteIdentifiers,
    setCommonPostgresqlQuoteIdentifiers,
    getTableDdlMode,
    setTableDdlMode,
    getCommonTypeCase,
    setCommonTypeCase,
    addCommonUsedField,
    deleteCommonUsedField,
    updateCommonUsedFieldName,
    rebuildCommonUsedFieldsFromArray,
    getOrderedCommonUsedFields,
    addUnifiedType,
    deleteUnifiedType,
    renameUnifiedType,
    rebuildUnifiedTypesFromArray,
  } = createCommonConfigActions({
    commonConfig,
    schemas,
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
    syncAllToDisk,
    showToast,
    t,
  })

  return {
    // State
    commonConfig,
    schemas,
    selectedSchemaIdx,
    selectedTableIdx,
    showCommonPanel,
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
    currentInitialDataKey,
    currentInitialData,

    // Project
    openProject,
    openProjectFromHandle,
    closeProject,
    reloadFromDisk,
    syncAllToDisk,
    showUpgradeModal,
    overlayVisible,
    overlayText,
    confirmUpgradeStructure,
    cancelUpgradeStructure,

    // Initial Data
    initialDataMap,
    initialDataKey,
    setInitialDataObject,
    deleteInitialData,
    setInitialDataRowSkip,
    setInitialDataFieldComment,
    setInitialDataCell,
    setInitialDataRowComment,

    // Initial Data Pre/Post SQL
    setInitialDataPreSql,
    setInitialDataPostSql,

    // Navigation
    selectTable,
    selectCommonConfig,
    selectSchemaOnly,
    selectSettingsTab,

    // Schema CRUD
    addSchema,
    deleteSchema,
    renameSchema,
    moveSchema,

    // Table CRUD
    addTable,
    deleteTable,
    renameTable,
    moveTable,
    moveTableToSchema,

    // Field Helpers
    isCommonField,
    getResolvedField,
    getResolvedFieldTypeForDb,
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
    getTableDdlMode,
    setTableDdlMode,
    getCommonTypeCase,
    setCommonTypeCase,

    // Global Pre/Post SQL
    setGlobalPreSql,
    setGlobalPostSql,

    // Common Used Fields CRUD
    addCommonUsedField,
    deleteCommonUsedField,
    updateCommonUsedFieldName,
    rebuildCommonUsedFieldsFromArray,
    getOrderedCommonUsedFields,

    // Unified Types CRUD
    addUnifiedType,
    deleteUnifiedType,
    renameUnifiedType,
    rebuildUnifiedTypesFromArray,

    // Import SQL
    openImportSqlModal,
    parseImportSql,
    confirmImportSql,

    // Toast
    showToast,

    // Versions / Migrations
    versions,
    hasVersions,
    migrations,
    selectedVersionSnapshot,
    versionPreviewLoading,
    loadVersionsAndMigrations,
    createVersion,
    deleteVersionById,
    getVersionSnapshot,
    previewVersionById,
    clearVersionPreview,
    computeDiff,
    createMigration,
    updateMigration,
    deleteMigrationById,
    previewMigrationDdl,
  }
})
