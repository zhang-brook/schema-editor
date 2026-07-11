import { ref, reactive, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { useI18n } from 'vue-i18n'
import type {
  CommonConfig,
  Schema,
  Table,
  Field,
  Index,
  TableMysqlConfig,
  InitialData,
  TypeCaseMode,
  TableDdlMode,
} from '@/types/schema'
import {
  isFileSystemAccessSupported,
  writeCommonToHandle,
  deleteSqlFromOutput,
  writeSqlToOutput,
  parseFieldLengthInput,
  // ===== 新结构（current/）读写 =====
  openProjectFolderNew,
  isNewStructure,
  writeDatabaseToHandle,
  writeSchemaJsonToHandle,
  writeTableToHandle,
  writeInitialDataToNewStructure,
  deleteTableDirFromHandle,
  deleteSchemaDirFromHandle,
  pruneTableDirsFromHandle,
  deleteInitialDataFromNewStructure,
} from '@/utils/file-helpers'
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
import { formatIndexColumn } from '@/utils/index-column-utils'
import { getDialectSubConfig } from '@/utils/dialect-resolver'
import {
  CommandManager,
  affectedTable,
  affectedInitialData,
  affectedSchema,
  affectedDatabase,
  affectedCommon,
  affectedSql,
  mergeAffectedFiles,
  type Command,
  type AffectedFile,
} from '@/core/history/command'
import { DEFAULT_UNIFIED_TYPES } from '@/utils/unified-types'
import { getCommonFileHandle, getCurrentDir } from '@/core/workspace/paths'
import { readJsonFile } from '@/core/workspace/handles'
import { COMMON_FILE, CURRENT_DIR, CURRENT_STRUCT_VERSION, sanitizeName } from '@/core/workspace/layout'
import { fmtPrePostSql, getGlobalPostSql, getGlobalPreSql, resolveFieldTypeForDialect } from '@/utils/sql-generator/shared'
import type { SqlDialect } from '@/utils/sql-generator/shared'
import type { UnifiedTypeDefinition } from '@/types/schema'
import { parseCreateTableStatements, detectDialect, convertColumnToField } from '@/utils/sql-parser'
import type { ParsedTable, ParseMessage } from '@/utils/sql-parser'
import { newFieldId, newTableId, newSchemaId, newBaselineId, newInitialDataId, newIndexId, newMigrationId } from '@/core/ids'
import {
  listBaselines,
  readBaseline,
  writeBaseline,
  deleteBaseline,
} from '@/core/baseline/storage'
import { computeStructureDiff } from '@/core/baseline/diff'
import type {
  BaselineSummary,
  BaselineSnapshot,
  Migration,
  MigrationDdlPreview,
  StructureDiff,
} from '@/core/baseline/types'
import {
  listMigrations,
  readMigration,
  writeMigration,
  deleteMigration,
} from '@/core/baseline/migration-storage'
import { generateMigrationDdl } from '@/core/baseline/migration-ddl'

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

  // ===== Baselines / Migrations =====
  const baselines = ref<BaselineSummary[]>([])
  const hasBaselines = computed(() => baselines.value.length > 0)
  const migrations = ref<Migration[]>([])

  // 基线预览状态
  const selectedBaselineSnapshot = ref<BaselineSnapshot | null>(null)
  const baselinePreviewLoading = ref(false)

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

  // ===== Initial Data Helpers =====
  function initialDataKey(schemaName: string, tableName: string): string {
    return `${schemaName}/${tableName}`
  }

  /** 反查某个 InitialData 对象所属的 schema/table（用于命令 affectedFiles） */
  function findInitialDataOwner(data: InitialData): { schema: string; table: string } | null {
    for (const [key, value] of initialDataMap.entries()) {
      if (value === data) {
        const sep = key.indexOf('/')
        return { schema: key.substring(0, sep), table: key.substring(sep + 1) }
      }
    }
    return null
  }

  const currentInitialDataKey = computed(() => {
    if (!currentSchema.value || !currentTable.value) return null
    return initialDataKey(currentSchema.value.schema, currentTable.value.name)
  })

  const currentInitialData = computed(() => {
    if (!currentInitialDataKey.value) return undefined
    return initialDataMap.get(currentInitialDataKey.value)
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
    schemas.length = 0
    initialDataMap.clear()
    initialDataDeletedKeys.clear()
    baselines.value = []
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

  // ===== Baselines / Migrations =====

  /** 加载基线列表与迁移脚本列表（仅元数据） */
  async function loadBaselinesAndMigrations() {
    if (!rootDirHandle.value) return
    try {
      baselines.value = await listBaselines(rootDirHandle.value)
    } catch (e) {
      console.error('[loadBaselinesAndMigrations] baselines failed:', e)
      baselines.value = []
    }
    try {
      migrations.value = await listMigrations(rootDirHandle.value)
    } catch (e) {
      console.error('[loadBaselinesAndMigrations] migrations failed:', e)
      migrations.value = []
    }
  }

  /**
   * 为当前内存态补齐缺失的唯一 id（field_id / table_id / schema_id / index_id / initial_data_id）。
   * 无论是否已创建基线都会在加载或创建基线时调用，保证所有对象都带 id 以跨版本识别 rename。
   * 返回是否发生了补齐（用于决定是否需写盘）。
   */
  function ensureIdsForCurrent(): boolean {
    let changed = false
    for (const schema of schemas) {
      if (!schema.schema_id) {
        schema.schema_id = newSchemaId()
        changed = true
      }
      for (const table of schema.tables) {
        if (!table.table_id) {
          table.table_id = newTableId()
          changed = true
        }
        for (const field of table.fields) {
          if (!field.field_id) {
            field.field_id = newFieldId()
            changed = true
          }
        }
        for (const index of table.indexes) {
          if (!index.index_id) {
            index.index_id = newIndexId()
            changed = true
          }
        }
      }
    }
    for (const data of initialDataMap.values()) {
      if (data.rows) {
        for (const row of data.rows) {
          if (!row.initial_data_id) {
            row.initial_data_id = newInitialDataId()
            changed = true
          }
        }
      }
    }
    return changed
  }

  /**
   * 创建基线：
   * 1. 若当前内存态存在缺失 id，先补齐（保证基线快照可跨版本识别 rename）。
   * 2. 将补齐后的 current 深拷贝快照为 baselines/<id>.json。
   * 3. 刷新基线列表。
   * 创建后用户进入「有基线」状态，后续新增表/字段自动带 id。
   */
  async function createBaseline(name?: string): Promise<BaselineSummary | null> {
    if (!rootDirHandle.value) return null
    const id = newBaselineId()
    const displayName = name?.trim() || `v${baselines.value.length + 1}.0`

    // 补齐缺失 id（若有变化，先写回 current/ 磁盘，保证快照与 current 一致）
    if (ensureIdsForCurrent()) {
      await syncAllToDisk()
    }

    const snapshot: BaselineSnapshot = {
      id,
      name: displayName,
      created_at: new Date().toISOString(),
      struct_version: CURRENT_STRUCT_VERSION,
      common: JSON.parse(JSON.stringify(commonConfig.value)),
      schema_order: commonConfig.value?.schema_order ?? schemas.map(s => s.schema),
      initial_data: JSON.parse(JSON.stringify(Object.fromEntries(initialDataMap.entries()))),
      schemas: JSON.parse(JSON.stringify(schemas)),
    }

    try {
      await writeBaseline(rootDirHandle.value, snapshot)
      await loadBaselinesAndMigrations()
      showToast(t('baseline.created', { name: displayName }))
      return { id, name: displayName, created_at: snapshot.created_at }
    } catch (e) {
      console.error('[createBaseline] failed:', e)
      showToast(t('toast.failedSaveChanges'))
      return null
    }
  }

  /** 删除基线 */
  async function deleteBaselineById(id: string): Promise<void> {
    if (!rootDirHandle.value) return
    try {
      await deleteBaseline(rootDirHandle.value, id)
      await loadBaselinesAndMigrations()
    } catch (e) {
      console.error('[deleteBaselineById] failed:', e)
    }
  }

  /** 读取基线完整快照（供 diff / 迁移使用） */
  async function getBaselineSnapshot(id: string): Promise<BaselineSnapshot | null> {
    if (!rootDirHandle.value) return null
    return readBaseline(rootDirHandle.value, id)
  }

  /** 预览基线：加载完整快照到预览面板 */
  async function previewBaselineById(id: string): Promise<void> {
    if (!rootDirHandle.value) return
    baselinePreviewLoading.value = true
    try {
      selectedBaselineSnapshot.value = await readBaseline(rootDirHandle.value, id)
    } catch (e) {
      console.error('[previewBaselineById] failed:', e)
      selectedBaselineSnapshot.value = null
    } finally {
      baselinePreviewLoading.value = false
    }
  }

  /** 关闭基线预览 */
  function clearBaselinePreview(): void {
    selectedBaselineSnapshot.value = null
  }

  /**
   * 计算两基线（或 当前 vs 基线）之间的结构 diff。
   * @param fromId 源基线 id；为 null 表示与「空结构」对比（即首次全量）
   * @param toCurrent true 时目标取当前内存态；否则取 toId 基线
   */
  async function computeDiff(
    fromId: string | null,
    toId: string | null,
    toCurrent: boolean,
  ): Promise<StructureDiff | null> {
    if (!rootDirHandle.value) return null
    let fromSchemas: import('@/types/schema').Schema[] | null = null
    if (fromId) {
      const fromSnap = await readBaseline(rootDirHandle.value, fromId)
      fromSchemas = fromSnap?.schemas ?? null
    }
    let toSchemas: import('@/types/schema').Schema[]
    let toRef: StructureDiff['to']
    if (toCurrent) {
      toSchemas = JSON.parse(JSON.stringify(schemas))
      toRef = { kind: 'current' }
    } else if (toId) {
      const toSnap = await readBaseline(rootDirHandle.value, toId)
      toSchemas = toSnap?.schemas ?? []
      toRef = { kind: 'baseline', id: toId, name: toSnap?.name ?? toId }
    } else {
      return null
    }
    const fromRef: StructureDiff['from'] = fromId
      ? { kind: 'baseline', id: fromId, name: baselines.value.find(b => b.id === fromId)?.name ?? fromId }
      : null
    return computeStructureDiff(fromSchemas, toSchemas, fromRef, toRef)
  }

  // ===== Migrations =====

  /** 创建迁移脚本（选两基线），默认带一个 auto_diff 步骤 */
  async function createMigration(fromBaseline: string, toBaseline: string, name?: string): Promise<Migration | null> {
    if (!rootDirHandle.value) return null
    const id = newMigrationId()
    const fromName = baselines.value.find(b => b.id === fromBaseline)?.name ?? fromBaseline
    const toName = baselines.value.find(b => b.id === toBaseline)?.name ?? toBaseline
    const migration: Migration = {
      id,
      name: name?.trim() || `${fromName} → ${toName}`,
      from_baseline: fromBaseline,
      to_baseline: toBaseline,
      steps: [{ type: 'auto_diff' }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    try {
      await writeMigration(rootDirHandle.value, migration)
      await loadBaselinesAndMigrations()
      showToast(t('migration.created', { name: migration.name }))
      return migration
    } catch (e) {
      console.error('[createMigration] failed:', e)
      showToast(t('toast.failedSaveChanges'))
      return null
    }
  }

  /** 更新迁移脚本（持久化 steps 等） */
  async function updateMigration(migration: Migration): Promise<void> {
    if (!rootDirHandle.value) return
    migration.updated_at = new Date().toISOString()
    try {
      await writeMigration(rootDirHandle.value, migration)
      // 刷新缓存（保留引用顺序）
      const idx = migrations.value.findIndex(m => m.id === migration.id)
      if (idx >= 0) migrations.value[idx] = migration
      else migrations.value.push(migration)
    } catch (e) {
      console.error('[updateMigration] failed:', e)
      showToast(t('toast.failedSaveChanges'))
    }
  }

  async function deleteMigrationById(id: string): Promise<void> {
    if (!rootDirHandle.value) return
    try {
      await deleteMigration(rootDirHandle.value, id)
      await loadBaselinesAndMigrations()
    } catch (e) {
      console.error('[deleteMigrationById] failed:', e)
    }
  }

  /** 预览迁移脚本合并后的最终 DDL（两方言） */
  async function previewMigrationDdl(migration: Migration): Promise<MigrationDdlPreview | null> {
    if (!rootDirHandle.value) return null
    const diff = await computeDiff(migration.from_baseline, migration.to_baseline, false)
    if (!diff) return null
    const targetSnap = await readBaseline(rootDirHandle.value, migration.to_baseline)
    const targetSchemas = targetSnap?.schemas ?? []
    return generateMigrationDdl(migration, diff, targetSchemas, commonConfig.value)
  }

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

    // 加载根 common.json（与基线无关的配置）
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

    // 补齐磁盘上已有对象缺失的 id（无论是否已创建基线，保证全部带 id 以跨版本识别）
    if (ensureIdsForCurrent()) {
      await syncAllToDisk()
    }

    // 自动选中第一个 schema
    if (schemas.length > 0) {
      selectedSchemaIdx.value = 0
      selectedTableIdx.value = schemas[0]!.tables.length > 0 ? 0 : -1
    }

    projectOpened.value = true
    // 打开项目后默认选中「库结构设计」tab
    settingsTab.value = 'structure'
    showCommonPanel.value = false
    // 加载基线/迁移列表（只读元数据，不加载完整快照）
    await loadBaselinesAndMigrations()
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
    } catch (e) {
      console.error('Auto-sync failed:', e)
      showToast(t('toast.failedSaveChanges'))
    } finally {
      _leaveWriteScope()
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

  // ===== Initial Data CRUD =====

  /** JSON 模式：直接设置完整 InitialData 对象 */
  function setInitialDataObject(schemaName: string, tableName: string, data: InitialData) {
    const key = initialDataKey(schemaName, tableName)
    const oldData = initialDataMap.get(key)
    const oldDeleted = initialDataDeletedKeys.has(key)
    const willDelete = (data.rows?.length ?? 0) === 0 && !data.pre_sql && !data.post_sql
    executeCommand({
      label: t('history.editInitialDataObject'),
      apply() {
        if (willDelete) {
          initialDataMap.delete(key)
          initialDataDeletedKeys.add(key)
        } else {
          // 新建初始数据时，为每一行分配 id（无论是否已创建基线）
          if (data.rows) {
            for (const row of data.rows) {
              if (!row.initial_data_id) row.initial_data_id = newInitialDataId()
            }
          }
          initialDataMap.set(key, data)
          initialDataDeletedKeys.delete(key)
        }
      },
      revert() {
        if (oldData) {
          initialDataMap.set(key, oldData)
        } else {
          initialDataMap.delete(key)
        }
        if (oldDeleted) {
          initialDataDeletedKeys.add(key)
        } else {
          initialDataDeletedKeys.delete(key)
        }
      },
      affectedFiles() {
        return [affectedInitialData(schemaName, tableName), affectedSql()]
      },
    })
  }

  function deleteInitialData(schemaName: string, tableName: string) {
    const key = initialDataKey(schemaName, tableName)
    const oldData = initialDataMap.get(key)
    const oldDeleted = initialDataDeletedKeys.has(key)
    executeCommand({
      label: t('history.deleteInitialData'),
      apply() {
        initialDataMap.delete(key)
        initialDataDeletedKeys.add(key)
      },
      revert() {
        if (oldData) {
          initialDataMap.set(key, oldData)
        }
        if (oldDeleted) {
          initialDataDeletedKeys.add(key)
        } else {
          initialDataDeletedKeys.delete(key)
        }
      },
      affectedFiles() {
        return [affectedInitialData(schemaName, tableName), affectedSql()]
      },
    })
  }

  /** 切换某行是否跳过（不生成 INSERT），支持 undo/redo */
  function setInitialDataRowSkip(
    schemaName: string,
    tableName: string,
    row: { is_skip?: boolean },
    checked: boolean,
  ) {
    const oldSkip = row.is_skip
    executeCommand({
      label: t('history.toggleSkipRow'),
      apply() {
        if (checked) {
          row.is_skip = true
        } else {
          delete row.is_skip
        }
      },
      revert() {
        if (oldSkip === undefined) {
          delete row.is_skip
        } else {
          row.is_skip = oldSkip
        }
      },
      affectedFiles() {
        return [affectedInitialData(schemaName, tableName), affectedSql()]
      },
    })
  }

  /** 设置某行某字段的注释，支持 undo/redo */
  function setInitialDataFieldComment(
    schemaName: string,
    tableName: string,
    row: { field_comments?: Record<string, string> },
    fieldName: string,
    val: string,
  ) {
    const trimmed = val.trim()
    const oldVal = row.field_comments?.[fieldName]
    const oldObj = row.field_comments ? { ...row.field_comments } : undefined
    executeCommand({
      label: t('history.editInitialDataComment', { name: fieldName }),
      apply() {
        if (!trimmed) {
          if (row.field_comments) {
            delete row.field_comments[fieldName]
            if (Object.keys(row.field_comments).length === 0) {
              delete row.field_comments
            }
          }
        } else {
          if (!row.field_comments) row.field_comments = {}
          row.field_comments[fieldName] = trimmed
        }
      },
      revert() {
        if (oldVal === undefined) {
          if (row.field_comments && Object.keys(oldObj ?? {}).length === 0) {
            delete row.field_comments
          } else if (row.field_comments) {
            delete row.field_comments[fieldName]
          }
        } else if (oldObj) {
          row.field_comments = { ...oldObj }
        }
      },
      affectedFiles() {
        return [affectedInitialData(schemaName, tableName), affectedSql()]
      },
    })
  }

  /** 设置某行某字段的数据值，支持 undo/redo（连续编辑合并） */
  function setInitialDataCell(
    schemaName: string,
    tableName: string,
    row: { data: Record<string, any> },
    fieldName: string,
    val: string,
  ) {
    const oldVal = row.data[fieldName]
    if (oldVal === val) return
    executeCommand({
      label: t('history.editInitialDataCell', { name: fieldName }),
      apply() {
        row.data[fieldName] = val
      },
      revert() {
        row.data[fieldName] = oldVal
      },
      affectedFiles() {
        return [affectedInitialData(schemaName, tableName), affectedSql()]
      },
    })
  }

  /** 设置整行注释，支持 undo/redo */
  function setInitialDataRowComment(
    schemaName: string,
    tableName: string,
    row: { row_comment?: string },
    val: string,
  ) {
    const trimmed = val.trim()
    const oldVal = row.row_comment
    executeCommand({
      label: t('history.editInitialDataRowComment'),
      apply() {
        if (trimmed) {
          row.row_comment = trimmed
        } else {
          delete row.row_comment
        }
      },
      revert() {
        if (oldVal === undefined) {
          delete row.row_comment
        } else {
          row.row_comment = oldVal
        }
      },
      affectedFiles() {
        return [affectedInitialData(schemaName, tableName), affectedSql()]
      },
    })
  }

  // ===== Initial Data Pre/Post SQL =====

  function setInitialDataPreSql(initialData: InitialData, dialect: SqlDialect, val: string) {
    const trimmed = val.trim()
    if (!trimmed && !initialData.pre_sql) return
    const oldPreSql = initialData.pre_sql ? { ...initialData.pre_sql } : undefined
    const owner = findInitialDataOwner(initialData)
    executeCommand({
      label: t('history.editInitialDataPreSql', { dialect }),
      coalesceKey: `initial-pre-sql:${dialect}`,
      apply() {
        if (!initialData.pre_sql) initialData.pre_sql = {}
        if (trimmed) {
          initialData.pre_sql[dialect] = trimmed
        } else {
          delete initialData.pre_sql[dialect]
        }
        if (initialData.pre_sql && !initialData.pre_sql.mysql && !initialData.pre_sql.postgresql) {
          delete initialData.pre_sql
        }
      },
      revert() {
        if (oldPreSql) {
          initialData.pre_sql = { ...oldPreSql }
        } else {
          delete initialData.pre_sql
        }
      },
      affectedFiles() {
        return owner
          ? [affectedInitialData(owner.schema, owner.table), affectedSql()]
          : [affectedSql()]
      },
    })
  }

  function setInitialDataPostSql(initialData: InitialData, dialect: SqlDialect, val: string) {
    const trimmed = val.trim()
    if (!trimmed && !initialData.post_sql) return
    const oldPostSql = initialData.post_sql ? { ...initialData.post_sql } : undefined
    const owner = findInitialDataOwner(initialData)
    executeCommand({
      label: t('history.editInitialDataPostSql', { dialect }),
      coalesceKey: `initial-post-sql:${dialect}`,
      apply() {
        if (!initialData.post_sql) initialData.post_sql = {}
        if (trimmed) {
          initialData.post_sql[dialect] = trimmed
        } else {
          delete initialData.post_sql[dialect]
        }
        if (initialData.post_sql && !initialData.post_sql.mysql && !initialData.post_sql.postgresql) {
          delete initialData.post_sql
        }
      },
      revert() {
        if (oldPostSql) {
          initialData.post_sql = { ...oldPostSql }
        } else {
          delete initialData.post_sql
        }
      },
      affectedFiles() {
        return owner
          ? [affectedInitialData(owner.schema, owner.table), affectedSql()]
          : [affectedSql()]
      },
    })
  }

  // ===== Schema Order =====
  /** 将当前 schemas 顺序同步到 commonConfig.schema_order */
  function syncSchemaOrder() {
    if (!commonConfig.value) return
    commonConfig.value.schema_order = schemas.map(s => s.schema)
  }

  /** 按 schema_order 排序 schemas（未在列表中的保留在原位，即末尾） */
  function applySchemaOrder() {
    const order = commonConfig.value?.schema_order
    if (!order || order.length === 0) return
    const orderMap = new Map<string, number>()
    order.forEach((name, i) => orderMap.set(name, i))
    schemas.sort((a, b) => {
      const ai = orderMap.get(a.schema)
      const bi = orderMap.get(b.schema)
      if (ai === undefined && bi === undefined) return 0
      if (ai === undefined) return 1
      if (bi === undefined) return -1
      return ai - bi
    })
  }

  /** 拖拽调整 schema 顺序 */
  function moveSchema(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return
    if (fromIdx < 0 || fromIdx >= schemas.length) return
    if (toIdx < 0 || toIdx >= schemas.length) return
    const [schema] = schemas.splice(fromIdx, 1)
    if (!schema) return
    executeCommand({
      label: t('history.moveSchema'),
      coalesceKey: `move-schema:${fromIdx}-${toIdx}`,
      apply() {
        schemas.splice(toIdx, 0, schema)
        syncSchemaOrder()
      },
      revert() {
        const curIdx = schemas.indexOf(schema)
        if (curIdx >= 0) schemas.splice(curIdx, 1)
        schemas.splice(fromIdx, 0, schema)
        syncSchemaOrder()
      },
      affectedFiles() {
        return [affectedDatabase(), affectedSql()]
      },
    })
  }

  // ===== Schema CRUD =====

  function addSchema(name: string) {
    if (schemas.some(s => s.schema === name)) {
      showToast(t('toast.schemaExists', { name }))
      return
    }
    const newSchema: Schema = {
      schema: name,
      tables: []
    }
    // 新增 schema 自动带 id（无论是否已创建基线，保证可跨版本识别）
    newSchema.schema_id = newSchemaId()
    executeCommand({
      label: t('history.addSchema'),
      coalesceKey: `add-schema:${name}`,
      apply() {
        schemas.push(newSchema)
        syncSchemaOrder()
      },
      revert() {
        const idx = schemas.indexOf(newSchema)
        if (idx >= 0) schemas.splice(idx, 1)
      },
      affectedFiles() {
        return [affectedDatabase(), affectedSchema(name), affectedSql()]
      },
    })
    selectedSchemaIdx.value = schemas.length - 1
    selectedTableIdx.value = -1
    showToast(t('toast.schemaCreated'))
  }

  function deleteSchema(schemaIdx: number) {
    const schema = schemas[schemaIdx]
    if (!schema) return
    if (!confirm(t('confirm.deleteSchema', { name: schema.schema }))) return

    // 记录该 schema 下各表的 initial-data 状态，便于 revert 恢复
    const removedInitialData: { key: string; data: InitialData }[] = []
    for (const table of schema.tables) {
      const key = initialDataKey(schema.schema, table.name)
      if (initialDataMap.has(key)) {
        removedInitialData.push({ key, data: initialDataMap.get(key)! })
      }
    }
    const removedIdx = schemaIdx
    const removedSchema = schema

    executeCommand({
      label: t('history.deleteSchema', { name: removedSchema.schema }),
      coalesceKey: `delete-schema:${removedSchema.schema}`,
      apply() {
        // 标记该 schema 所有 initial-data 待删除
        for (const { key } of removedInitialData) {
          if (initialDataMap.has(key)) {
            initialDataMap.delete(key)
            initialDataDeletedKeys.add(key)
          }
        }
        const idx = schemas.indexOf(removedSchema)
        if (idx >= 0) schemas.splice(idx, 1)
        syncSchemaOrder()
        // 更新选中
        if (schemas.length === 0) {
          selectedSchemaIdx.value = -1
          selectedTableIdx.value = -1
        } else if (selectedSchemaIdx.value >= schemas.length) {
          selectedSchemaIdx.value = schemas.length - 1
        }
      },
      revert() {
        schemas.splice(removedIdx, 0, removedSchema)
        syncSchemaOrder()
        for (const { key, data } of removedInitialData) {
          initialDataMap.set(key, data)
          initialDataDeletedKeys.delete(key)
        }
        selectedSchemaIdx.value = removedIdx
        selectedTableIdx.value = removedSchema.tables.length > 0 ? 0 : -1
      },
      affectedFiles() {
        return [affectedDatabase(), affectedSchema(removedSchema.schema), affectedSql()]
      },
    })
    showToast(t('toast.schemaDeleted'))
  }

  function renameSchema(schemaIdx: number, newName: string) {
    const schema = schemas[schemaIdx]
    if (!schema) return
    newName = newName.trim()
    if (!newName) return
    if (schemas.some((s, i) => i !== schemaIdx && s.schema === newName)) {
      showToast(t('toast.schemaExists', { name: newName }))
      return
    }

    const oldName = schema.schema
    // 记录该 schema 下各表 initial-data key 的迁移，便于 revert
    const keyMigrations = schema.tables.map(table => ({
      oldKey: initialDataKey(oldName, table.name),
      newKey: initialDataKey(newName, table.name),
      data: initialDataMap.has(initialDataKey(oldName, table.name))
        ? initialDataMap.get(initialDataKey(oldName, table.name))!
        : undefined,
    }))

    executeCommand({
      label: t('history.renameSchema', { name: newName }),
      coalesceKey: `rename-schema:${oldName}`,
      apply() {
        schema.schema = newName
        syncSchemaOrder()
        for (const m of keyMigrations) {
          if (m.data !== undefined) {
            initialDataMap.delete(m.oldKey)
            initialDataMap.set(m.newKey, m.data)
          }
          initialDataDeletedKeys.add(m.oldKey)
        }
      },
      revert() {
        schema.schema = oldName
        syncSchemaOrder()
        for (const m of keyMigrations) {
          if (m.data !== undefined) {
            initialDataMap.delete(m.newKey)
            initialDataMap.set(m.oldKey, m.data)
          }
          initialDataDeletedKeys.delete(m.oldKey)
        }
      },
      affectedFiles() {
        const files: AffectedFile[] = [
          affectedDatabase(),
          { kind: 'schema', schema: newName, oldSchema: oldName },
          affectedSql(),
        ]
        for (const table of schema.tables) {
          files.push(affectedTable(newName, table.name))
          files.push(affectedInitialData(newName, table.name))
        }
        return files
      },
    })

    showToast(t('toast.schemaRenamed'))
  }

  // ===== Navigation =====
  function selectTable(schemaIdx: number, tableIdx: number) {
    selectedSchemaIdx.value = schemaIdx
    selectedTableIdx.value = tableIdx
    showCommonPanel.value = false
    // Clear expanded states
    expandedFields.clear()
    expandedIndexes.clear()
  }

  function selectCommonConfig() {
    showCommonPanel.value = true
    selectedSchemaIdx.value = -1
    selectedTableIdx.value = -1
  }

  /** 选中 Schema（不选表），用于显示 SchemaConfigPanel */
  function selectSchemaOnly(schemaIdx: number) {
    showCommonPanel.value = false
    selectedSchemaIdx.value = schemaIdx
    selectedTableIdx.value = -1
    expandedFields.clear()
    expandedIndexes.clear()
  }

  // ===== 项目设置 =====
  /** 切换到指定设置 tab */
  function selectSettingsTab(tab: 'global' | 'structure' | 'version' | 'project') {
    settingsTab.value = tab
    if (tab === 'global') {
      // 全局配置页等价于原来的公共配置面板，需置 showCommonPanel 才能渲染
      showCommonPanel.value = true
    } else {
      showCommonPanel.value = false
    }
  }

  // ===== Table CRUD =====
  function addTable(schemaIdx: number) {
    const schema = schemas[schemaIdx]
    if (!schema) return
    const newTable: Table = {
      name: 'new_table',
      comment: '',
      fields: [],
      indexes: []
    }
    // 新增 table 自动带 id（无论是否已创建基线，保证可跨版本识别）
    newTable.table_id = newTableId()
    executeCommand({
      label: t('history.addTable'),
      coalesceKey: `add-table:${schema.schema}`,
      apply() {
        schema.tables.push(newTable)
      },
      revert() {
        const idx = schema.tables.indexOf(newTable)
        if (idx >= 0) schema.tables.splice(idx, 1)
      },
      affectedFiles() {
        return [affectedSchema(schema.schema), affectedTable(schema.schema, newTable.name), affectedSql()]
      },
    })
    selectTable(schemaIdx, schema.tables.length - 1)
    showToast(t('toast.tableAdded'))
  }

  /** 重命名表：同步更新表名、迁移初始数据 key 并清理旧表目录 */
  function renameTable(schemaIdx: number, tableIdx: number, newName: string): boolean {
    const schema = schemas[schemaIdx]
    if (!schema) return false
    const table = schema.tables[tableIdx]
    if (!table) return false
    newName = newName.trim()
    if (!newName) return false
    if (schema.tables.some((t, i) => i !== tableIdx && t.name === newName)) {
      showToast(t('toast.tableExists', { name: newName }))
      return false
    }

    const oldName = table.name
    const oldKey = initialDataKey(schema.schema, oldName)
    const newKey = initialDataKey(schema.schema, newName)
    const movedData = initialDataMap.has(oldKey) ? initialDataMap.get(oldKey)! : undefined
    // 仅当旧表目录与新目录经 sanitize 后不同名时，才标记旧 key 待删除（避免
    // 大小写不敏感文件系统上误删同一物理目录）。
    const markOldKeyForDelete = sanitizeName(oldName) !== sanitizeName(newName)

    executeCommand({
      label: t('history.renameTable', { name: newName }),
      coalesceKey: `rename-table:${schema.schema}:${oldName}`,
      apply() {
        if (movedData !== undefined) {
          initialDataMap.delete(oldKey)
          initialDataMap.set(newKey, movedData)
        }
        if (markOldKeyForDelete) {
          initialDataDeletedKeys.add(oldKey)
        }
        table.name = newName
      },
      revert() {
        if (movedData !== undefined) {
          initialDataMap.delete(newKey)
          initialDataMap.set(oldKey, movedData)
        }
        if (markOldKeyForDelete) {
          initialDataDeletedKeys.delete(oldKey)
        }
        table.name = oldName
      },
      affectedFiles() {
        return [
          affectedSchema(schema.schema),
          affectedTable(schema.schema, newName),
          affectedInitialData(schema.schema, newName),
          affectedSql(),
        ]
      },
    })

    showToast(t('toast.tableRenamed'))
    return true
  }

  async function deleteTable(schemaIdx: number, tableIdx: number) {
    const schema = schemas[schemaIdx]
    if (!schema) return
    const tableName = schema.tables[tableIdx]?.name
    if (!confirm(t('confirm.deleteTable', { name: tableName }))) return

    const removedTable = schema.tables[tableIdx]
    if (!removedTable) return
    const removedIdx = tableIdx
    // 记录被删表的 initial-data 状态，便于 revert 恢复
    const dataKey = initialDataKey(schema.schema, removedTable.name)
    const removedInitialData = initialDataMap.has(dataKey)
      ? { key: dataKey, data: initialDataMap.get(dataKey)! }
      : null

    executeCommand({
      label: t('history.deleteTable', { name: removedTable.name }),
      coalesceKey: `delete-table:${schema.schema}:${removedTable.name}`,
      apply() {
        if (removedIdx < schema.tables.length) {
          schema.tables.splice(removedIdx, 1)
        }
        if (removedInitialData) {
          initialDataMap.delete(removedInitialData.key)
          initialDataDeletedKeys.add(removedInitialData.key)
        }
      },
      revert() {
        schema.tables.splice(removedIdx, 0, removedTable)
        if (removedInitialData) {
          initialDataMap.set(removedInitialData.key, removedInitialData.data)
          initialDataDeletedKeys.delete(removedInitialData.key)
        }
      },
      affectedFiles() {
        return [affectedSchema(schema.schema), affectedTable(schema.schema, removedTable.name), affectedInitialData(schema.schema, removedTable.name), affectedSql()]
      },
    })

    if (selectedSchemaIdx.value === schemaIdx) {
      if (selectedTableIdx.value >= schema.tables.length) {
        selectedTableIdx.value = schema.tables.length - 1
      }
      if (schema.tables.length === 0) {
        selectedTableIdx.value = -1
      }
    }
    showToast(t('toast.tableDeleted'))
  }

  /** 拖拽调整同一个 schema 下表的顺序 */
  function moveTable(schemaIdx: number, fromIdx: number, toIdx: number) {
    const schema = schemas[schemaIdx]
    if (!schema) return
    if (fromIdx === toIdx) return
    if (fromIdx < 0 || fromIdx >= schema.tables.length) return
    if (toIdx < 0 || toIdx > schema.tables.length) return

    const [table] = schema.tables.splice(fromIdx, 1)
    if (!table) return
    const insertIdx = toIdx > fromIdx ? toIdx - 1 : toIdx
    executeCommand({
      label: t('history.moveTable'),
      coalesceKey: `move-table:${schema.schema}:${fromIdx}-${toIdx}`,
      apply() {
        schema.tables.splice(insertIdx, 0, table)
        if (selectedSchemaIdx.value === schemaIdx && selectedTableIdx.value === fromIdx) {
          selectedTableIdx.value = insertIdx
        }
      },
      revert() {
        const curIdx = schema.tables.indexOf(table)
        if (curIdx >= 0) schema.tables.splice(curIdx, 1)
        schema.tables.splice(fromIdx, 0, table)
        if (selectedSchemaIdx.value === schemaIdx && selectedTableIdx.value === insertIdx) {
          selectedTableIdx.value = fromIdx
        }
      },
      affectedFiles() {
        return [affectedSchema(schema.schema), affectedSql()]
      },
    })
  }

  /** 跨 schema 拖拽移动表 */
  function moveTableToSchema(fromSchemaIdx: number, fromTableIdx: number, toSchemaIdx: number, toTableIdx: number) {
    const fromSchema = schemas[fromSchemaIdx]
    const toSchema = schemas[toSchemaIdx]
    if (!fromSchema || !toSchema) return
    if (fromTableIdx < 0 || fromTableIdx >= fromSchema.tables.length) return
    if (toTableIdx < 0 || toTableIdx > toSchema.tables.length) return

    // 同一个 schema 内移动，委托给 moveTable
    if (fromSchemaIdx === toSchemaIdx) {
      moveTable(fromSchemaIdx, fromTableIdx, toTableIdx)
      return
    }

    const [table] = fromSchema.tables.splice(fromTableIdx, 1)
    if (!table) return
    toSchema.tables.splice(toTableIdx, 0, table)

    // Update initial data key when table moves between schemas
    const oldKey = initialDataKey(fromSchema.schema, table.name)
    const newKey = initialDataKey(toSchema.schema, table.name)
    const movedData = initialDataMap.has(oldKey) ? initialDataMap.get(oldKey)! : undefined

    executeCommand({
      label: t('history.moveTableToSchema'),
      coalesceKey: `move-table-to-schema:${fromSchema.schema}-${toSchema.schema}:${table.name}`,
      apply() {
        if (movedData !== undefined) {
          initialDataMap.delete(oldKey)
          initialDataMap.set(newKey, movedData)
        }
        selectedSchemaIdx.value = toSchemaIdx
        selectedTableIdx.value = toTableIdx
      },
      revert() {
        const curIdx = toSchema.tables.indexOf(table)
        if (curIdx >= 0) toSchema.tables.splice(curIdx, 1)
        fromSchema.tables.splice(fromTableIdx, 0, table)
        if (movedData !== undefined) {
          initialDataMap.delete(newKey)
          initialDataMap.set(oldKey, movedData)
        }
        selectedSchemaIdx.value = fromSchemaIdx
        selectedTableIdx.value = fromTableIdx
      },
      affectedFiles() {
        return [
          affectedSchema(fromSchema.schema),
          affectedSchema(toSchema.schema),
          affectedTable(toSchema.schema, table.name),
          affectedInitialData(toSchema.schema, table.name),
          affectedSql(),
        ]
      },
    })
  }

  // ===== Field Helpers =====
  function isCommonField(field: Field) {
    return field.use_common_used_fields === true
  }

  function getResolvedField(field: Field): Field {
    if (isCommonField(field) && commonConfig.value) {
      return commonConfig.value.common_used_fields[field.field_name] || field
    }
    return field
  }

  function fieldKey(schema: Schema, table: Table, field: Field) {
    return `${schema.schema}-${table.name}-${field.field_name}`
  }

  function indexKey(schema: Schema, table: Table, index: Index, indexIdx: number) {
    return `${schema.schema}-${table.name}-idx-${index.name || indexIdx}`
  }

  function toggleFieldExpand(key: string) {
    if (expandedFields.has(key)) {
      expandedFields.delete(key)
    } else {
      expandedFields.add(key)
    }
  }

  function toggleIndexExpand(key: string) {
    if (expandedIndexes.has(key)) {
      expandedIndexes.delete(key)
    } else {
      expandedIndexes.add(key)
    }
  }

  /** 获取字段在指定数据库方言中最终解析的类型显示字符串（如 "VARCHAR(255)" 或 "DECIMAL(10,2)"） */
  function getResolvedFieldTypeForDb(field: Field, dialect: SqlDialect): string {
    const resolved = getResolvedField(field)
    const typeInfo = resolveFieldTypeForDialect(resolved, dialect, commonConfig.value)
    if (!typeInfo.type) return '-'
    if (typeof typeInfo.scale === 'number' && typeof typeInfo.length === 'number') {
      return `${typeInfo.type}(${typeInfo.length},${typeInfo.scale})`
    }
    if (typeInfo.length !== null && typeInfo.length !== undefined) {
      return `${typeInfo.type}(${typeInfo.length})`
    }
    return typeInfo.type
  }

  /** 返回字段在 FieldTable type 列的显示文本 */
  function fieldTypeDisplay(field: Field): string {
    const resolved = getResolvedField(field)
    if (resolved.unified_type) return resolved.unified_type
    return resolved.field_type || '-'
  }

  /** 检查字段（含公共字段解析）是否包含任何数据库方言覆盖 */
  function hasFieldOverrides(field: Field): boolean {
    const resolved = getResolvedField(field)
    const m = resolved.mysql
    const p = resolved.postgresql
    return (!!m && Object.keys(m).length > 0) || (!!p && Object.keys(p).length > 0)
  }

  /** 解析字段默认值是否需要引号包裹 */
  function quoteDefaultForField(field: Field): boolean {
    const resolved = getResolvedField(field)
    // 字段级显式设置优先
    if (resolved.quote_default !== undefined) return resolved.quote_default
    // 从 unified_type 定义中获取
    if (resolved.unified_type && commonConfig.value?.unified_types) {
      const def = commonConfig.value.unified_types.find(ut => ut.name === resolved.unified_type)
      if (def?.quote_default !== undefined) return def.quote_default
    }
    // 默认不加引号（保持向后兼容，旧数据中 default 值已自带引号）
    return false
  }

  // ===== Comment Before Table =====
  function commentBeforeTableText(table: Table) {
    const val = table.comment_before_table
    if (!val) return ''
    if (Array.isArray(val)) {
      return val.map(item => item === null ? '' : item).join('\n')
    }
    return val
  }

  function setCommentBeforeTable(table: Table, text: string) {
    const lines = text.split('\n')
    const target: string | string[] | undefined = lines.length === 1
      ? (lines[0] === '' ? undefined : lines[0])
      : lines.map(line => line === '' ? null : line) as string[]
    const oldVal = table.comment_before_table

    executeCommand({
      label: t('history.editCommentBeforeTable'),
      coalesceKey: `comment-before-table:${table.name}`,
      apply() {
        if (target === undefined) {
          delete table.comment_before_table
        } else {
          table.comment_before_table = target
        }
      },
      revert() {
        if (oldVal === undefined) {
          delete table.comment_before_table
        } else {
          table.comment_before_table = oldVal
        }
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }

  // ===== Comment Before Fields =====
  function commentBeforeFieldText(table: Table, fieldName: string) {
    if (!table.comment_before_fields || !table.comment_before_fields[fieldName]) return ''
    const val = table.comment_before_fields[fieldName]
    if (Array.isArray(val)) {
      return val.map(item => item === null ? '' : item).join('\n')
    }
    return val
  }

  function setCommentBeforeField(table: Table, fieldName: string, text: string) {
    // 计算目标值（与原逻辑一致）
    let target: string | string[] | undefined
    if (text.trim()) {
      const lines = text.split('\n')
      target = lines.length === 1 ? lines[0]! : lines.map(line => line === '' ? null : line) as string[]
    }
    const oldVal = table.comment_before_fields?.[fieldName]
    const oldObj = table.comment_before_fields ? { ...table.comment_before_fields } : undefined

    executeCommand({
      label: t('history.editCommentBeforeField', { name: fieldName }),
      coalesceKey: `comment-before-field:${table.name}:${fieldName}`,
      apply() {
        if (target === undefined) {
          if (table.comment_before_fields) {
            delete table.comment_before_fields[fieldName]
            if (Object.keys(table.comment_before_fields).length === 0) {
              delete table.comment_before_fields
            }
          }
        } else {
          if (!table.comment_before_fields) table.comment_before_fields = {}
          table.comment_before_fields[fieldName] = target
        }
      },
      revert() {
        if (oldVal === undefined) {
          if (table.comment_before_fields) {
            delete table.comment_before_fields[fieldName]
            if (oldObj && Object.keys(oldObj).length === 0) {
              delete table.comment_before_fields
            }
          }
        } else if (oldObj) {
          table.comment_before_fields = { ...oldObj }
        }
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }

  // ===== Field CRUD =====
  function openAddFieldModal(schemaIdx: number, tableIdx: number, mode: 'normal' | 'common') {
    addFieldSchemaIdx.value = schemaIdx
    addFieldTableIdx.value = tableIdx
    addFieldMode.value = mode
    newFieldName.value = ''
    newFieldSelectCommon.value = ''
    if (mode === 'common') {
      // 初始化勾选状态：当前表中已引用的公共字段默认勾选
      const table = schemas[schemaIdx]?.tables[tableIdx]
      newFieldSelectCommons.value = table
        ? table.fields.filter(f => f.use_common_used_fields).map(f => f.field_name)
        : []
    }
    showAddFieldModal.value = true
  }

  function confirmAddField() {
    const sIdx = addFieldSchemaIdx.value
    const tIdx = addFieldTableIdx.value
    if (sIdx < 0 || tIdx < 0) return

    const table = schemas[sIdx]?.tables[tIdx]
    if (!table) return

    if (addFieldMode.value === 'common') {
      const selectedNames = newFieldSelectCommons.value
      const existingCommonNames = table.fields
        .filter(f => f.use_common_used_fields)
        .map(f => f.field_name)
      // 删除：表中存在但未被勾选的公共字段引用
      const removed: Field[] = []
      for (let i = table.fields.length - 1; i >= 0; i--) {
        const f = table.fields[i]!
        if (f.use_common_used_fields && !selectedNames.includes(f.field_name)) {
          removed.unshift(f)
          table.fields.splice(i, 1)
        }
      }
      // 添加：勾选了但表中不存在的公共字段引用
      const added: Field[] = []
      for (const name of selectedNames) {
        if (!existingCommonNames.includes(name)) {
          const f: Field = { field_name: name, use_common_used_fields: true }
          added.push(f)
          table.fields.push(f)
        }
      }

      const schemaName = schemas[sIdx]!.schema
      const finalMsg = (() => {
        if (added.length > 0 && removed.length > 0) {
          return t('toast.commonFieldsUpdated', { added: added.length, removed: removed.length })
        } else if (added.length > 0) {
          return t('toast.commonFieldsAdded', { n: added.length })
        } else if (removed.length > 0) {
          return t('toast.commonFieldsRemoved', { n: removed.length })
        }
        return t('toast.noChange')
      })()

      // 记录增删前后的字段数组快照，便于 undo/redo 完整回滚
      const beforeFields = table.fields.filter(f => !added.includes(f))
      const afterFields = table.fields.slice()

      executeCommand({
        label: t('history.editCommonFields'),
        coalesceKey: `edit-common-fields:${table.name}`,
        apply() {
          table.fields.splice(0, table.fields.length, ...afterFields)
        },
        revert() {
          table.fields.splice(0, table.fields.length, ...beforeFields)
        },
        affectedFiles() {
          return [affectedTable(schemaName, table.name), affectedCommon(), affectedSql()]
        },
      })

      showToast(finalMsg)
    } else {
      const name = newFieldName.value.trim()
      if (!name) { showToast(t('toast.pleaseEnterFieldName')); return }
      if (table.fields.some(f => f.field_name === name)) {
        showToast(t('toast.fieldExistsInTable', { name }))
        return
      }
      const ut = newFieldUnifiedType.value || undefined
      const newField: Field = {
        field_name: name,
        // 新增 field 自动带 id（无论是否已创建基线，保证可跨版本识别）
        field_id: newFieldId(),
        unified_type: ut,
        // 仅当未选择 unified_type 时才预设 field_type/field_length
        field_type: ut ? undefined : 'varchar',
        field_length: ut ? undefined : 255,
        not_null: false,
        primary_key: false,
        comment: ''
      }
      executeCommand({
        label: t('history.addField'),
        coalesceKey: `add-field-named:${table.name}:${name}`,
        apply() {
          table.fields.push(newField)
        },
        revert() {
          const idx = table.fields.indexOf(newField)
          if (idx >= 0) table.fields.splice(idx, 1)
        },
        affectedFiles() {
          return [affectedTable(schemas[sIdx]!.schema, table.name), affectedSql()]
        },
      })
      showToast(t('toast.fieldAdded'))
    }

    showAddFieldModal.value = false
  }

  function directAddField(schemaIdx: number, tableIdx: number) {
    if (schemaIdx < 0 || tableIdx < 0) return
    const table = schemas[schemaIdx]?.tables[tableIdx]
    if (!table) return

    const newField: Field = {
      field_name: '',
      field_type: 'varchar',
      field_length: 255,
      not_null: false,
      primary_key: false,
      comment: ''
    }
    // 新增 field 自动带 id（无论是否已创建基线，保证可跨版本识别）
    newField.field_id = newFieldId()
    executeCommand({
      label: t('history.addField'),
      coalesceKey: `add-field:${table.name}`,
      apply() {
        table.fields.push(newField)
      },
      revert() {
        const idx = table.fields.indexOf(newField)
        if (idx >= 0) table.fields.splice(idx, 1)
      },
      affectedFiles() {
        return [affectedTable(schemas[schemaIdx]!.schema, table.name), affectedSql()]
      },
    })
    showToast(t('toast.fieldAdded'))
  }

  function deleteField(table: Table, fieldIdx: number) {
    const fieldName = table.fields[fieldIdx]?.field_name
    // 空字段名直接删除，不限确认
    if (fieldName && !confirm(t('confirm.deleteField', { name: fieldName }))) return

    const removed = table.fields[fieldIdx]
    if (!removed) return
    const removedIdx = fieldIdx
    // 删除 comment_before_fields 中该字段的注释（revert 时一并恢复）
    const removedCommentBefore = fieldName && table.comment_before_fields
      ? { ...table.comment_before_fields }
      : undefined

    executeCommand({
      label: t('history.deleteField', { name: fieldName || '' }),
      coalesceKey: `delete-field:${table.name}:${fieldIdx}`,
      apply() {
        table.fields.splice(removedIdx, 1)
        if (fieldName && table.comment_before_fields && table.comment_before_fields[fieldName]) {
          delete table.comment_before_fields[fieldName]
          if (Object.keys(table.comment_before_fields).length === 0) {
            delete table.comment_before_fields
          }
        }
      },
      revert() {
        table.fields.splice(removedIdx, 0, removed)
        if (removedCommentBefore) {
          table.comment_before_fields = removedCommentBefore
        }
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
    showToast(t('toast.fieldDeleted'))
  }

  /** 从表对象反查其所属 schema 名称（用于 affectedFiles） */
  function currentSchemaName(table: Table): string {
    const schema = schemas.find(s => s.tables.includes(table))
    return schema?.schema ?? currentSchema.value?.schema ?? ''
  }

  /** 从字段对象反查其所属 schema 名称（用于 affectedFiles） */
  function currentSchemaNameOfField(field: Field): string {
    for (const schema of schemas) {
      for (const table of schema.tables) {
        if (table.fields.includes(field)) {
          return schema.schema
        }
      }
    }
    return currentSchema.value?.schema ?? ''
  }

  /**
   * 通用字段属性编辑命令：apply 设为新值，revert 恢复旧值。
   * 用于字段名/注释/类型/长度/默认值/skip 等所有字段属性编辑，统一支持 undo/redo。
   * 同一字段同一属性的连续编辑通过 coalesceKey 合并为单条 undo 记录。
   */
  function updateFieldProp(
    table: Table,
    field: Field,
    prop: keyof Field,
    value: unknown,
    coalesceKey?: string,
  ) {
    const oldValue = field[prop]
    if (oldValue === value) return
    executeCommand({
      label: t('history.editField', { prop: String(prop) }),
      coalesceKey: coalesceKey ?? `field-prop:${table.name}:${field.field_name}:${String(prop)}`,
      apply() {
        ;(field as any)[prop] = value
      },
      revert() {
        ;(field as any)[prop] = oldValue
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }

  /** 一次性更新字段多个属性（如切换统一类型时清 field_type/quote_default），作为一个撤销单元 */
  function updateFieldProps(
    table: Table,
    field: Field,
    changes: Partial<Field>,
    coalesceKey?: string,
  ) {
    const oldValues: Partial<Field> = {}
    for (const k of Object.keys(changes) as (keyof Field)[]) {
      ;(oldValues as any)[k] = field[k]
    }
    executeCommand({
      label: t('history.editField', { prop: 'multiple' }),
      coalesceKey: coalesceKey ?? `field-props:${table.name}:${field.field_name}`,
      apply() {
        Object.assign(field, changes)
      },
      revert() {
        Object.assign(field, oldValues)
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }

  /** 字段名编辑命令：改名后同步索引中引用的列名 */
  function updateFieldName(table: Table, field: Field, newName: string) {
    const oldName = field.field_name
    const trimmed = newName.trim()
    if (!trimmed || oldName === trimmed) return
    executeCommand({
      label: t('history.renameField', { name: trimmed }),
      coalesceKey: `rename-field:${table.name}:${oldName}`,
      apply() {
        field.field_name = trimmed
        syncFieldNameInIndexes(table, oldName, trimmed)
      },
      revert() {
        field.field_name = oldName
        syncFieldNameInIndexes(table, trimmed, oldName)
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }

  function moveFieldUp(table: Table, fieldIdx: number) {
    if (fieldIdx <= 0) return
    const fromIdx = fieldIdx
    const toIdx = fieldIdx - 1
    executeCommand({
      label: t('history.moveField'),
      coalesceKey: `move-field:${table.name}:${fieldIdx}`,
      apply() {
        const arr = table.fields
        ;[arr[toIdx], arr[fromIdx]] = [arr[fromIdx]!, arr[toIdx]!]
      },
      revert() {
        const arr = table.fields
        ;[arr[fromIdx], arr[toIdx]] = [arr[toIdx]!, arr[fromIdx]!]
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }

  function moveFieldDown(table: Table, fieldIdx: number) {
    if (fieldIdx >= table.fields.length - 1) return
    const fromIdx = fieldIdx
    const toIdx = fieldIdx + 1
    executeCommand({
      label: t('history.moveField'),
      coalesceKey: `move-field:${table.name}:${fieldIdx}`,
      apply() {
        const arr = table.fields
        ;[arr[toIdx], arr[fromIdx]] = [arr[fromIdx]!, arr[toIdx]!]
      },
      revert() {
        const arr = table.fields
        ;[arr[fromIdx], arr[toIdx]] = [arr[toIdx]!, arr[fromIdx]!]
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }

  // ===== Index CRUD =====
  function addIndex(table: Table) {
    const newIndex: Index = {
      type: 'index',
      // 新增 index 自动带 id（无论是否已创建基线，保证可跨版本识别）
      index_id: newIndexId(),
      columns: [{ name: '' }],
      using: ''
    }
    executeCommand({
      label: t('history.addIndex'),
      apply() {
        table.indexes.push(newIndex)
      },
      revert() {
        const idx = table.indexes.indexOf(newIndex)
        if (idx >= 0) table.indexes.splice(idx, 1)
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
    showToast(t('toast.indexAdded'))
  }

  function deleteIndex(table: Table, indexIdx: number) {
    if (!confirm(t('confirm.deleteIndex'))) return
    const removed = table.indexes[indexIdx]
    if (!removed) return
    executeCommand({
      label: t('history.deleteIndex'),
      apply() {
        if (indexIdx >= 0 && indexIdx < table.indexes.length) {
          table.indexes.splice(indexIdx, 1)
        }
      },
      revert() {
        table.indexes.splice(indexIdx, 0, removed)
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
    showToast(t('toast.indexDeleted'))
  }

  /** 当字段名变更时，同步更新所有索引中引用的列名 */
  function syncFieldNameInIndexes(table: Table, oldName: string, newName: string) {
    if (!oldName || !newName || oldName === newName) return
    for (const index of table.indexes) {
      for (const col of index.columns) {
        if (col.name === oldName) {
          col.name = newName
        }
      }
    }
  }

  function indexColumnsText(index: Index) {
    return (index.columns || []).map(c => formatIndexColumn(c)).filter(s => s).join(', ')
  }

  function setIndexColumns(index: Index, text: string) {
    const raw = text.split(',').map(s => s.trim()).filter(s => s)
    const newColumns = raw.length > 0 ? raw.map(s => ({ name: s })) : [{ name: '' }]
    const oldColumns = index.columns.map(c => ({ ...c }))
    executeCommand({
      label: t('history.editIndexColumns'),
      coalesceKey: `index-cols:${index.name ?? ''}`,
      apply() {
        index.columns = newColumns
      },
      revert() {
        index.columns = oldColumns.map(c => ({ ...c }))
      },
      affectedFiles() {
        const owner = schemas.find(s => s.tables.some(t => t.indexes.includes(index)))
        const table = owner?.tables.find(t => t.indexes.includes(index))
        return (owner && table)
          ? [affectedTable(owner.schema, table.name), affectedSql()]
          : [affectedSql()]
      },
    })
  }

  // ===== MySQL table override =====
  function getTableMysqlEngine(table: Table) {
    return getDialectSubConfig(table.mysql, 'mysql_engine', '')
  }
  function getTableMysqlCharset(table: Table) {
    return getDialectSubConfig(table.mysql, 'mysql_charset', '')
  }
  function getTableMysqlCollation(table: Table) {
    return getDialectSubConfig(table.mysql, 'mysql_collation', '')
  }
  function setTableMysqlEngine(table: Table, val: string) {
    const oldMysql = table.mysql ? { ...table.mysql } : undefined
    executeCommand({
      label: t('history.editTableMysqlEngine'),
      coalesceKey: `table-mysql-engine:${table.name}`,
      apply() {
        if (!table.mysql) table.mysql = {}
        table.mysql.mysql_engine = val || undefined
        cleanMysqlOverride(table)
      },
      revert() {
        if (oldMysql) {
          table.mysql = { ...oldMysql }
        } else {
          delete table.mysql
        }
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }
  function setTableMysqlCharset(table: Table, val: string) {
    const oldMysql = table.mysql ? { ...table.mysql } : undefined
    executeCommand({
      label: t('history.editTableMysqlCharset'),
      coalesceKey: `table-mysql-charset:${table.name}`,
      apply() {
        if (!table.mysql) table.mysql = {}
        table.mysql.mysql_charset = val || undefined
        cleanMysqlOverride(table)
      },
      revert() {
        if (oldMysql) {
          table.mysql = { ...oldMysql }
        } else {
          delete table.mysql
        }
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }
  function setTableMysqlCollation(table: Table, val: string) {
    const oldMysql = table.mysql ? { ...table.mysql } : undefined
    executeCommand({
      label: t('history.editTableMysqlCollation'),
      coalesceKey: `table-mysql-collation:${table.name}`,
      apply() {
        if (!table.mysql) table.mysql = {}
        table.mysql.mysql_collation = val || undefined
        cleanMysqlOverride(table)
      },
      revert() {
        if (oldMysql) {
          table.mysql = { ...oldMysql }
        } else {
          delete table.mysql
        }
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }
  function cleanMysqlOverride(table: Table) {
    if (table.mysql && Object.values(table.mysql).every(v => v === undefined || v === '')) {
      delete table.mysql
    }
  }

  // ===== Table Pre/Post SQL =====

  function setTablePreSql(table: Table, dialect: SqlDialect, val: string) {
    const trimmed = val.trim()
    if (!trimmed && !table.pre_sql) return
    const oldPreSql = table.pre_sql ? { ...table.pre_sql } : undefined
    executeCommand({
      label: t('history.editTablePreSql', { dialect }),
      coalesceKey: `table-pre-sql:${table.name}:${dialect}`,
      apply() {
        if (!table.pre_sql) table.pre_sql = {}
        if (trimmed) {
          table.pre_sql[dialect] = trimmed
        } else {
          delete table.pre_sql[dialect]
        }
        if (table.pre_sql && !table.pre_sql.mysql && !table.pre_sql.postgresql) {
          delete table.pre_sql
        }
      },
      revert() {
        if (oldPreSql) {
          table.pre_sql = { ...oldPreSql }
        } else {
          delete table.pre_sql
        }
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }

  function setTablePostSql(table: Table, dialect: SqlDialect, val: string) {
    const trimmed = val.trim()
    if (!trimmed && !table.post_sql) return
    const oldPostSql = table.post_sql ? { ...table.post_sql } : undefined
    executeCommand({
      label: t('history.editTablePostSql', { dialect }),
      coalesceKey: `table-post-sql:${table.name}:${dialect}`,
      apply() {
        if (!table.post_sql) table.post_sql = {}
        if (trimmed) {
          table.post_sql[dialect] = trimmed
        } else {
          delete table.post_sql[dialect]
        }
        if (table.post_sql && !table.post_sql.mysql && !table.post_sql.postgresql) {
          delete table.post_sql
        }
      },
      revert() {
        if (oldPostSql) {
          table.post_sql = { ...oldPostSql }
        } else {
          delete table.post_sql
        }
      },
      affectedFiles() {
        return [affectedTable(currentSchemaName(table), table.name), affectedSql()]
      },
    })
  }

  // ===== Schema Pre/Post SQL =====

  function setSchemaPreSql(schema: Schema, dialect: SqlDialect, val: string) {
    const trimmed = val.trim()
    if (!trimmed && !schema.pre_sql) return
    const oldPreSql = schema.pre_sql ? { ...schema.pre_sql } : undefined
    executeCommand({
      label: t('history.editSchemaPreSql', { dialect }),
      coalesceKey: `schema-pre-sql:${schema.schema}:${dialect}`,
      apply() {
        if (!schema.pre_sql) schema.pre_sql = {}
        if (trimmed) {
          schema.pre_sql[dialect] = trimmed
        } else {
          delete schema.pre_sql[dialect]
        }
        if (schema.pre_sql && !schema.pre_sql.mysql && !schema.pre_sql.postgresql) {
          delete schema.pre_sql
        }
      },
      revert() {
        if (oldPreSql) {
          schema.pre_sql = { ...oldPreSql }
        } else {
          delete schema.pre_sql
        }
      },
      affectedFiles() {
        return [affectedSchema(schema.schema), affectedSql()]
      },
    })
  }

  function setSchemaPostSql(schema: Schema, dialect: SqlDialect, val: string) {
    const trimmed = val.trim()
    if (!trimmed && !schema.post_sql) return
    const oldPostSql = schema.post_sql ? { ...schema.post_sql } : undefined
    executeCommand({
      label: t('history.editSchemaPostSql', { dialect }),
      coalesceKey: `schema-post-sql:${schema.schema}:${dialect}`,
      apply() {
        if (!schema.post_sql) schema.post_sql = {}
        if (trimmed) {
          schema.post_sql[dialect] = trimmed
        } else {
          delete schema.post_sql[dialect]
        }
        if (schema.post_sql && !schema.post_sql.mysql && !schema.post_sql.postgresql) {
          delete schema.post_sql
        }
      },
      revert() {
        if (oldPostSql) {
          schema.post_sql = { ...oldPostSql }
        } else {
          delete schema.post_sql
        }
      },
      affectedFiles() {
        return [affectedSchema(schema.schema), affectedSql()]
      },
    })
  }

  // ===== Global Pre/Post SQL =====

  function setGlobalPreSql(dialect: SqlDialect, val: string) {
    if (!commonConfig.value) return
    const trimmed = val.trim()
    const oldDefaultConfig = JSON.parse(JSON.stringify(commonConfig.value.default_config))
    executeCommand({
      label: t('history.editGlobalPreSql', { dialect }),
      coalesceKey: `global-pre-sql:${dialect}`,
      apply() {
        if (dialect === 'mysql') {
          commonConfig.value!.default_config.mysql.pre_sql = trimmed || undefined
        } else {
          if (!commonConfig.value!.default_config.postgresql) {
            commonConfig.value!.default_config.postgresql = { quote_identifiers: true }
          }
          commonConfig.value!.default_config.postgresql.pre_sql = trimmed || undefined
        }
      },
      revert() {
        commonConfig.value!.default_config = JSON.parse(JSON.stringify(oldDefaultConfig))
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  function setGlobalPostSql(dialect: SqlDialect, val: string) {
    if (!commonConfig.value) return
    const trimmed = val.trim()
    const oldDefaultConfig = JSON.parse(JSON.stringify(commonConfig.value.default_config))
    executeCommand({
      label: t('history.editGlobalPostSql', { dialect }),
      coalesceKey: `global-post-sql:${dialect}`,
      apply() {
        if (dialect === 'mysql') {
          commonConfig.value!.default_config.mysql.post_sql = trimmed || undefined
        } else {
          if (!commonConfig.value!.default_config.postgresql) {
            commonConfig.value!.default_config.postgresql = { quote_identifiers: true }
          }
          commonConfig.value!.default_config.postgresql.post_sql = trimmed || undefined
        }
      },
      revert() {
        commonConfig.value!.default_config = JSON.parse(JSON.stringify(oldDefaultConfig))
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  // ===== Field mysql/postgresql override helpers =====
  function ensureFieldOverride(field: Field, db: SqlDialect) {
    if (!field[db]) field[db] = {}
    return field[db]!
  }

  function getFieldOverrideValue(field: Field, db: SqlDialect, key: string) {
    return (field[db] as any)?.[key] ?? ''
  }

  function setFieldOverrideValue(field: Field, db: SqlDialect, key: string, val: any) {
    const oldOverride = field[db] ? { ...field[db] } : undefined
    const oldDeleted = oldOverride === undefined
    const newVal = (val === '' || val === null || val === undefined)
      ? undefined
      : (key === 'field_length' || key === 'field_scale' ? parseFieldLengthInput(val) : val)

    executeCommand({
      label: t('history.editFieldOverride', { db }),
      coalesceKey: `field-override:${field.field_name}:${db}:${key}`,
      apply() {
        const override = ensureFieldOverride(field, db)
        if (newVal === undefined) {
          delete override[key as keyof typeof override]
        } else {
          (override as any)[key] = newVal
        }
        if (field[db] && Object.keys(field[db]!).length === 0) {
          delete field[db]
        }
      },
      revert() {
        if (oldDeleted) {
          delete field[db]
        } else {
          field[db] = { ...oldOverride! } as any
        }
      },
      affectedFiles() {
        return [affectedTable(currentSchemaNameOfField(field), field.field_name), affectedSql()]
      },
    })
  }

  // ===== Index mysql/postgresql override helpers =====
  function getIndexOverrideValue(index: Index, db: SqlDialect, key: string) {
    return (index[db] as any)?.[key] ?? ''
  }

  function setIndexOverrideValue(index: Index, db: SqlDialect, key: string, val: any) {
    const oldOverride = index[db] ? { ...(index[db] as any) } : undefined
    const oldDeleted = oldOverride === undefined
    const newVal = (val === '' || val === null || val === undefined) ? undefined : val
    executeCommand({
      label: t('history.editIndexOverride'),
      coalesceKey: `index-override:${db}:${key}`,
      apply() {
        if (!index[db]) (index as any)[db] = {}
        if (newVal === undefined) {
          delete (index[db] as any)[key]
        } else {
          (index[db] as any)[key] = newVal
        }
        if (index[db] && Object.keys(index[db]!).length === 0) {
          delete index[db]
        }
      },
      revert() {
        if (oldDeleted) {
          delete index[db]
        } else {
          ;(index as any)[db] = { ...oldOverride! }
        }
      },
      affectedFiles() {
        const owner = schemas.find(s => s.tables.some(t => t.indexes.includes(index)))
        const table = owner?.tables.find(t => t.indexes.includes(index))
        return (owner && table)
          ? [affectedTable(owner.schema, table.name), affectedSql()]
          : [affectedSql()]
      },
    })
  }

  // ===== Build export data =====

  /** 将单表内存态转换为可写出的 table.json 对象 */
  function buildTableExportData(table: Table): Table {
    const tableData: Partial<Table> = {
      name: table.name,
      comment: table.comment,
    }
    // 表唯一 id（创建基线后存在；无基线时为 undefined 不写出）
    if (table.table_id) tableData.table_id = table.table_id

    // comment_before_table
    if (table.comment_before_table) {
      tableData.comment_before_table = table.comment_before_table
    }

    // comment_before_fields
    if (table.comment_before_fields && Object.keys(table.comment_before_fields).length > 0) {
      tableData.comment_before_fields = {}
      for (const [k, v] of Object.entries(table.comment_before_fields)) {
        tableData.comment_before_fields[k] = v
      }
    }

    // pre_sql / post_sql
    if (table.pre_sql && (table.pre_sql.mysql || table.pre_sql.postgresql)) {
      tableData.pre_sql = { ...table.pre_sql }
    }
    if (table.post_sql && (table.post_sql.mysql || table.post_sql.postgresql)) {
      tableData.post_sql = { ...table.post_sql }
    }

    // mysql table config
    if (table.mysql && Object.keys(table.mysql).length > 0) {
      const mysqlData: TableMysqlConfig = {}
      if (table.mysql.mysql_engine) mysqlData.mysql_engine = table.mysql.mysql_engine
      if (table.mysql.mysql_charset) mysqlData.mysql_charset = table.mysql.mysql_charset
      if (table.mysql.mysql_collation) mysqlData.mysql_collation = table.mysql.mysql_collation
      if (Object.keys(mysqlData).length > 0) tableData.mysql = mysqlData
    }

    // fields
    tableData.fields = table.fields.map(field => {
      const f: Field = { field_name: field.field_name }
      // 字段唯一 id（创建基线后存在；无基线时为 undefined 不写出）
      if (field.field_id) f.field_id = field.field_id
      if (field.use_common_used_fields) {
        f.use_common_used_fields = true
      } else {
        // 导出 unified_type（仅当有值时）
        if (field.unified_type) {
          f.unified_type = field.unified_type
          // 有 unified_type 时不导出冗余的 field_type/field_length/field_scale（除非有显式字段级覆盖）
          if (field.field_type !== undefined && field.field_type !== '') f.field_type = field.field_type
          if (field.field_length !== undefined) f.field_length = field.field_length
          if (field.field_scale !== undefined) f.field_scale = field.field_scale
        } else {
          if (field.field_type !== undefined) f.field_type = field.field_type
          if (field.field_length !== undefined) f.field_length = field.field_length
          if (field.field_scale !== undefined) f.field_scale = field.field_scale
        }
        if (field.not_null !== undefined) f.not_null = field.not_null
        if (field.primary_key !== undefined) f.primary_key = field.primary_key
        if (field.default !== undefined) f.default = field.default
        // 仅自定义类型字段导出 quote_default（统一类型字段从类型定义中获取）
        if (!field.unified_type && field.quote_default !== undefined) f.quote_default = field.quote_default
        if (field.comment !== undefined) f.comment = field.comment
        if (field.is_commented_out) f.is_commented_out = true
        if (field.field_length_disabled) f.field_length_disabled = true
        if (field.field_scale_disabled) f.field_scale_disabled = true
        // db overrides
        if (field.mysql && Object.keys(field.mysql).length > 0) f.mysql = { ...field.mysql }
        if (field.postgresql && Object.keys(field.postgresql).length > 0) f.postgresql = { ...field.postgresql }
      }
      return f
    })

    // indexes
    tableData.indexes = table.indexes.map(index => {
      const idx: Partial<Index> = {}
      if (index.name) idx.name = index.name
      if (index.type) idx.type = index.type
      if (index.using) idx.using = index.using
      if (index.index_id) idx.index_id = index.index_id
      idx.columns = index.columns.map(c => {
        const col: any = { name: c.name }
        if (c.sort_order) col.sort_order = c.sort_order
        if (c.mysql && Object.keys(c.mysql).length > 0) col.mysql = { ...c.mysql }
        if (c.postgresql && Object.keys(c.postgresql).length > 0) col.postgresql = { ...c.postgresql }
        return col
      })
      if (index.comment) idx.comment = index.comment
      if (index.pre_comment) idx.pre_comment = index.pre_comment
      if (index.mysql && Object.keys(index.mysql).length > 0) idx.mysql = { ...index.mysql }
      if (index.postgresql && Object.keys(index.postgresql).length > 0) idx.postgresql = { ...index.postgresql }
      return idx as Index
    })

    return tableData as Table
  }

  function buildSchemaExportData(schema: Schema) {
    const data: Schema = {
      schema: schema.schema,
      tables: schema.tables.map(buildTableExportData),
    }
    if (schema.schema_id) data.schema_id = schema.schema_id
    // schema 级别 pre_sql / post_sql
    if (schema.pre_sql && (schema.pre_sql.mysql || schema.pre_sql.postgresql)) {
      data.pre_sql = { ...schema.pre_sql }
    }
    if (schema.post_sql && (schema.post_sql.mysql || schema.post_sql.postgresql)) {
      data.post_sql = { ...schema.post_sql }
    }
    return data
  }

  // ===== Common Config Editing =====
  function getCommonMysqlEngine() {
    return commonConfig.value?.default_config?.mysql?.table?.mysql_engine || ''
  }
  function getCommonMysqlCharset() {
    return commonConfig.value?.default_config?.mysql?.table?.mysql_charset || ''
  }
  function getCommonMysqlCollation() {
    return commonConfig.value?.default_config?.mysql?.table?.mysql_collation || ''
  }
  function setCommonMysqlEngine(val: string) {
    if (!commonConfig.value) return
    const old = commonConfig.value.default_config.mysql.table.mysql_engine
    executeCommand({
      label: t('history.editMysqlEngine'),
      coalesceKey: 'common-mysql-engine',
      apply() {
        commonConfig.value!.default_config.mysql.table.mysql_engine = val
      },
      revert() {
        commonConfig.value!.default_config.mysql.table.mysql_engine = old
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }
  function setCommonMysqlCharset(val: string) {
    if (!commonConfig.value) return
    const old = commonConfig.value.default_config.mysql.table.mysql_charset
    executeCommand({
      label: t('history.editMysqlCharset'),
      coalesceKey: 'common-mysql-charset',
      apply() {
        commonConfig.value!.default_config.mysql.table.mysql_charset = val
      },
      revert() {
        commonConfig.value!.default_config.mysql.table.mysql_charset = old
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }
  function setCommonMysqlCollation(val: string) {
    if (!commonConfig.value) return
    const old = commonConfig.value.default_config.mysql.table.mysql_collation
    executeCommand({
      label: t('history.editMysqlCollation'),
      coalesceKey: 'common-mysql-collation',
      apply() {
        commonConfig.value!.default_config.mysql.table.mysql_collation = val
      },
      revert() {
        commonConfig.value!.default_config.mysql.table.mysql_collation = old
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  function getCommonPostgresqlQuoteIdentifiers(): boolean {
    return commonConfig.value?.default_config?.postgresql?.quote_identifiers ?? true
  }
  function setCommonPostgresqlQuoteIdentifiers(val: boolean) {
    if (!commonConfig.value) return
    const old = getCommonPostgresqlQuoteIdentifiers()
    executeCommand({
      label: t('history.editPgQuoteIdentifiers'),
      apply() {
        if (!commonConfig.value!.default_config.postgresql) {
          commonConfig.value!.default_config.postgresql = { quote_identifiers: true }
        }
        commonConfig.value!.default_config.postgresql.quote_identifiers = val
      },
      revert() {
        if (!commonConfig.value!.default_config.postgresql) {
          commonConfig.value!.default_config.postgresql = { quote_identifiers: true }
        }
        commonConfig.value!.default_config.postgresql.quote_identifiers = old
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  function getTableDdlMode(): TableDdlMode {
    return commonConfig.value?.default_config?.table_ddl_mode ?? 'drop_and_create'
  }
  function setTableDdlMode(val: TableDdlMode) {
    if (!commonConfig.value) return
    const old = getTableDdlMode()
    executeCommand({
      label: t('history.editTableDdlMode'),
      apply() {
        commonConfig.value!.default_config.table_ddl_mode = val === 'drop_and_create' ? undefined : val
      },
      revert() {
        commonConfig.value!.default_config.table_ddl_mode = old === 'drop_and_create' ? undefined : old
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  function getCommonTypeCase(): TypeCaseMode {
    return commonConfig.value?.type_case ?? 'keep'
  }
  function setCommonTypeCase(val: TypeCaseMode) {
    if (!commonConfig.value) return
    const old = getCommonTypeCase()
    executeCommand({
      label: t('history.editTypeCase'),
      apply() {
        commonConfig.value!.type_case = val
      },
      revert() {
        commonConfig.value!.type_case = old
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  // ===== Common Used Fields CRUD =====
  function addCommonUsedField(name: string) {
    if (!commonConfig.value) return
    if (!name.trim()) { showToast(t('toast.pleaseEnterFieldName')); return }
    const key = name.trim()
    if (commonConfig.value.common_used_fields[key]) {
      showToast(t('toast.commonFieldExists', { name: key }))
      return
    }
    const hadOrder = commonConfig.value.common_used_field_order !== undefined
    const oldOrder = hadOrder ? [...commonConfig.value.common_used_field_order!] : undefined
    executeCommand({
      label: t('history.addCommonField'),
      apply() {
        commonConfig.value!.common_used_fields[key] = {
          field_name: key,
          field_type: 'varchar',
          field_length: 255,
          not_null: false,
          primary_key: false,
          comment: ''
        }
        if (!commonConfig.value!.common_used_field_order) {
          commonConfig.value!.common_used_field_order = []
        }
        commonConfig.value!.common_used_field_order.push(key)
      },
      revert() {
        delete commonConfig.value!.common_used_fields[key]
        if (hadOrder) {
          commonConfig.value!.common_used_field_order = [...oldOrder!]
        } else {
          commonConfig.value!.common_used_field_order = undefined
        }
      },
      affectedFiles() {
        return [affectedCommon()]
      },
    })
    showToast(t('toast.commonFieldAdded'))
  }

  function deleteCommonUsedField(name: string) {
    if (!commonConfig.value) return
    if (!commonConfig.value.common_used_fields[name]) return
    // 检查是否有表正在引用此 common field
    const referencingTables: string[] = []
    for (const schema of schemas) {
      for (const table of schema.tables) {
        if (table.fields.some(f => f.use_common_used_fields && f.field_name === name)) {
          referencingTables.push(`${schema.schema}.${table.name}`)
        }
      }
    }
    if (referencingTables.length > 0) {
      if (!confirm(
        t('confirm.deleteCommonField', { name, refs: referencingTables.join('\n') })
      )) return
    }
    const deletedField = { ...commonConfig.value.common_used_fields[name] }
    const hadOrder = commonConfig.value.common_used_field_order !== undefined
    const oldOrder = hadOrder ? [...commonConfig.value.common_used_field_order!] : undefined
    executeCommand({
      label: t('history.deleteCommonField'),
      apply() {
        delete commonConfig.value!.common_used_fields[name]
        if (commonConfig.value!.common_used_field_order) {
          commonConfig.value!.common_used_field_order =
            commonConfig.value!.common_used_field_order.filter(k => k !== name)
          if (commonConfig.value!.common_used_field_order.length === 0) {
            commonConfig.value!.common_used_field_order = undefined
          }
        }
      },
      revert() {
        commonConfig.value!.common_used_fields[name] = { ...deletedField }
        if (hadOrder) {
          commonConfig.value!.common_used_field_order = [...oldOrder!]
        } else {
          commonConfig.value!.common_used_field_order = undefined
        }
      },
      affectedFiles() {
        return [affectedCommon()]
      },
    })
    showToast(t('toast.commonFieldDeleted'))
  }

  function updateCommonUsedFieldName(oldName: string, newName: string) {
    const trimmed = newName.trim()
    if (!trimmed || oldName === trimmed) return
    // 捕获命令执行前所有引用此 common field 的表的字段快照，用于完整回滚
    const affectedFields: { field: Field; oldName: string }[] = []
    for (const schema of schemas) {
      for (const table of schema.tables) {
        for (const field of table.fields) {
          if (field.use_common_used_fields && field.field_name === oldName) {
            affectedFields.push({ field, oldName: field.field_name })
          }
        }
      }
    }
    const hadOrder = commonConfig.value?.common_used_field_order !== undefined
    const oldOrder = hadOrder ? [...commonConfig.value!.common_used_field_order!] : undefined
    executeCommand({
      label: t('history.renameCommonField'),
      apply() {
        for (const { field } of affectedFields) {
          field.field_name = trimmed
        }
        if (commonConfig.value?.common_used_field_order) {
          const idx = commonConfig.value.common_used_field_order.indexOf(oldName)
          if (idx !== -1) commonConfig.value.common_used_field_order[idx] = trimmed
        }
      },
      revert() {
        for (const { field, oldName: prev } of affectedFields) {
          field.field_name = prev
        }
        if (hadOrder) {
          commonConfig.value!.common_used_field_order = [...oldOrder!]
        } else {
          commonConfig.value!.common_used_field_order = undefined
        }
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  /** 从有序数组重建 record，用于面板编辑后同步 */
  function rebuildCommonUsedFieldsFromArray(fields: Field[]) {
    if (!commonConfig.value) return
    const oldRecord = { ...commonConfig.value.common_used_fields }
    const oldOrder = commonConfig.value.common_used_field_order
      ? [...commonConfig.value.common_used_field_order] : undefined
    executeCommand({
      label: t('history.editCommonFields'),
      coalesceKey: 'rebuild-common-fields',
      apply() {
        const newRecord: Record<string, Field> = {}
        for (const field of fields) {
          newRecord[field.field_name] = field
        }
        commonConfig.value!.common_used_fields = newRecord
        commonConfig.value!.common_used_field_order = fields.map(f => f.field_name)
      },
      revert() {
        commonConfig.value!.common_used_fields = { ...oldRecord }
        commonConfig.value!.common_used_field_order = oldOrder ? [...oldOrder] : undefined
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  /** 获取有序的公共字段列表（遵循 common_used_field_order，回退到 Object.keys） */
  function getOrderedCommonUsedFields(): Field[] {
    if (!commonConfig.value) return []
    const record = commonConfig.value.common_used_fields
    const order = commonConfig.value.common_used_field_order
    if (order && order.length > 0) {
      return order.filter(k => record[k]).map(k => record[k]!)
    }
    // 回退：Object.keys（老数据无 order 数组时）
    return Object.keys(record).map(k => record[k]!)
  }

  // ===== Unified Types CRUD =====

  function addUnifiedType(name: string) {
    if (!commonConfig.value) return
    if (!name.trim()) { showToast(t('toast.unifiedTypeNameEmpty')); return }
    const key = name.trim()
    if (!commonConfig.value.unified_types) commonConfig.value.unified_types = []
    if (commonConfig.value.unified_types.some(ut => ut.name === key)) {
      showToast(t('toast.unifiedTypeExists', { name: key }))
      return
    }
    executeCommand({
      label: t('history.addUnifiedType'),
      apply() {
        if (!commonConfig.value!.unified_types) commonConfig.value!.unified_types = []
        commonConfig.value!.unified_types.push({
          name: key,
          description: '',
          quote_default: false,
          mysql: { type: 'VARCHAR', length: 255 },
          postgresql: { type: 'VARCHAR', length: 255 },
        })
      },
      revert() {
        const list = commonConfig.value?.unified_types
        if (list) {
          const idx = list.findIndex(ut => ut.name === key)
          if (idx !== -1) list.splice(idx, 1)
        }
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
    showToast(t('toast.unifiedTypeAdded'))
  }

  function deleteUnifiedType(idx: number) {
    if (!commonConfig.value?.unified_types) return
    const ut = commonConfig.value.unified_types[idx]
    if (!ut) return
    const removed = { ...ut }
    executeCommand({
      label: t('history.deleteUnifiedType'),
      apply() {
        if (commonConfig.value?.unified_types) {
          commonConfig.value.unified_types.splice(idx, 1)
        }
      },
      revert() {
        if (!commonConfig.value!.unified_types) commonConfig.value!.unified_types = []
        commonConfig.value!.unified_types.splice(idx, 0, { ...removed })
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
    showToast(t('toast.unifiedTypeDeleted'))
  }

  /** 重命名统一类型时同步更新所有引用该类型的字段 */
  function renameUnifiedType(oldName: string, newName: string) {
    if (oldName === newName || !oldName || !newName) return
    // 捕获命令执行前所有引用该统一类型的字段快照，用于完整回滚
    const affectedTableFields: { field: Field; oldName: string }[] = []
    for (const schema of schemas) {
      for (const table of schema.tables) {
        for (const field of table.fields) {
          if (field.unified_type === oldName) {
            affectedTableFields.push({ field, oldName: field.unified_type! })
          }
        }
      }
    }
    const affectedCommonFields: { field: Field; oldName: string }[] = []
    if (commonConfig.value?.common_used_fields) {
      for (const key of Object.keys(commonConfig.value.common_used_fields)) {
        const field = commonConfig.value.common_used_fields[key]!
        if (field?.unified_type === oldName) {
          affectedCommonFields.push({ field, oldName: field.unified_type! })
        }
      }
    }
    executeCommand({
      label: t('history.renameUnifiedType'),
      apply() {
        for (const { field } of affectedTableFields) field.unified_type = newName
        for (const { field } of affectedCommonFields) field.unified_type = newName
      },
      revert() {
        for (const { field, oldName: prev } of affectedTableFields) field.unified_type = prev
        for (const { field, oldName: prev } of affectedCommonFields) field.unified_type = prev
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  function rebuildUnifiedTypesFromArray(types: UnifiedTypeDefinition[]) {
    if (!commonConfig.value) return
    const oldTypes = commonConfig.value.unified_types ? [...commonConfig.value.unified_types] : undefined
    executeCommand({
      label: t('history.editUnifiedTypes'),
      coalesceKey: 'rebuild-unified-types',
      apply() {
        commonConfig.value!.unified_types = types
      },
      revert() {
        commonConfig.value!.unified_types = oldTypes ? [...oldTypes] : undefined
      },
      affectedFiles() {
        return [affectedCommon(), affectedSql()]
      },
    })
  }

  // ===== Import SQL =====

  /** 将解析后的表定义转换为项目的 Table 结构 */
  function parsedTableToTable(
    parsed: ParsedTable,
    dialect: SqlDialect,
    unifiedTypes: UnifiedTypeDefinition[],
  ): Table {
    const fields: Field[] = parsed.columns.map(col => {
      return convertColumnToField(col, dialect, unifiedTypes)
    })

    const indexes: Index[] = []

    // 处理单列主键：已在列上设置了 primary_key，多列主键作为索引
    const pkColumns = parsed.columns.filter(c => c.primaryKey)
    if (pkColumns.length > 1) {
      indexes.push({
        type: 'index',
        columns: pkColumns.map(c => ({ name: c.name })),
        mysql: { type: 'primary' },
        postgresql: { type: 'primary' },
      })
    }

    // 处理列级 UNIQUE：转为表级索引
    for (const col of parsed.columns) {
      if (col.unique) {
        // 检查是否已被表级约束覆盖
        const alreadyCovered = parsed.constraints.some(
          c => c.type === 'UNIQUE' && c.columns.length === 1 && c.columns[0]!.name === col.name,
        )
        if (!alreadyCovered) {
          indexes.push({
            name: `uk_${col.name}`,
            type: 'unique',
            columns: [{ name: col.name }],
          })
        }
      }
    }

    // 转换表级约束
    for (const constraint of parsed.constraints) {
      if (constraint.columns.length === 0) continue

      const index: Index = {
        type: 'index',
        columns: constraint.columns.map(c => ({
          name: c.name,
          sort_order: c.sortOrder,
        })),
      }

      if (constraint.name) {
        index.name = constraint.name
      }

      if (constraint.using) {
        index.using = constraint.using
      }

      if (constraint.comment) {
        index.comment = constraint.comment
      }

      // 根据约束类型设置方言覆盖
      if (constraint.type === 'PRIMARY_KEY') {
        if (constraint.columns.length === 1) {
          // 单列主键：已在列上设置，跳过
          continue
        }
        index.mysql = { type: 'primary' }
        index.postgresql = { type: 'primary' }
      } else if (constraint.type === 'UNIQUE') {
        index.type = 'unique'
      } else if (constraint.type === 'FULLTEXT') {
        index.mysql = { type: 'fulltext' }
      } else if (constraint.type === 'SPATIAL') {
        index.mysql = { type: 'spatial' }
      }

      indexes.push(index)
    }

    // 构建 Table 对象
    const table: Table = {
      name: parsed.name,
      comment: parsed.comment || parsed.options.comment || '',
      fields,
      indexes,
    }

    // MySQL 表配置
    if (dialect === 'mysql' && (parsed.options.engine || parsed.options.charset || parsed.options.collation)) {
      table.mysql = {}
      if (parsed.options.engine) table.mysql.mysql_engine = parsed.options.engine
      if (parsed.options.charset) table.mysql.mysql_charset = parsed.options.charset
      if (parsed.options.collation) table.mysql.mysql_collation = parsed.options.collation
    }

    // PostgreSQL SCHEMA 引用
    if (parsed.schema) {
      // 表名已包含在 parsed.name 中，不额外处理
    }

    return table
  }

  function openImportSqlModal(targetSchemaIdx?: number) {
    showImportSqlModal.value = true
    importSqlText.value = ''
    importSqlParsedTables.value = []
    importSqlErrors.value = []
    importSqlDialect.value = 'auto'
    importSqlDetectedSchema.value = null
    importSqlTargetMode.value = targetSchemaIdx !== undefined ? 'existing' : 'new'
    importSqlTargetSchemaIdx.value = targetSchemaIdx ?? -1
    importSqlNewSchemaName.value = 'imported'
    // 清空表名编辑
    for (const key of Object.keys(importSqlTableNameEdits)) {
      delete importSqlTableNameEdits[Number(key)]
    }
  }

  function parseImportSql() {
    const text = importSqlText.value.trim()
    if (!text) {
      importSqlParsedTables.value = []
      importSqlErrors.value = []
      importSqlDetectedSchema.value = null
      return
    }

    try {
      const result = parseCreateTableStatements(text)
      importSqlParsedTables.value = result.tables
      importSqlErrors.value = result.messages

      // 如果自动检测方言，使用检测结果
      if (importSqlDialect.value === 'auto') {
        const detected = detectDialect(text)
        if (detected !== 'unknown') {
          importSqlDialect.value = detected
        }
      }

      // 智能检测 SQL 中的 schema 并自动配置导入目标
      const parsedSchemas = new Set(
        result.tables
          .map(t => t.schema)
          .filter((s): s is string => !!s)
      )
      if (parsedSchemas.size > 0) {
        const sqlSchema = [...parsedSchemas][0]!
        importSqlDetectedSchema.value = sqlSchema
        // 尝试匹配已有 schema
        const existingIdx = schemas.findIndex(s => s.schema === sqlSchema)
        if (existingIdx >= 0) {
          importSqlTargetMode.value = 'existing'
          importSqlTargetSchemaIdx.value = existingIdx
        } else {
          importSqlTargetMode.value = 'new'
          importSqlNewSchemaName.value = sqlSchema
        }
      } else {
        importSqlDetectedSchema.value = null
      }
    } catch (e) {
      importSqlParsedTables.value = []
      importSqlErrors.value = [{
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
        line: 0,
        column: 0,
      }]
    }
  }

  async function confirmImportSql() {
    const dialect: SqlDialect = importSqlDialect.value === 'auto' ? 'mysql' : importSqlDialect.value
    const unifiedTypes = commonConfig.value?.unified_types ?? DEFAULT_UNIFIED_TYPES

    // 转换每个解析后的表（应用用户编辑的表名）
    const tables = importSqlParsedTables.value
      .filter(pt => pt.columns.length > 0 || pt.constraints.length > 0)
      .map((pt, i) => {
        const table = parsedTableToTable(pt, dialect, unifiedTypes)
        const editedName = importSqlTableNameEdits[i]
        if (editedName && editedName.trim()) {
          table.name = editedName.trim()
        }
        return table
      })

    if (tables.length === 0) {
      showToast(t('importSqlModal.noValidTables'))
      return
    }

    // 确定目标 schema
    if (importSqlTargetMode.value === 'new') {
      const name = importSqlNewSchemaName.value.trim() || 'imported'
      let finalName = name
      let counter = 1
      while (schemas.some(s => s.schema === finalName)) {
        finalName = `${name}_${counter}`
        counter++
      }
      schemas.push({ schema: finalName, tables })
      syncSchemaOrder()
      selectedSchemaIdx.value = schemas.length - 1
      selectedTableIdx.value = tables.length > 0 ? 0 : -1
    } else {
      const schema = schemas[importSqlTargetSchemaIdx.value]
      if (schema) {
        for (const table of tables) {
          let finalName = table.name
          let counter = 1
          while (schema.tables.some(t => t.name === finalName)) {
            finalName = `${table.name}_${counter}`
            counter++
          }
          table.name = finalName
          schema.tables.push(table)
        }
        selectedSchemaIdx.value = importSqlTargetSchemaIdx.value
        selectedTableIdx.value = schema.tables.length - tables.length
      }
    }

    showImportSqlModal.value = false
    showToast(t('importSqlModal.imported', { count: tables.length }))
    // 导入为低频批量操作，显式全量写盘（命令式按需写未覆盖此路径）
    await syncAllToDisk()
  }

  return {
    // State
    commonConfig,
    schemas,
    selectedSchemaIdx,
    selectedTableIdx,
    showCommonPanel,
    settingsTab,
    projectOpened,
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

    // Baselines / Migrations
    baselines,
    hasBaselines,
    migrations,
    selectedBaselineSnapshot,
    baselinePreviewLoading,
    loadBaselinesAndMigrations,
    createBaseline,
    deleteBaselineById,
    getBaselineSnapshot,
    previewBaselineById,
    clearBaselinePreview,
    computeDiff,
    createMigration,
    updateMigration,
    deleteMigrationById,
    previewMigrationDdl,
  }
})
