import { ref, reactive, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import type { CommonConfig, Schema, Table, Field, Index } from '@/types/schema'
import {
  openProjectFolder,
  writeCommonToHandle,
  writeSchemaToHandle,
  deleteSchemaFromHandle,
  writeSqlToOutput,
  readInitialDataFromHandle,
  writeInitialDataToHandle,
  deleteInitialDataFromHandle,
  parseFieldLengthInput
} from '@/utils/file-helpers'
import {
  generateSchemaMySQL,
  generateSchemaPostgreSQL
} from '@/utils/sql-generator'

export const useEditorStore = defineStore('editor', () => {
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
  const initialDataMap = reactive(new Map<string, Record<string, any>[]>())
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
          commonConfig.value = data
          console.log('[openProject] commonConfig set')
        }
      }

      // 加载 schema JSON
      schemas.length = 0
      for (const { name, data: raw } of result.schemaFiles) {
        const data = raw as any
        console.log(`[openProject] processing "${name}": schema="${data.schema}", tables=${Array.isArray(data.tables) ? data.tables.length : 'N/A'}`)
        if (!data.schema || !Array.isArray(data.tables)) {
          showToast(`Skipping ${name}: invalid format`)
          continue
        }
        data.tables.forEach((t: any) => {
          if (!t.indexes) t.indexes = []
          if (!t.fields) t.fields = []
        })
        schemas.push(data)
      }

      console.log('[openProject] schemas loaded:', schemas.length)

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
      showToast(`Opened ${parts.join(' + ')}`)

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

  // ===== Auto-sync (实时同步到本地文件) =====

  let _syncTimer: ReturnType<typeof setTimeout> | null = null
  let _autoSyncSetup = false

  function debouncedSync(delay = 400) {
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
      showToast('Failed to save changes')
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

      // 生成包含所有 schema 的汇总文件（按 schema 名字母序排列）
      if (allMysql.length > 0) {
        const sorted = allMysql.sort((a, b) => a.name.localeCompare(b.name))
        await writeSqlToOutput(rootDirHandle.value, 'mysql', '__all_schemas__.sql', sorted.map(s => s.sql).join('\n\n'))
      }
      if (allPgsql.length > 0) {
        const sorted = allPgsql.sort((a, b) => a.name.localeCompare(b.name))
        await writeSqlToOutput(rootDirHandle.value, 'postgresql', '__all_schemas__.sql', sorted.map(s => s.sql).join('\n\n'))
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
      for (const [key, rows] of initialDataMap.entries()) {
        const sep = key.indexOf('/')
        const schemaName = key.substring(0, sep)
        const tableName = key.substring(sep + 1)
        await writeInitialDataToHandle(rootDirHandle.value, schemaName, tableName, rows)
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
  function setInitialData(schemaName: string, tableName: string, rows: Record<string, any>[]) {
    const key = initialDataKey(schemaName, tableName)
    if (rows.length === 0) {
      initialDataMap.delete(key)
      initialDataDeletedKeys.add(key)
    } else {
      initialDataMap.set(key, rows)
      initialDataDeletedKeys.delete(key)
    }
  }

  function deleteInitialData(schemaName: string, tableName: string) {
    const key = initialDataKey(schemaName, tableName)
    initialDataMap.delete(key)
    initialDataDeletedKeys.add(key)
  }

  // ===== schema CRUD —— 留待下一轮对话实现 =====
  //
  // 设计思路：
  //   async function addSchema(name: string)
  //     - 创建空 Schema 对象，push 到 schemas[]
  //     - writeSchemaToHandle(schemaDirHandle, `${name}.json`, data)
  //     - 文件已通过 auto-sync 自动写入
  //
  //   async function deleteSchema(schemaIdx: number)
  //     - 从 schemas[] splice
  //     - deleteSchemaFromHandle(schemaDirHandle, `${name}.json`)
  //     - auto-sync 不再触发（schema 已从数组移除）
  //
  //   function renameSchema(schemaIdx: number, newName: string)
  //     - 删除旧文件，写入新文件
  //     - 更新 schema.schema = newName
  //
  // 这轮对话中暂不实现 UI，但以上注释方法为本轮预留了清晰的接口和状态

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
    showToast('Table added')
  }

  function deleteTable(schemaIdx: number, tableIdx: number) {
    const schema = schemas[schemaIdx]
    if (!schema) return
    const tableName = schema.tables[tableIdx]?.name
    if (!confirm(`Delete table "${tableName}"?`)) return
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
    showToast('Table deleted')
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
      if (!name) { showToast('Please select a common field'); return }
      // Check duplicate
      if (table.fields.some(f => f.field_name === name)) {
        showToast(`Field "${name}" already exists in this table`)
        return
      }
      table.fields.push({
        field_name: name,
        use_common_used_fields: true
      })
    } else {
      const name = newFieldName.value.trim()
      if (!name) { showToast('Please enter field name'); return }
      if (table.fields.some(f => f.field_name === name)) {
        showToast(`Field "${name}" already exists in this table`)
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
    showToast('Field added')
  }

  function deleteField(table: Table, fieldIdx: number) {
    const fieldName = table.fields[fieldIdx]?.field_name
    if (!fieldName) return
    if (!confirm(`Delete field "${fieldName}"?`)) return
    table.fields.splice(fieldIdx, 1)
    // Clean up comment_before_fields
    if (table.comment_before_fields && table.comment_before_fields[fieldName]) {
      delete table.comment_before_fields[fieldName]
      if (Object.keys(table.comment_before_fields).length === 0) {
        delete table.comment_before_fields
      }
    }
    showToast('Field deleted')
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
    showToast('Index added')
  }

  function deleteIndex(table: Table, indexIdx: number) {
    if (!confirm('Delete this index?')) return
    table.indexes.splice(indexIdx, 1)
    showToast('Index deleted')
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
    const data: any = {
      schema: schema.schema,
      tables: schema.tables.map(table => {
        const tableData: any = {
          name: table.name,
          comment: table.comment
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
          const mysqlData: any = {}
          if (table.mysql.mysql_engine) mysqlData.mysql_engine = table.mysql.mysql_engine
          if (table.mysql.mysql_charset) mysqlData.mysql_charset = table.mysql.mysql_charset
          if (table.mysql.mysql_collation) mysqlData.mysql_collation = table.mysql.mysql_collation
          if (Object.keys(mysqlData).length > 0) tableData.mysql = mysqlData
        }

        // fields
        tableData.fields = table.fields.map(field => {
          const f: any = { field_name: field.field_name }
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
          const idx: any = {}
          if (index.name) idx.name = index.name
          if (index.type) idx.type = index.type
          if (index.using) idx.using = index.using
          idx.columns = [...index.columns]
          if (index.pre_comment) idx.pre_comment = index.pre_comment
          if (index.mysql && Object.keys(index.mysql).length > 0) idx.mysql = { ...index.mysql }
          if (index.pgsql && Object.keys(index.pgsql).length > 0) idx.pgsql = { ...index.pgsql }
          return idx
        })

        return tableData
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
    syncAllToDisk,

    // Initial Data
    initialDataMap,
    initialDataKey,
    setInitialData,
    deleteInitialData,

    // Navigation
    selectTable,
    selectCommonConfig,

    // Table CRUD
    addTable,
    deleteTable,

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

    // Toast
    showToast
  }
})
