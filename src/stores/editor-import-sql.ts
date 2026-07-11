import type { Ref } from 'vue'
import type { CommonConfig, Schema } from '@/types/schema'
import type { Table, Field, Index } from '@/types/schema'
import type { UnifiedTypeDefinition } from '@/types/schema'
import type { SqlDialect } from '@/utils/sql-generator/shared'
import { parseCreateTableStatements, detectDialect, convertColumnToField } from '@/utils/sql-parser'
import type { ParsedTable, ParseMessage } from '@/utils/sql-parser'
import { DEFAULT_UNIFIED_TYPES } from '@/utils/unified-types'

export interface ImportSqlDeps {
  showImportSqlModal: Ref<boolean>
  importSqlText: Ref<string>
  importSqlDialect: Ref<'auto' | SqlDialect>
  importSqlParsedTables: Ref<ParsedTable[]>
  importSqlErrors: Ref<ParseMessage[]>
  importSqlTargetMode: Ref<'new' | 'existing'>
  importSqlTargetSchemaIdx: Ref<number>
  importSqlNewSchemaName: Ref<string>
  importSqlDetectedSchema: Ref<string | null>
  importSqlTableNameEdits: Record<number, string>
  commonConfig: Ref<CommonConfig | null>
  schemas: Schema[]
  selectedSchemaIdx: Ref<number>
  selectedTableIdx: Ref<number>
  syncSchemaOrder: () => void
  syncAllToDisk: () => Promise<void>
  showToast: (msg: string) => void
  t: (key: string, options?: any) => string
}

export function createImportSqlActions(deps: ImportSqlDeps) {
  const {
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
  } = deps

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
    openImportSqlModal,
    parseImportSql,
    confirmImportSql,
  }
}
