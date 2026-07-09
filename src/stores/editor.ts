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
  openProjectFolder,
  isFileSystemAccessSupported,
  writeCommonToHandle,
  writeSchemaToHandle,
  deleteSchemaFromHandle,
  deleteSqlFromOutput,
  writeSqlToOutput,
  readInitialDataFromHandle,
  writeInitialDataToHandle,
  deleteInitialDataFromHandle,
  parseFieldLengthInput,
} from '@/utils/file-helpers'
import {
  generateSchemaMySQL,
  generateInitialDataAllMySQL,
} from '@/utils/sql-generator/mysql'
import {
  generateSchemaPostgreSQL,
  generateInitialDataAllPostgreSQL,
} from '@/utils/sql-generator/postgresql'
import { checkVersion, CURRENT_STRUCT_VERSION, upgradeSchemaData } from '@/utils/version-upgrader'
import { formatIndexColumn } from '@/utils/index-column-utils'
import { DEFAULT_UNIFIED_TYPES } from '@/utils/unified-types'
import { fmtPrePostSql, getGlobalPostSql, getGlobalPreSql, resolveFieldTypeForDialect } from '@/utils/sql-generator/shared'
import type { UnifiedTypeDefinition } from '@/types/schema'
import { parseCreateTableStatements, detectDialect, convertColumnToField } from '@/utils/sql-parser'
import type { ParsedTable, ParseMessage } from '@/utils/sql-parser'

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
  const schemaDirHandle = ref<any>(null)
  const projectOpened = ref(false)

  // Initial Data —— 独立存储在 initial-data/<schema>/<table>.json
  const initialDataMap = reactive(new Map<string, InitialData>())
  const initialDataDeletedKeys = reactive(new Set<string>())

  // ===== Import SQL State =====
  const showImportSqlModal = ref(false)
  const importSqlText = ref('')
  const importSqlDialect = ref<'auto' | 'mysql' | 'postgresql'>('auto')
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

  /** 选择项目文件夹并加载内容，之后所有编辑实时自动同步 */
  async function openProject() {
    if (!isFileSystemAccessSupported()) {
      // showToast(t('toast.browserNotSupported'))
      alert(t('toast.browserNotSupported'))
      return
    }
    try {
      const result = await openProjectFolder()
      console.log('[openProject] result.schemaFiles.length:', result.schemaFiles.length)
      console.log('[openProject] result.commonData:', !!result.commonData)

      rootDirHandle.value = result.rootHandle
      schemaDirHandle.value = result.schemaHandle

      const ok = await _loadProjectFromHandles(
        result.rootHandle,
        result.schemaHandle,
        result.commonData,
        result.schemaFiles,
      )
      if (!ok) return

      projectOpened.value = true

      const parts: string[] = []
      if (schemas.length > 0) parts.push(`${schemas.length} schema(s)`)
      if (commonConfig.value) parts.push('common.json')
      showToast(t('toast.opened', { summary: parts.join(' + ') }))

      setupAutoSync()
      await _startFileObserver()
    } catch {
      // User cancelled the directory picker — do nothing
    }
  }

  /** 接收拖入的文件夹 handle 直接打开项目（跳过目录选择器） */
  async function openProjectFromHandle(handle: FileSystemDirectoryHandle) {
    if (!isFileSystemAccessSupported()) {
      alert(t('toast.browserNotSupported'))
      return
    }
    try {
      const result = await openProjectFolder(handle)
      console.log('[openProjectFromHandle] result.schemaFiles.length:', result.schemaFiles.length)
      console.log('[openProjectFromHandle] result.commonData:', !!result.commonData)

      rootDirHandle.value = result.rootHandle
      schemaDirHandle.value = result.schemaHandle

      const ok = await _loadProjectFromHandles(
        result.rootHandle,
        result.schemaHandle,
        result.commonData,
        result.schemaFiles,
      )
      if (!ok) return

      projectOpened.value = true

      const parts: string[] = []
      if (schemas.length > 0) parts.push(`${schemas.length} schema(s)`)
      if (commonConfig.value) parts.push('common.json')
      showToast(t('toast.opened', { summary: parts.join(' + ') }))

      setupAutoSync()
      await _startFileObserver()
    } catch (e) {
      console.error('[openProjectFromHandle] Failed:', e)
      showToast(t('toast.dropNotSupported'))
    }
  }

  // ===== Close Project =====

  /** 关闭当前项目文件夹，清空所有编辑状态 */
  function closeProject() {
    _stopFileObserver()
    rootDirHandle.value = null
    schemaDirHandle.value = null
    projectOpened.value = false
    commonConfig.value = null
    schemas.length = 0
    initialDataMap.clear()
    initialDataDeletedKeys.clear()
    selectedSchemaIdx.value = -1
    selectedTableIdx.value = -1
    showCommonPanel.value = false
    expandedFields.clear()
    expandedIndexes.clear()
    if (_syncTimer) {
      clearTimeout(_syncTimer)
      _syncTimer = null
    }
    _autoSyncSetup = false
    showToast(t('toast.projectClosed'))
  }

  // ===== Shared: Load Project Data from Handles =====

  /**
   * 从 handles 和已解析数据加载项目全部状态（openProject / reloadFromDisk 共用核心）。
   * 调用前确保 rootDirHandle / schemaDirHandle 已设置。
   * 返回 false 表示版本检查未通过，调用方应中止后续操作。
   */
  async function _loadProjectFromHandles(
    rootHandle: FileSystemDirectoryHandle,
    schemaHandle: FileSystemDirectoryHandle,
    commonData: unknown | null,
    schemaFiles: { name: string; data: unknown }[],
  ): Promise<boolean> {
    // 清空内存状态（handle 引用保留）
    commonConfig.value = null
    schemas.length = 0
    initialDataMap.clear()
    initialDataDeletedKeys.clear()
    selectedSchemaIdx.value = -1
    selectedTableIdx.value = -1
    showCommonPanel.value = false
    expandedFields.clear()
    expandedIndexes.clear()

    // 加载 common.json
    if (commonData) {
      const data = commonData as any
      if (data.default_config && data.common_used_fields) {
        // 兼容旧 common.json 无 postgresql 配置
        if (!data.default_config.postgresql) {
          data.default_config.postgresql = { quote_identifiers: true }
        }
        commonConfig.value = data
        console.log('[openProject] commonConfig set')
      }
    }
    // 如果文件夹中没有 common.json 或数据无效，创建默认配置
    if (!commonConfig.value) {
      commonConfig.value = {
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
      console.log('[openProject] default commonConfig created')
    }

    // 版本检查
    const versionResult = checkVersion(commonConfig.value)
    if (!versionResult.ok) {
      alert(versionResult.error)
      return false
    }
    const needsUpgrade = versionResult.needsUpgrade

    // 加载 schema JSON
    for (const { name, data: raw } of schemaFiles) {
      const data = raw as any
      console.log(`[openProject] processing "${name}": schema="${data.schema}", tables=${Array.isArray(data.tables) ? data.tables.length : 'N/A'}`)
      if (!data.schema || !Array.isArray(data.tables)) {
        showToast(t('toast.skipping', { name }))
        continue
      }
      data.tables.forEach((t: any) => {
        if (!t.indexes) t.indexes = []
        if (!t.fields) t.fields = []
      })
      schemas.push(data)
    }

    console.log('[openProject] schemas loaded:', schemas.length)
    // 按 schema_order 排序（如果存在）
    applySchemaOrder()

    // 升级旧版数据结构
    if (needsUpgrade) {
      await upgradeSchemaData(schemas, versionResult.fromVersion!, commonConfig.value!, rootHandle)
      if (commonConfig.value) {
        commonConfig.value.struct_version = CURRENT_STRUCT_VERSION
      }
      // 升级后立即写盘（此时 auto-sync watcher 尚未 setup）
      await writeCommonToHandle(rootHandle, commonConfig.value!)
      for (const schema of schemas) {
        const data = buildSchemaExportData(schema)
        await writeSchemaToHandle(schemaHandle, `${schema.schema}.json`, data)
      }
      console.log('[openProject] schema data upgraded & saved to version', CURRENT_STRUCT_VERSION)
    }

    // 初始化 unified_types（若缺失或为空，则填充内置默认集）
    if (!commonConfig.value.unified_types || commonConfig.value.unified_types.length === 0) {
      commonConfig.value.unified_types = JSON.parse(JSON.stringify(DEFAULT_UNIFIED_TYPES))
    }

    // 加载 initial-data（迁移已在 upgradeSchemaData 中完成，文件均为完整对象格式）
    try {
      const initialDataFiles = await readInitialDataFromHandle(rootHandle)
      for (const { key, data } of initialDataFiles) {
        initialDataMap.set(key, data)
      }
      if (initialDataFiles.length > 0) {
        console.log(`[openProject] initial data loaded: ${initialDataFiles.length} file(s)`)
      }
    } catch (e) {
      console.warn('[openProject] failed to load initial data:', e)
    }

    // Select first schema automatically
    if (schemas.length > 0) {
      selectedSchemaIdx.value = 0
      selectedTableIdx.value = schemas[0]!.tables.length > 0 ? 0 : -1
    }

    return true
  }

  // ===== Reload from Disk =====

  /** 放弃网页中的编辑，从本地文件重新读取所有数据 */
  async function reloadFromDisk() {
    if (!rootDirHandle.value || !schemaDirHandle.value) return

    const rootH = rootDirHandle.value
    const schemaH = schemaDirHandle.value

    _enterWriteScope()
    _reloading = true
    if (_syncTimer) {
      clearTimeout(_syncTimer)
      _syncTimer = null
    }

    try {
      // 从磁盘读取 common.json
      let commonData: unknown | null = null
      try {
        const commonHandle = await rootH.getFileHandle('common.json')
        const file = await commonHandle.getFile()
        commonData = JSON.parse(await file.text())
      } catch {
        console.warn('[reloadFromDisk] Failed to read common.json, resetting to default')
      }

      // 从磁盘读取所有 schema JSON
      const schemaFiles: { name: string; data: unknown }[] = []
      for await (const entry of schemaH.values()) {
        const fHandle = entry as FileSystemFileHandle | FileSystemDirectoryHandle
        const fName: string = fHandle.name
        if (fName.endsWith('.json') && fHandle.kind === 'file') {
          try {
            const file = await fHandle.getFile()
            schemaFiles.push({ name: fName, data: JSON.parse(await file.text()) })
          } catch (e) {
            console.warn(`[reloadFromDisk] Failed to parse "${fName}":`, e)
          }
        }
      }

      const ok = await _loadProjectFromHandles(rootH, schemaH, commonData, schemaFiles)
      if (!ok) return

      projectOpened.value = true
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

        // 只关注 common.json、schemas/*、initial-data/*，忽略 output/ 等
        const relevantRecords = records.filter(r => {
          const path = r.relativePathComponents.join('/')
          return path === 'common.json' || path.startsWith('schemas/') || path.startsWith('initial-data/')
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

  // ===== Auto-sync (实时同步到本地文件) =====

  let _syncTimer: ReturnType<typeof setTimeout> | null = null
  let _autoSyncSetup = false
  let _reloading = false

  function debouncedSync(delay = 400) {
    if (_reloading) return
    if (_syncTimer) clearTimeout(_syncTimer)
    _syncTimer = setTimeout(() => syncAllToDisk(), delay)
  }

  async function syncAllToDisk() {
    if (!rootDirHandle.value || !schemaDirHandle.value) return
    _enterWriteScope()
    try {
      if (commonConfig.value) {
        await writeCommonToHandle(rootDirHandle.value, commonConfig.value)
      }
      for (const schema of schemas) {
        const data = buildSchemaExportData(schema)
        await writeSchemaToHandle(schemaDirHandle.value, `${schema.schema}.json`, data)
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
      // 写入所有有数据的条目
      for (const [key, initialData] of initialDataMap.entries()) {
        const sep = key.indexOf('/')
        const schemaName = key.substring(0, sep)
        const tableName = key.substring(sep + 1)
        await writeInitialDataToHandle(rootDirHandle.value, schemaName, tableName, initialData)
      }

      // 删除标记为已删除的文件
      for (const key of initialDataDeletedKeys) {
        const sep = key.indexOf('/')
        const schemaName = key.substring(0, sep)
        const tableName = key.substring(sep + 1)
        await deleteInitialDataFromHandle(rootDirHandle.value, schemaName, tableName)
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

  /** 将注释数组对齐到新的行数（截断多余或补 null） */
  function alignToLength<T>(arr: (T | null)[] | undefined, newLen: number): (T | null)[] {
    if (!arr) return Array(newLen).fill(null)
    if (arr.length >= newLen) return arr.slice(0, newLen)
    return [...arr, ...Array(newLen - arr.length).fill(null)]
  }

  function setInitialData(schemaName: string, tableName: string, rows: Record<string, any>[]) {
    const key = initialDataKey(schemaName, tableName)
    if ((rows?.length ?? 0) === 0) {
      // 保留有 pre_sql/post_sql 的条目，仅清空数据行
      const existing = initialDataMap.get(key)
      if (existing?.pre_sql || existing?.post_sql) {
        existing.rows = []
        existing.row_comments = undefined
        existing.field_comments = undefined
        existing.skip_rows = undefined
        return
      }
      initialDataMap.delete(key)
      initialDataDeletedKeys.add(key)
    } else {
      const existing = initialDataMap.get(key)
      const result: InitialData = { rows }
      // 保留已有注释，对齐到新行数
      if (existing?.row_comments) {
        result.row_comments = alignToLength(existing.row_comments, rows.length)
      }
      if (existing?.field_comments) {
        result.field_comments = alignToLength(existing.field_comments, rows.length)
      }
      if (existing?.skip_rows) {
        result.skip_rows = alignToLength(existing.skip_rows, rows.length)
      }
      if (existing?.pre_sql) {
        result.pre_sql = { ...existing.pre_sql }
      }
      if (existing?.post_sql) {
        result.post_sql = { ...existing.post_sql }
      }
      initialDataMap.set(key, result)
      initialDataDeletedKeys.delete(key)
    }
  }

  /** JSON 模式：直接设置完整 InitialData 对象 */
  function setInitialDataObject(schemaName: string, tableName: string, data: InitialData) {
    const key = initialDataKey(schemaName, tableName)
    if ((data.rows?.length ?? 0) === 0) {
      // 保留有 pre_sql/post_sql 的条目
      if (data.pre_sql || data.post_sql) {
        initialDataMap.set(key, data)
        initialDataDeletedKeys.delete(key)
      } else {
        initialDataMap.delete(key)
        initialDataDeletedKeys.add(key)
      }
    } else {
      initialDataMap.set(key, data)
      initialDataDeletedKeys.delete(key)
    }
  }

  function deleteInitialData(schemaName: string, tableName: string) {
    const key = initialDataKey(schemaName, tableName)
    initialDataMap.delete(key)
    initialDataDeletedKeys.add(key)
  }

  // ===== Initial Data Pre/Post SQL =====

  function setInitialDataPreSql(initialData: InitialData, dialect: 'mysql' | 'postgresql', val: string) {
    const trimmed = val.trim()
    if (!trimmed && !initialData.pre_sql) return
    if (!initialData.pre_sql) initialData.pre_sql = {}
    if (trimmed) {
      initialData.pre_sql[dialect] = trimmed
    } else {
      delete initialData.pre_sql[dialect]
    }
    if (initialData.pre_sql && !initialData.pre_sql.mysql && !initialData.pre_sql.postgresql) {
      delete initialData.pre_sql
    }
  }

  function setInitialDataPostSql(initialData: InitialData, dialect: 'mysql' | 'postgresql', val: string) {
    const trimmed = val.trim()
    if (!trimmed && !initialData.post_sql) return
    if (!initialData.post_sql) initialData.post_sql = {}
    if (trimmed) {
      initialData.post_sql[dialect] = trimmed
    } else {
      delete initialData.post_sql[dialect]
    }
    if (initialData.post_sql && !initialData.post_sql.mysql && !initialData.post_sql.postgresql) {
      delete initialData.post_sql
    }
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
    schemas.splice(toIdx, 0, schema)
    syncSchemaOrder()
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
    schemas.push(newSchema)
    syncSchemaOrder()
    selectedSchemaIdx.value = schemas.length - 1
    selectedTableIdx.value = -1
    showToast(t('toast.schemaCreated'))
  }

  async function deleteSchema(schemaIdx: number) {
    const schema = schemas[schemaIdx]
    if (!schema) return
    if (!confirm(t('confirm.deleteSchema', { name: schema.schema }))) return

    _enterWriteScope()
    try {
      // Clean up initial data
      for (const table of schema.tables) {
        const key = initialDataKey(schema.schema, table.name)
        if (initialDataMap.has(key)) {
          initialDataMap.delete(key)
          initialDataDeletedKeys.add(key)
        }
      }

      // Delete file from disk
      if (schemaDirHandle.value) {
        try {
          await deleteSchemaFromHandle(schemaDirHandle.value, `${schema.schema}.json`)
        } catch (e) {
          console.warn('Failed to delete schema file:', e)
        }
      }

      schemas.splice(schemaIdx, 1)
      syncSchemaOrder()

      // Delete SQL output files and regenerate aggregate files
      if (rootDirHandle.value) {
        const schemaName = schema.schema
        try {
          await deleteSqlFromOutput(rootDirHandle.value, 'mysql', `${schemaName}.sql`)
        } catch (e) {
          console.warn('Failed to delete mysql output:', e)
        }
        try {
          await deleteSqlFromOutput(rootDirHandle.value, 'postgresql', `${schemaName}.sql`)
        } catch (e) {
          console.warn('Failed to delete postgresql output:', e)
        }
        await syncSqlToOutput()
      }

      // Update selection
      if (schemas.length === 0) {
        selectedSchemaIdx.value = -1
        selectedTableIdx.value = -1
      } else if (selectedSchemaIdx.value >= schemas.length) {
        selectedSchemaIdx.value = schemas.length - 1
      }
      showToast(t('toast.schemaDeleted'))
    } finally {
      _leaveWriteScope()
    }
  }

  async function renameSchema(schemaIdx: number, newName: string) {
    const schema = schemas[schemaIdx]
    if (!schema) return
    newName = newName.trim()
    if (!newName) return
    if (schemas.some((s, i) => i !== schemaIdx && s.schema === newName)) {
      showToast(t('toast.schemaExists', { name: newName }))
      return
    }

    const oldName = schema.schema

    _enterWriteScope()
    try {
      // Delete old file from disk
      if (schemaDirHandle.value) {
        try {
          await deleteSchemaFromHandle(schemaDirHandle.value, `${oldName}.json`)
        } catch (e) {
          console.warn('Failed to delete old schema file:', e)
        }
      }

      // Delete old SQL output files
      if (rootDirHandle.value) {
        try {
          await deleteSqlFromOutput(rootDirHandle.value, 'mysql', `${oldName}.sql`)
        } catch (e) {
          console.warn('Failed to delete old mysql output:', e)
        }
        try {
          await deleteSqlFromOutput(rootDirHandle.value, 'postgresql', `${oldName}.sql`)
        } catch (e) {
          console.warn('Failed to delete old postgresql output:', e)
        }
      }

      schema.schema = newName
      syncSchemaOrder()

      // Update initial data keys and mark old files for deletion
      for (const table of schema.tables) {
        const oldKey = initialDataKey(oldName, table.name)
        const newKey = initialDataKey(newName, table.name)
        const data = initialDataMap.get(oldKey)
        if (data !== undefined) {
          initialDataMap.delete(oldKey)
          initialDataMap.set(newKey, data)
        }
        initialDataDeletedKeys.add(oldKey)
      }

      showToast(t('toast.schemaRenamed'))
    } finally {
      _leaveWriteScope()
    }
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
    schema.tables.push(newTable)
    selectTable(schemaIdx, schema.tables.length - 1)
    showToast(t('toast.tableAdded'))
  }

  function deleteTable(schemaIdx: number, tableIdx: number) {
    const schema = schemas[schemaIdx]
    if (!schema) return
    const tableName = schema.tables[tableIdx]?.name
    if (!confirm(t('confirm.deleteTable', { name: tableName }))) return
    schema.tables.splice(tableIdx, 1)
    // 清理初始数据
    if (tableName) {
      const key = initialDataKey(schema.schema, tableName)
      if (initialDataMap.has(key)) {
        initialDataMap.delete(key)
        initialDataDeletedKeys.add(key)
      }
    }
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
    schema.tables.splice(insertIdx, 0, table)

    // 保持选中跟随被移动的表
    if (selectedSchemaIdx.value === schemaIdx && selectedTableIdx.value === fromIdx) {
      selectedTableIdx.value = insertIdx
    }
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

    // 跨 schema 移动
    const [table] = fromSchema.tables.splice(fromTableIdx, 1)
    if (!table) return
    toSchema.tables.splice(toTableIdx, 0, table)

    // Update initial data key when table moves between schemas
    const oldKey = initialDataKey(fromSchema.schema, table.name)
    const newKey = initialDataKey(toSchema.schema, table.name)
    const data = initialDataMap.get(oldKey)
    if (data !== undefined) {
      initialDataMap.delete(oldKey)
      initialDataMap.set(newKey, data)
    }

    // 更新选中状态跟随表移动
    selectedSchemaIdx.value = toSchemaIdx
    selectedTableIdx.value = toTableIdx
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
  function getResolvedFieldTypeForDb(field: Field, dialect: 'mysql' | 'postgresql'): string {
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
    if (lines.length === 1) {
      if (lines[0] === '') {
        delete table.comment_before_table
      } else {
        table.comment_before_table = lines[0]
      }
    } else {
      table.comment_before_table = lines.map(line => line === '' ? null : line)
    }
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
    if (!text.trim()) {
      if (table.comment_before_fields) {
        delete table.comment_before_fields[fieldName]
        if (Object.keys(table.comment_before_fields).length === 0) {
          delete table.comment_before_fields
        }
      }
      return
    }
    if (!table.comment_before_fields) {
      table.comment_before_fields = {}
    }
    const lines = text.split('\n')
    if (lines.length === 1) {
      table.comment_before_fields[fieldName] = lines[0]!
    } else {
      table.comment_before_fields[fieldName] = lines.map(line => line === '' ? null : line)
    }
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
      let removedCount = 0
      for (let i = table.fields.length - 1; i >= 0; i--) {
        const f = table.fields[i]!
        if (f.use_common_used_fields && !selectedNames.includes(f.field_name)) {
          table.fields.splice(i, 1)
          removedCount++
        }
      }
      // 添加：勾选了但表中不存在的公共字段引用
      let addedCount = 0
      for (const name of selectedNames) {
        if (!existingCommonNames.includes(name)) {
          table.fields.push({
            field_name: name,
            use_common_used_fields: true
          })
          addedCount++
        }
      }
      if (addedCount > 0 && removedCount > 0) {
        showToast(t('toast.commonFieldsUpdated', { added: addedCount, removed: removedCount }))
      } else if (addedCount > 0) {
        showToast(t('toast.commonFieldsAdded', { n: addedCount }))
      } else if (removedCount > 0) {
        showToast(t('toast.commonFieldsRemoved', { n: removedCount }))
      } else {
        showToast(t('toast.noChange'))
      }
    } else {
      const name = newFieldName.value.trim()
      if (!name) { showToast(t('toast.pleaseEnterFieldName')); return }
      if (table.fields.some(f => f.field_name === name)) {
        showToast(t('toast.fieldExistsInTable', { name }))
        return
      }
      const ut = newFieldUnifiedType.value || undefined
      table.fields.push({
        field_name: name,
        unified_type: ut,
        // 仅当未选择 unified_type 时才预设 field_type/field_length
        field_type: ut ? undefined : 'varchar',
        field_length: ut ? undefined : 255,
        not_null: false,
        primary_key: false,
        comment: ''
      })
      showToast(t('toast.fieldAdded'))
    }

    showAddFieldModal.value = false
  }

  function directAddField(schemaIdx: number, tableIdx: number) {
    if (schemaIdx < 0 || tableIdx < 0) return
    const table = schemas[schemaIdx]?.tables[tableIdx]
    if (!table) return
    table.fields.push({
      field_name: '',
      field_type: 'varchar',
      field_length: 255,
      not_null: false,
      primary_key: false,
      comment: ''
    })
    showToast(t('toast.fieldAdded'))
  }

  function deleteField(table: Table, fieldIdx: number) {
    const fieldName = table.fields[fieldIdx]?.field_name
    // 空字段名直接删除，不限确认
    if (fieldName && !confirm(t('confirm.deleteField', { name: fieldName }))) return
    table.fields.splice(fieldIdx, 1)
    // Clean up comment_before_fields
    if (fieldName && table.comment_before_fields && table.comment_before_fields[fieldName]) {
      delete table.comment_before_fields[fieldName]
      if (Object.keys(table.comment_before_fields).length === 0) {
        delete table.comment_before_fields
      }
    }
    showToast(t('toast.fieldDeleted'))
  }

  function moveFieldUp(table: Table, fieldIdx: number) {
    if (fieldIdx <= 0) return
    const arr = table.fields;
    [arr[fieldIdx - 1], arr[fieldIdx]] = [arr[fieldIdx]!, arr[fieldIdx - 1]!]
  }

  function moveFieldDown(table: Table, fieldIdx: number) {
    if (fieldIdx >= table.fields.length - 1) return
    const arr = table.fields;
    [arr[fieldIdx], arr[fieldIdx + 1]] = [arr[fieldIdx + 1]!, arr[fieldIdx]!]
  }

  // ===== Index CRUD =====
  function addIndex(table: Table) {
    table.indexes.push({
      type: 'index',
      columns: [{ name: '' }],
      using: ''
    })
    showToast(t('toast.indexAdded'))
  }

  function deleteIndex(table: Table, indexIdx: number) {
    if (!confirm(t('confirm.deleteIndex'))) return
    table.indexes.splice(indexIdx, 1)
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
    index.columns = raw.map(s => ({ name: s }))
    if (index.columns.length === 0) {
      index.columns = [{ name: '' }]
    }
  }

  // ===== MySQL table override =====
  function getTableMysqlEngine(table: Table) {
    return table.mysql?.mysql_engine || ''
  }
  function getTableMysqlCharset(table: Table) {
    return table.mysql?.mysql_charset || ''
  }
  function getTableMysqlCollation(table: Table) {
    return table.mysql?.mysql_collation || ''
  }
  function setTableMysqlEngine(table: Table, val: string) {
    if (!table.mysql) table.mysql = {}
    table.mysql.mysql_engine = val || undefined
    cleanMysqlOverride(table)
  }
  function setTableMysqlCharset(table: Table, val: string) {
    if (!table.mysql) table.mysql = {}
    table.mysql.mysql_charset = val || undefined
    cleanMysqlOverride(table)
  }
  function setTableMysqlCollation(table: Table, val: string) {
    if (!table.mysql) table.mysql = {}
    table.mysql.mysql_collation = val || undefined
    cleanMysqlOverride(table)
  }
  function cleanMysqlOverride(table: Table) {
    if (table.mysql && Object.values(table.mysql).every(v => v === undefined || v === '')) {
      delete table.mysql
    }
  }

  // ===== Table Pre/Post SQL =====

  function setTablePreSql(table: Table, dialect: 'mysql' | 'postgresql', val: string) {
    const trimmed = val.trim()
    if (!trimmed && !table.pre_sql) return
    if (!table.pre_sql) table.pre_sql = {}
    if (trimmed) {
      table.pre_sql[dialect] = trimmed
    } else {
      delete table.pre_sql[dialect]
    }
    // 清理空对象
    if (table.pre_sql && !table.pre_sql.mysql && !table.pre_sql.postgresql) {
      delete table.pre_sql
    }
  }

  function setTablePostSql(table: Table, dialect: 'mysql' | 'postgresql', val: string) {
    const trimmed = val.trim()
    if (!trimmed && !table.post_sql) return
    if (!table.post_sql) table.post_sql = {}
    if (trimmed) {
      table.post_sql[dialect] = trimmed
    } else {
      delete table.post_sql[dialect]
    }
    if (table.post_sql && !table.post_sql.mysql && !table.post_sql.postgresql) {
      delete table.post_sql
    }
  }

  // ===== Schema Pre/Post SQL =====

  function setSchemaPreSql(schema: Schema, dialect: 'mysql' | 'postgresql', val: string) {
    const trimmed = val.trim()
    if (!trimmed && !schema.pre_sql) return
    if (!schema.pre_sql) schema.pre_sql = {}
    if (trimmed) {
      schema.pre_sql[dialect] = trimmed
    } else {
      delete schema.pre_sql[dialect]
    }
    if (schema.pre_sql && !schema.pre_sql.mysql && !schema.pre_sql.postgresql) {
      delete schema.pre_sql
    }
  }

  function setSchemaPostSql(schema: Schema, dialect: 'mysql' | 'postgresql', val: string) {
    const trimmed = val.trim()
    if (!trimmed && !schema.post_sql) return
    if (!schema.post_sql) schema.post_sql = {}
    if (trimmed) {
      schema.post_sql[dialect] = trimmed
    } else {
      delete schema.post_sql[dialect]
    }
    if (schema.post_sql && !schema.post_sql.mysql && !schema.post_sql.postgresql) {
      delete schema.post_sql
    }
  }

  // ===== Global Pre/Post SQL =====

  function setGlobalPreSql(dialect: 'mysql' | 'postgresql', val: string) {
    if (!commonConfig.value) return
    const trimmed = val.trim()
    if (dialect === 'mysql') {
      commonConfig.value.default_config.mysql.pre_sql = trimmed || undefined
    } else {
      if (!commonConfig.value.default_config.postgresql) {
        commonConfig.value.default_config.postgresql = { quote_identifiers: true }
      }
      commonConfig.value.default_config.postgresql.pre_sql = trimmed || undefined
    }
  }

  function setGlobalPostSql(dialect: 'mysql' | 'postgresql', val: string) {
    if (!commonConfig.value) return
    const trimmed = val.trim()
    if (dialect === 'mysql') {
      commonConfig.value.default_config.mysql.post_sql = trimmed || undefined
    } else {
      if (!commonConfig.value.default_config.postgresql) {
        commonConfig.value.default_config.postgresql = { quote_identifiers: true }
      }
      commonConfig.value.default_config.postgresql.post_sql = trimmed || undefined
    }
  }

  // ===== Field mysql/postgresql override helpers =====
  function ensureFieldOverride(field: Field, db: 'mysql' | 'postgresql') {
    if (!field[db]) field[db] = {}
    return field[db]!
  }

  function getFieldOverrideValue(field: Field, db: 'mysql' | 'postgresql', key: string) {
    return (field[db] as any)?.[key] ?? ''
  }

  function setFieldOverrideValue(field: Field, db: 'mysql' | 'postgresql', key: string, val: any) {
    const override = ensureFieldOverride(field, db)
    if (val === '' || val === null || val === undefined) {
      delete override[key as keyof typeof override]
    } else {
      if (key === 'field_length' || key === 'field_scale') {
        (override as any)[key] = parseFieldLengthInput(val)
      } else {
        (override as any)[key] = val
      }
    }
    // Clean up empty override object
    if (field[db] && Object.keys(field[db]!).length === 0) {
      delete field[db]
    }
  }

  // ===== Index mysql/postgresql override helpers =====
  function getIndexOverrideValue(index: Index, db: 'mysql' | 'postgresql', key: string) {
    return (index[db] as any)?.[key] ?? ''
  }

  function setIndexOverrideValue(index: Index, db: 'mysql' | 'postgresql', key: string, val: any) {
    if (!index[db]) (index as any)[db] = {}
    if (val === '' || val === null || val === undefined) {
      delete (index[db] as any)[key]
    } else {
      (index[db] as any)[key] = val
    }
    if (index[db] && Object.keys(index[db]!).length === 0) {
      delete index[db]
    }
  }

  // ===== Build export data =====
  function buildSchemaExportData(schema: Schema) {
    const data: Schema = {
      schema: schema.schema,
      tables: schema.tables.map(table => {
        const tableData: Partial<Table> = {
          name: table.name,
          comment: table.comment,
        }

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
      })
    }
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
    if (commonConfig.value) commonConfig.value.default_config.mysql.table.mysql_engine = val
  }
  function setCommonMysqlCharset(val: string) {
    if (commonConfig.value) commonConfig.value.default_config.mysql.table.mysql_charset = val
  }
  function setCommonMysqlCollation(val: string) {
    if (commonConfig.value) commonConfig.value.default_config.mysql.table.mysql_collation = val
  }

  function getCommonPostgresqlQuoteIdentifiers(): boolean {
    return commonConfig.value?.default_config?.postgresql?.quote_identifiers ?? true
  }
  function setCommonPostgresqlQuoteIdentifiers(val: boolean) {
    if (commonConfig.value) {
      if (!commonConfig.value.default_config.postgresql) {
        commonConfig.value.default_config.postgresql = { quote_identifiers: true }
      }
      commonConfig.value.default_config.postgresql.quote_identifiers = val
    }
  }

  function getTableDdlMode(): TableDdlMode {
    return commonConfig.value?.default_config?.table_ddl_mode ?? 'drop_and_create'
  }
  function setTableDdlMode(val: TableDdlMode) {
    if (commonConfig.value) {
      commonConfig.value.default_config.table_ddl_mode = val === 'drop_and_create' ? undefined : val
    }
  }

  function getCommonTypeCase(): TypeCaseMode {
    return commonConfig.value?.type_case ?? 'keep'
  }
  function setCommonTypeCase(val: TypeCaseMode) {
    if (commonConfig.value) {
      commonConfig.value.type_case = val
    }
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
    commonConfig.value.common_used_fields[key] = {
      field_name: key,
      field_type: 'varchar',
      field_length: 255,
      not_null: false,
      primary_key: false,
      comment: ''
    }
    // 同步维护顺序数组
    if (!commonConfig.value.common_used_field_order) {
      commonConfig.value.common_used_field_order = []
    }
    commonConfig.value.common_used_field_order.push(key)
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
    delete commonConfig.value.common_used_fields[name]
    // 同步维护顺序数组
    if (commonConfig.value.common_used_field_order) {
      commonConfig.value.common_used_field_order = commonConfig.value.common_used_field_order.filter(k => k !== name)
      if (commonConfig.value.common_used_field_order.length === 0) {
        commonConfig.value.common_used_field_order = undefined
      }
    }
    showToast(t('toast.commonFieldDeleted'))
  }

  function updateCommonUsedFieldName(oldName: string, newName: string) {
    const trimmed = newName.trim()
    if (!trimmed || oldName === trimmed) return
    // 更新所有引用此 common field 的表
    for (const schema of schemas) {
      for (const table of schema.tables) {
        for (const field of table.fields) {
          if (field.use_common_used_fields && field.field_name === oldName) {
            field.field_name = trimmed
          }
        }
      }
    }
    // 同步维护顺序数组中的名称
    if (commonConfig.value?.common_used_field_order) {
      const idx = commonConfig.value.common_used_field_order.indexOf(oldName)
      if (idx !== -1) {
        commonConfig.value.common_used_field_order[idx] = trimmed
      }
    }
  }

  /** 从有序数组重建 record，用于面板编辑后同步 */
  function rebuildCommonUsedFieldsFromArray(fields: Field[]) {
    if (!commonConfig.value) return
    const newRecord: Record<string, Field> = {}
    for (const field of fields) {
      newRecord[field.field_name] = field
    }
    commonConfig.value.common_used_fields = newRecord
    // 同步更新顺序数组，绕过 JS 对象对纯数字键的自动排序
    commonConfig.value.common_used_field_order = fields.map(f => f.field_name)
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
    commonConfig.value.unified_types.push({
      name: key,
      description: '',
      quote_default: false,
      mysql: { type: 'VARCHAR', length: 255 },
      postgresql: { type: 'VARCHAR', length: 255 },
    })
    showToast(t('toast.unifiedTypeAdded'))
  }

  function deleteUnifiedType(idx: number) {
    if (!commonConfig.value?.unified_types) return
    const ut = commonConfig.value.unified_types[idx]
    if (!ut) return
    commonConfig.value.unified_types.splice(idx, 1)
    showToast(t('toast.unifiedTypeDeleted'))
  }

  /** 重命名统一类型时同步更新所有引用该类型的字段 */
  function renameUnifiedType(oldName: string, newName: string) {
    if (oldName === newName || !oldName || !newName) return
    // 遍历所有 schema 中的表字段
    for (const schema of schemas) {
      for (const table of schema.tables) {
        for (const field of table.fields) {
          if (field.unified_type === oldName) {
            field.unified_type = newName
          }
        }
      }
    }
    // 遍历 common_used_fields
    if (commonConfig.value?.common_used_fields) {
      for (const key of Object.keys(commonConfig.value.common_used_fields)) {
        const field = commonConfig.value.common_used_fields[key]
        if (field?.unified_type === oldName) {
          field.unified_type = newName
        }
      }
    }
  }

  function rebuildUnifiedTypesFromArray(types: UnifiedTypeDefinition[]) {
    if (!commonConfig.value) return
    commonConfig.value.unified_types = types
  }

  // ===== Import SQL =====

  /** 将解析后的表定义转换为项目的 Table 结构 */
  function parsedTableToTable(
    parsed: ParsedTable,
    dialect: 'mysql' | 'postgresql',
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

  function confirmImportSql() {
    const dialect: 'mysql' | 'postgresql' = importSqlDialect.value === 'auto' ? 'mysql' : importSqlDialect.value
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
  }

  return {
    // State
    commonConfig,
    schemas,
    selectedSchemaIdx,
    selectedTableIdx,
    showCommonPanel,
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

    // Initial Data
    initialDataMap,
    initialDataKey,
    setInitialData,
    setInitialDataObject,
    deleteInitialData,

    // Initial Data Pre/Post SQL
    setInitialDataPreSql,
    setInitialDataPostSql,

    // Navigation
    selectTable,
    selectCommonConfig,
    selectSchemaOnly,

    // Schema CRUD
    addSchema,
    deleteSchema,
    renameSchema,
    moveSchema,

    // Table CRUD
    addTable,
    deleteTable,
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
    showToast
  }
})
