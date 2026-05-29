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
} from '@/types/schema'
import {
  openProjectFolder,
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

  // File System Access API handles (in-memory, same session)
  const rootDirHandle = ref<any>(null)
  const schemaDirHandle = ref<any>(null)
  const projectOpened = ref(false)

  // Initial Data —— 独立存储在 initial-data/<schema>/<table>.json
  const initialDataMap = reactive(new Map<string, InitialData>())
  const initialDataDeletedKeys = reactive(new Set<string>())

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
    try {
      const result = await openProjectFolder()
      console.log('[openProject] result.schemaFiles.length:', result.schemaFiles.length)
      console.log('[openProject] result.commonData:', !!result.commonData)

      rootDirHandle.value = result.rootHandle
      schemaDirHandle.value = result.schemaHandle

      // 加载 common.json
      if (result.commonData) {
        const data = result.commonData as any
        if (data.default_config && data.common_used_fields) {
          // 兼容旧 common.json 无 pgsql 配置
          if (!data.default_config.pgsql) {
            data.default_config.pgsql = { quote_identifiers: true }
          }
          commonConfig.value = data
          console.log('[openProject] commonConfig set')
        }
      }
      // 如果文件夹中没有 common.json，创建默认配置
      if (!commonConfig.value) {
        commonConfig.value = {
          default_config: {
            mysql: {
              database: {},
              table: {
                mysql_engine: 'InnoDB',
                mysql_charset: 'utf8mb4',
                mysql_collation: 'utf8mb4_0900_ai_ci',
              }
            },
            pgsql: {
              quote_identifiers: true,
            }
          },
          common_used_fields: {}
        }
        console.log('[openProject] default commonConfig created')
      }

      // 加载 schema JSON
      schemas.length = 0
      for (const { name, data: raw } of result.schemaFiles) {
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

      // 加载 initial-data
      initialDataMap.clear()
      initialDataDeletedKeys.clear()
      try {
        const initialDataFiles = await readInitialDataFromHandle(rootDirHandle.value)
        for (const { key, data } of initialDataFiles) {
          initialDataMap.set(key, data)
        }
        if (initialDataFiles.length > 0) {
          console.log(`[openProject] initial data loaded: ${initialDataFiles.length} file(s)`)
        }
      } catch (e) {
        console.warn('[openProject] failed to load initial data:', e)
      }

      projectOpened.value = true

      const parts: string[] = []
      if (schemas.length > 0) parts.push(`${schemas.length} schema(s)`)
      if (commonConfig.value) parts.push('common.json')
      showToast(t('toast.opened', { summary: parts.join(' + ') }))

      // Select first schema automatically
      if (schemas.length > 0) {
        selectedSchemaIdx.value = 0
        selectedTableIdx.value = schemas[0]!.tables.length > 0 ? 0 : -1
      }

      setupAutoSync()
    } catch {
      // User cancelled the directory picker — do nothing
    }
  }

  // ===== Reload from Disk =====

  /** 放弃网页中的编辑，从本地文件重新读取所有数据 */
  async function reloadFromDisk() {
    if (!rootDirHandle.value || !schemaDirHandle.value) return

    _reloading = true
    if (_syncTimer) {
      clearTimeout(_syncTimer)
      _syncTimer = null
    }

    try {
      // 重新读取 common.json
      try {
        const commonHandle = await rootDirHandle.value.getFileHandle('common.json')
        const file = await commonHandle.getFile()
        const data = JSON.parse(await file.text())
        if (data.default_config && data.common_used_fields) {
          // 兼容旧 common.json 无 pgsql 配置
          if (!data.default_config.pgsql) {
            data.default_config.pgsql = { quote_identifiers: true }
          }
          commonConfig.value = data as CommonConfig
        }
      } catch  {
        console.warn('[reloadFromDisk] Failed to read common.json, resetting to default')
        commonConfig.value = {
          default_config: {
            mysql: {
              database: {},
              table: {
                mysql_engine: 'InnoDB',
                mysql_charset: 'utf8mb4',
                mysql_collation: 'utf8mb4_0900_ai_ci',
              }
            },
            pgsql: {
              quote_identifiers: true
            }
          },
          common_used_fields: {}
        }
      }

      // 重新读取所有 schema JSON
      schemas.length = 0
      for await (const entry of schemaDirHandle.value.values()) {
        const fHandle = entry as FileSystemFileHandle | FileSystemDirectoryHandle
        const fName: string = fHandle.name
        if (fName.endsWith('.json') && fHandle.kind === 'file') {
          try {
            const file = await fHandle.getFile()
            const raw = JSON.parse(await file.text())
            if (raw.schema && Array.isArray(raw.tables)) {
              raw.tables.forEach((t: any) => {
                if (!t.indexes) t.indexes = []
                if (!t.fields) t.fields = []
              })
              schemas.push(raw)
            }
          } catch (e) {
            console.warn(`[reloadFromDisk] Failed to parse "${fName}":`, e)
          }
        }
      }

      // 按 schema_order 排序
      applySchemaOrder()

      // 重新读取 initial-data
      initialDataMap.clear()
      initialDataDeletedKeys.clear()
      try {
        const initialDataFiles = await readInitialDataFromHandle(rootDirHandle.value)
        for (const { key, data } of initialDataFiles) {
          initialDataMap.set(key, data)
        }
      } catch (e) {
        console.warn('[reloadFromDisk] Failed to load initial data:', e)
      }

      // 恢复选中状态
      if (schemas.length > 0) {
        selectedSchemaIdx.value = 0
        selectedTableIdx.value = schemas[0]!.tables.length > 0 ? 0 : -1
      } else {
        selectedSchemaIdx.value = -1
        selectedTableIdx.value = -1
      }

      showToast(t('toast.reloadedFromDisk'))
    } catch (e) {
      console.error('[reloadFromDisk] Failed:', e)
      showToast(t('toast.failedReloadFromDisk'))
    } finally {
      _reloading = false
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
    }
  }

  /** 生成 MySQL/PostgreSQL SQL 并写入 output/<dialect>/<schema>.sql */
  async function syncSqlToOutput() {
    if (!rootDirHandle.value) return
    try {
      const allMysql: { name: string; sql: string }[] = []
      const allPgsql: { name: string; sql: string }[] = []

      for (const schema of schemas) {
        const mysqlSql = generateSchemaMySQL(schema, commonConfig.value)
        await writeSqlToOutput(rootDirHandle.value, 'mysql', `${schema.schema}.sql`, mysqlSql)
        allMysql.push({ name: schema.schema, sql: mysqlSql })

        const pgsqlSql = generateSchemaPostgreSQL(schema, commonConfig.value)
        await writeSqlToOutput(rootDirHandle.value, 'postgresql', `${schema.schema}.sql`, pgsqlSql)
        allPgsql.push({ name: schema.schema, sql: pgsqlSql })
      }

      // 生成包含所有 schema 的汇总文件（按 schema_order 顺序排列）
      if (allMysql.length > 0) {
        await writeSqlToOutput(rootDirHandle.value, 'mysql', '__all_schemas__.sql', allMysql.map(s => s.sql).join('\n\n'))
      }
      if (allPgsql.length > 0) {
        await writeSqlToOutput(rootDirHandle.value, 'postgresql', '__all_schemas__.sql', allPgsql.map(s => s.sql).join('\n\n'))
      }

      // 生成 Initial Data 的 INSERT 语句汇总文件
      const initialDataMysql = generateInitialDataAllMySQL(schemas, initialDataMap, commonConfig.value)
      if (initialDataMysql.trim()) {
        await writeSqlToOutput(rootDirHandle.value, 'mysql', '__initial_data__.sql', initialDataMysql)
      }
      const initialDataPgsql = generateInitialDataAllPostgreSQL(schemas, initialDataMap, commonConfig.value)
      if (initialDataPgsql.trim()) {
        await writeSqlToOutput(rootDirHandle.value, 'postgresql', '__initial_data__.sql', initialDataPgsql)
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
    if (rows.length === 0) {
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
      initialDataMap.set(key, result)
      initialDataDeletedKeys.delete(key)
    }
  }

  /** JSON 模式：直接设置完整 InitialData 对象 */
  function setInitialDataObject(schemaName: string, tableName: string, data: InitialData) {
    const key = initialDataKey(schemaName, tableName)
    if (data.rows.length === 0) {
      initialDataMap.delete(key)
      initialDataDeletedKeys.add(key)
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

    // Delete old file from disk
    if (schemaDirHandle.value) {
      try {
        await deleteSchemaFromHandle(schemaDirHandle.value, `${oldName}.json`)
      } catch (e) {
        console.warn('Failed to delete old schema file:', e)
      }
    }

    schema.schema = newName
    syncSchemaOrder()

    // Update initial data keys
    for (const table of schema.tables) {
      const oldKey = initialDataKey(oldName, table.name)
      const newKey = initialDataKey(newName, table.name)
      const data = initialDataMap.get(oldKey)
      if (data !== undefined) {
        initialDataMap.delete(oldKey)
        initialDataMap.set(newKey, data)
      }
    }

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
    showAddFieldModal.value = true
  }

  function confirmAddField() {
    const sIdx = addFieldSchemaIdx.value
    const tIdx = addFieldTableIdx.value
    if (sIdx < 0 || tIdx < 0) return

    const table = schemas[sIdx]?.tables[tIdx]
    if (!table) return

    if (addFieldMode.value === 'common') {
      const name = newFieldSelectCommon.value
      if (!name) { showToast(t('toast.pleaseSelectCommonField')); return }
      // Check duplicate
      if (table.fields.some(f => f.field_name === name)) {
        showToast(t('toast.fieldExistsInTable', { name }))
        return
      }
      table.fields.push({
        field_name: name,
        use_common_used_fields: true
      })
    } else {
      const name = newFieldName.value.trim()
      if (!name) { showToast(t('toast.pleaseEnterFieldName')); return }
      if (table.fields.some(f => f.field_name === name)) {
        showToast(t('toast.fieldExistsInTable', { name }))
        return
      }
      table.fields.push({
        field_name: name,
        field_type: 'varchar',
        field_length: 255,
        not_null: false,
        primary_key: false,
        comment: ''
      })
    }

    showAddFieldModal.value = false
    showToast(t('toast.fieldAdded'))
  }

  function deleteField(table: Table, fieldIdx: number) {
    const fieldName = table.fields[fieldIdx]?.field_name
    if (!fieldName) return
    if (!confirm(t('confirm.deleteField', { name: fieldName }))) return
    table.fields.splice(fieldIdx, 1)
    // Clean up comment_before_fields
    if (table.comment_before_fields && table.comment_before_fields[fieldName]) {
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
      columns: [''],
      using: ''
    })
    showToast(t('toast.indexAdded'))
  }

  function deleteIndex(table: Table, indexIdx: number) {
    if (!confirm(t('confirm.deleteIndex'))) return
    table.indexes.splice(indexIdx, 1)
    showToast(t('toast.indexDeleted'))
  }

  function indexColumnsText(index: Index) {
    return (index.columns || []).join(', ')
  }

  function setIndexColumns(index: Index, text: string) {
    index.columns = text.split(',').map(s => s.trim()).filter(s => s)
    if (index.columns.length === 0) {
      index.columns = ['']
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

  // ===== Field mysql/pgsql override helpers =====
  function ensureFieldOverride(field: Field, db: 'mysql' | 'pgsql') {
    if (!field[db]) field[db] = {}
    return field[db]!
  }

  function getFieldOverrideValue(field: Field, db: 'mysql' | 'pgsql', key: string) {
    return (field[db] as any)?.[key] ?? ''
  }

  function setFieldOverrideValue(field: Field, db: 'mysql' | 'pgsql', key: string, val: any) {
    const override = ensureFieldOverride(field, db)
    if (val === '' || val === null || val === undefined) {
      delete override[key as keyof typeof override]
    } else {
      if (key === 'field_length') {
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

  // ===== Index mysql/pgsql override helpers =====
  function getIndexOverrideValue(index: Index, db: 'mysql' | 'pgsql', key: string) {
    return (index[db] as any)?.[key] ?? ''
  }

  function setIndexOverrideValue(index: Index, db: 'mysql' | 'pgsql', key: string, val: any) {
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
            if (field.field_type !== undefined) f.field_type = field.field_type
            if (field.field_length !== undefined) f.field_length = field.field_length
            if (field.not_null !== undefined) f.not_null = field.not_null
            if (field.primary_key !== undefined) f.primary_key = field.primary_key
            if (field.default !== undefined) f.default = field.default
            if (field.comment !== undefined) f.comment = field.comment
            if (field.is_commented_out) f.is_commented_out = true
            // db overrides
            if (field.mysql && Object.keys(field.mysql).length > 0) f.mysql = { ...field.mysql }
            if (field.pgsql && Object.keys(field.pgsql).length > 0) f.pgsql = { ...field.pgsql }
          }
          return f
        })

        // indexes
        tableData.indexes = table.indexes.map(index => {
          const idx: Partial<Index> = {}
          if (index.name) idx.name = index.name
          if (index.type) idx.type = index.type
          if (index.using) idx.using = index.using
          idx.columns = [...index.columns]
          if (index.pre_comment) idx.pre_comment = index.pre_comment
          if (index.mysql && Object.keys(index.mysql).length > 0) idx.mysql = { ...index.mysql }
          if (index.pgsql && Object.keys(index.pgsql).length > 0) idx.pgsql = { ...index.pgsql }
          return idx as Index
        })

        return tableData as Table
      })
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

  function getCommonPgsqlQuoteIdentifiers(): boolean {
    return commonConfig.value?.default_config?.pgsql?.quote_identifiers ?? true
  }
  function setCommonPgsqlQuoteIdentifiers(val: boolean) {
    if (commonConfig.value) {
      if (!commonConfig.value.default_config.pgsql) {
        commonConfig.value.default_config.pgsql = { quote_identifiers: true }
      }
      commonConfig.value.default_config.pgsql.quote_identifiers = val
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
  }

  /** 从有序数组重建 record，用于面板编辑后同步 */
  function rebuildCommonUsedFieldsFromArray(fields: Field[]) {
    if (!commonConfig.value) return
    const newRecord: Record<string, Field> = {}
    for (const field of fields) {
      newRecord[field.field_name] = field
    }
    commonConfig.value.common_used_fields = newRecord
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

    // Computed
    currentSchema,
    currentTable,
    commonFieldNames,
    currentInitialDataKey,
    currentInitialData,

    // Project
    openProject,
    reloadFromDisk,
    syncAllToDisk,

    // Initial Data
    initialDataMap,
    initialDataKey,
    setInitialData,
    setInitialDataObject,
    deleteInitialData,

    // Navigation
    selectTable,
    selectCommonConfig,

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
    deleteField,
    moveFieldUp,
    moveFieldDown,

    // Index CRUD
    addIndex,
    deleteIndex,
    indexColumnsText,
    setIndexColumns,

    // Table MySQL
    getTableMysqlEngine,
    getTableMysqlCharset,
    getTableMysqlCollation,
    setTableMysqlEngine,
    setTableMysqlCharset,
    setTableMysqlCollation,

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
    getCommonPgsqlQuoteIdentifiers,
    setCommonPgsqlQuoteIdentifiers,

    // Common Used Fields CRUD
    addCommonUsedField,
    deleteCommonUsedField,
    updateCommonUsedFieldName,
    rebuildCommonUsedFieldsFromArray,

    // Toast
    showToast
  }
})
