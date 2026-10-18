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

  /** Convert a parsed table definition into the project's Table structure. */
  function parsedTableToTable(
    parsed: ParsedTable,
    dialect: SqlDialect,
    unifiedTypes: UnifiedTypeDefinition[],
  ): Table {
    const fields: Field[] = parsed.columns.map(col => {
      return convertColumnToField(col, dialect, unifiedTypes)
    })

    const indexes: Index[] = []

    // Handle column-level UNIQUE: convert it into a table-level index
    for (const col of parsed.columns) {
      if (col.unique) {
        // Check whether a table-level constraint already covers it
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

    // Convert table-level constraints
    for (const constraint of parsed.constraints) {
      if (constraint.columns.length === 0) continue

      // Primary keys are carried only by field flags: the SQL generator always emits the PRIMARY KEY clause from field.primary_key
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

      // Set dialect overrides according to the constraint type
      if (constraint.type === 'UNIQUE') {
        index.type = 'unique'
      } else if (constraint.type === 'FULLTEXT') {
        index.mysql = { type: 'fulltext' }
      } else if (constraint.type === 'SPATIAL') {
        index.mysql = { type: 'spatial' }
      }

      indexes.push(index)
    }

    // Build the Table object
    const table: Table = {
      name: parsed.name,
      comment: parsed.comment || parsed.options.comment || '',
      fields,
      indexes,
    }

    // MySQL table options
    if (dialect === 'mysql' && (parsed.options.engine || parsed.options.charset || parsed.options.collation)) {
      table.mysql = {}
      if (parsed.options.engine) table.mysql.mysql_engine = parsed.options.engine
      if (parsed.options.charset) table.mysql.mysql_charset = parsed.options.charset
      if (parsed.options.collation) table.mysql.mysql_collation = parsed.options.collation
    }

    // PostgreSQL SCHEMA reference
    if (parsed.schema) {
      // The table name is already part of parsed.name, so nothing extra is done here
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
    // Clear table name edits
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

      // If detecting the dialect automatically, use the detection result
      if (importSqlDialect.value === 'auto') {
        const detected = detectDialect(text)
        if (detected !== 'unknown') {
          importSqlDialect.value = detected
        }
      }

      // Detect the schema in the SQL and configure the import target automatically
      const parsedSchemas = new Set(
        result.tables
          .map(t => t.schema)
          .filter((s): s is string => !!s)
      )
      if (parsedSchemas.size > 0) {
        const sqlSchema = [...parsedSchemas][0]!
        importSqlDetectedSchema.value = sqlSchema
        // Try to match an existing schema
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

  /** Avoid collisions with the original name, the sanitized disk name, and case variants; keep usable original SQL names. */
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

    // Read renames using the original parse indexes before filtering out invalid tables, so leading empty tables cannot shift edit indexes.
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
    // schema.json already occupies the sibling path, so it cannot be used as a table directory name.
    const used = new Set(['schema.json', ...(target?.tables.map(table => diskName(table.name)) ?? [])])
    for (const table of tables) table.name = importName(table.name, used, 'table')

    const schemaIndex = isNew ? schemas.length : targetIndex
    const tableIndex = target?.tables.length ?? 0
    const oldSchemaIndex = selectedSchemaIdx.value
    const oldTableIndex = selectedTableIdx.value
    // Parse results, edited input, and imported objects must all stay out of redo snapshots; identities are retained for later table commands.
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
      // Batch structural commands must not coalesce.
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
