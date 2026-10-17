import { toRaw, type Ref } from 'vue'
import type { CommonConfig, Schema } from 'schema-editor-core/types/schema'
import type { Table, Field, Index } from 'schema-editor-core/types/schema'
import type { UnifiedTypeDefinition } from 'schema-editor-core/types/schema'
import type { SqlDialect } from 'schema-editor-core/utils/sql-generator/shared'
import { parseCreateTableStatements, detectDialect, convertColumnToField } from 'schema-editor-core/utils/sql-parser'
import type { ParsedTable, ParseMessage } from 'schema-editor-core/utils/sql-parser'
import { DEFAULT_UNIFIED_TYPES } from 'schema-editor-core/utils/unified-types'
import { affectedDatabase, affectedSchema, affectedSql, affectedTable, type Command } from 'schema-editor-core/core/history/command'
import { sanitizeName } from 'schema-editor-core/core/workspace/layout'
import { captureValue, cloneValue, diskName } from './editor-action-utils'

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
  executeCommand: (cmd: Command) => void
  showToast: (msg: string) => void
  t: (key: string, options?: Record<string, unknown>) => string
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
    executeCommand,
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

      // 主键只由字段标记承载：SQL 生成器一律从 field.primary_key 输出 PRIMARY KEY 子句
      if (constraint.type === 'PRIMARY_KEY') {
        for (const col of constraint.columns) {
          const field = fields.find(f => f.field_name === col.name)
          if (field) {
            field.primary_key = true
            field.not_null = true
          }
        }
        continue
      }

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
      if (constraint.type === 'UNIQUE') {
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

  /** 同时规避原名、sanitize 后磁盘名和大小写碰撞；保留可用的原始 SQL 名称。 */
  function importName(name: string, used: Set<string>, fallback: string): string {
    let base = name.trim() || fallback
    const disk = sanitizeName(base)
    if (!disk || disk === '.' || disk === '..' || /[. ]$/.test(disk)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(disk)) base = fallback
    let candidate = base
    for (let suffix = 1; used.has(diskName(candidate)); suffix++) candidate = `${base}_${suffix}`
    used.add(diskName(candidate))
    return candidate
  }

  function confirmImportSql() {
    const dialect: SqlDialect = importSqlDialect.value === 'auto' ? 'mysql' : importSqlDialect.value
    const unifiedTypes = commonConfig.value?.unified_types ?? DEFAULT_UNIFIED_TYPES

    // 先使用原始解析索引读取改名，再过滤无效表，避免前方空表造成编辑索引错位。
    const tables = importSqlParsedTables.value
      .map((pt, index) => ({ pt, editedName: importSqlTableNameEdits[index]?.trim() }))
      .filter(({ pt }) => pt.columns.length > 0 || pt.constraints.length > 0)
      .map(({ pt, editedName }) => {
        const table = parsedTableToTable(pt, dialect, unifiedTypes)
        if (editedName) table.name = editedName
        return table
      })

    if (tables.length === 0) {
      showToast(t('importSqlModal.noValidTables'))
      return
    }

    const isNew = importSqlTargetMode.value === 'new'
    const targetIndex = importSqlTargetSchemaIdx.value
    const target = !isNew && Number.isInteger(targetIndex) ? schemas[targetIndex] : undefined
    if (!isNew && !target) {
      showToast(t('importSqlModal.selectSchema'))
      return
    }

    const schemaName = isNew
      ? importName(importSqlNewSchemaName.value, new Set(schemas.map(schema => diskName(schema.schema))), 'imported')
      : target!.schema
    // schema.json 已占用同级路径，不能作为表目录名。
    const used = new Set(['schema.json', ...(target?.tables.map(table => diskName(table.name)) ?? [])])
    for (const table of tables) table.name = importName(table.name, used, 'table')

    const schemaIndex = isNew ? schemas.length : targetIndex
    const tableIndex = target?.tables.length ?? 0
    const oldSchemaIndex = selectedSchemaIdx.value
    const oldTableIndex = selectedTableIdx.value
    // 解析结果、编辑输入、导入后的对象都不能污染 redo 快照；保留身份供后续表命令使用。
    const imported = cloneValue(tables)
    const restoreTables = captureValue(imported)
    const newSchema: Schema = { schema: schemaName, tables: imported }
    const restoreSchema = captureValue(newSchema)
    const affected = [
      ...(isNew ? [affectedDatabase()] : []),
      affectedSchema(schemaName),
      ...imported.map(table => affectedTable(schemaName, table.name)),
      affectedSql(),
    ]

    executeCommand({
      label: t('importSqlModal.title'),
      // 批量结构命令禁止 coalesce。
      apply() {
        if (isNew) {
          schemas.splice(schemaIndex, 0, restoreSchema())
          syncSchemaOrder()
        } else {
          target!.tables.splice(tableIndex, 0, ...restoreTables())
        }
        selectedSchemaIdx.value = schemaIndex
        selectedTableIdx.value = tableIndex
      },
      revert() {
        if (isNew) {
          const index = schemas.findIndex(schema => toRaw(schema) === newSchema)
          if (index >= 0) schemas.splice(index, 1)
          syncSchemaOrder()
        } else {
          for (const table of imported) {
            const index = target!.tables.findIndex(candidate => toRaw(candidate) === toRaw(table))
            if (index >= 0) target!.tables.splice(index, 1)
          }
        }
        selectedSchemaIdx.value = oldSchemaIndex
        selectedTableIdx.value = oldTableIndex
      },
      affectedFiles: () => affected,
    })

    showImportSqlModal.value = false
    showToast(t('importSqlModal.imported', { count: tables.length }))
  }

  return {
    openImportSqlModal,
    parseImportSql,
    confirmImportSql,
  }
}
