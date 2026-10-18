import type { CommonConfig, Schema, Table, Field, InitialData, JsonObject } from '../../types/schema'
import { getTableColumnNames, renderCommentBeforeField, renderCommentBeforeTable, resolveField, resolveFieldTypeForDialect, resolveQuoteDefault, formatSqlDefault, getTablePreSql, getTablePostSql, getSchemaPreSql, getSchemaPostSql, fmtPrePostSql, getInitialDataPreSql, getInitialDataPostSql, filterInitialDataRows, buildFieldComment, resolveIndexName } from './shared'
import { splitColumnForSql } from '../index-column-utils'
import { resolveDialectOverride } from '../dialect-resolver'
import { resolveIndexLogicalDelete } from '../logical-delete'

/*
  SQL generator (SQLite dialect)
  Pure functions, no dependency on Node.js fs; runs in the browser

  Differences from MySQL / PostgreSQL:
  - No CREATE SCHEMA: the schema is only noted in a comment (it maps to the database file or an ATTACH alias)
  - No COMMENT syntax: table/field/index comments are all emitted as `--` comment lines
  - No PARTITION BY: partition settings are not used during generation
  - Foreign keys are toggled with PRAGMA foreign_keys (equivalent to MySQL's SET FOREIGN_KEY_CHECKS)
*/

// ===== Utility functions =====

/** Decide from commonConfig whether to double-quote SQLite identifiers (double quotes are SQLite's standard quoting character) */
function quoteIdent(name: string, commonConfig: CommonConfig | null): string {
  const shouldQuote = commonConfig?.default_config?.sqlite?.quote_identifiers ?? true
  return shouldQuote ? `"${name}"` : name
}

/** Build the index column list (including sort direction) */
function indexColumnList(columns: Table['indexes'][number]['columns'], commonConfig: CommonConfig | null): string {
  return columns.map(col => {
    const { name, sortPart } = splitColumnForSql(col, 'sqlite')
    return quoteIdent(name, commonConfig) + sortPart
  }).join(', ')
}

// ===== Table field definitions =====

function getFieldDefinitionSQLite(field: Field, commonConfig: CommonConfig | null): string {
  let fieldDef = quoteIdent(field.field_name, commonConfig)

  // Resolve the final type + length + scale through the unified type resolution chain
  const resolved = resolveFieldTypeForDialect(field, 'sqlite', commonConfig)
  const fieldType = resolved.type
  const fieldLength = resolved.length
  const fieldScale = resolved.scale

  // Resolve the default (bypasses unified_type to keep the field-level → dialect override chain)
  const defaultValue = resolveDialectOverride(field, 'sqlite', 'default')

  if (fieldType) {
    if (typeof fieldScale === 'number' && typeof fieldLength === 'number') {
      fieldDef += ` ${fieldType}(${fieldLength},${fieldScale})`
    } else if (typeof fieldLength === 'number') {
      fieldDef += ` ${fieldType}(${fieldLength})`
    } else {
      fieldDef += ` ${fieldType}`
    }
  }

  // NOT NULL
  if (field.not_null) {
    fieldDef += ' NOT NULL'
  }

  // DEFAULT
  if (defaultValue !== undefined) {
    if (typeof defaultValue === 'string' && (defaultValue === 'CURRENT_TIMESTAMP' || defaultValue.includes('CURRENT_TIMESTAMP'))) {
      fieldDef += ` DEFAULT ${defaultValue}`
    } else {
      const shouldQuote = resolveQuoteDefault(field, commonConfig)
      fieldDef += ` DEFAULT ${formatSqlDefault(defaultValue, shouldQuote)}`
    }
  }

  // SQLite has no field-level COMMENT syntax; the table builder emits comments as standalone `--` lines above the field definition

  if (field.is_commented_out) {
    fieldDef = `-- ${fieldDef}`
  }

  return fieldDef
}

// ===== Generate SQL for a single table =====

/**
 * Generate the CREATE TABLE SQL for a single table.
 * Unlike PostgreSQL, SQLite has no schema prefix (the schema maps to a database file), so no schemaName parameter is needed.
 */
export function generateTableSQLite(table: Table, commonConfig: CommonConfig | null): string {
  const qTableName = quoteIdent(table.name, commonConfig)

  let sql = ''

  sql += renderCommentBeforeTable(table.comment_before_table)

  sql += `-- ----------------------------\n`
  sql += `-- Table structure for ${table.name}\n`
  // SQLite has no table-level COMMENT syntax; the table comment goes inside the table header comment block
  if (table.comment) {
    sql += `-- ${table.comment}\n`
  }
  sql += `-- ----------------------------\n`

  // Table pre-SQL
  const preSql = getTablePreSql(table, 'sqlite')
  if (preSql) sql += fmtPrePostSql(preSql) + '\n'

  // DDL generation strategy: drop_and_create | create_if_not_exists | create
  const ddlMode = commonConfig?.default_config?.table_ddl_mode ?? 'drop_and_create'
  if (ddlMode === 'create_if_not_exists') {
    sql += `CREATE TABLE IF NOT EXISTS ${qTableName} (\n`
  } else if (ddlMode === 'create') {
    sql += `CREATE TABLE ${qTableName} (\n`
  } else {
    sql += `DROP TABLE IF EXISTS ${qTableName};\n`
    sql += `CREATE TABLE ${qTableName} (\n`
  }

  // Field definitions
  const fieldDefinitions = table.fields.map(field => {
    const fieldConfig = resolveField(field, commonConfig)
    let fieldDef = `  ${getFieldDefinitionSQLite(fieldConfig, commonConfig)}`

    // Field comments are emitted as standalone comment lines (SQLite has no COMMENT syntax)
    const finalComment = buildFieldComment(fieldConfig, 'sqlite')
    if (finalComment) {
      // When a comment spans multiple lines, prefix every line so the following SQL is not broken
      const commentLines = finalComment.split(/\r?\n/).map(l => (l ? `  -- ${l}` : '  --')).join('\n')
      fieldDef = `${commentLines}\n${fieldDef}`
    }

    // Check whether a comment needs to be added before the field
    if (table.comment_before_fields?.[field.field_name]) {
      fieldDef = renderCommentBeforeField(table.comment_before_fields[field.field_name]!) + fieldDef
    }

    return fieldDef
  })

  // Primary key (composite primary keys supported)
  const primaryKeyFields = table.fields.filter(field => {
    const fieldConfig = resolveField(field, commonConfig)
    return fieldConfig.primary_key
  })

  const indexDefinitions: string[] = []
  if (primaryKeyFields.length > 0) {
    const primaryKeyColumns = primaryKeyFields.map(field => quoteIdent(field.field_name, commonConfig)).join(', ')
    indexDefinitions.push(`  PRIMARY KEY (${primaryKeyColumns})`)
  }

  // UNIQUE indexes are defined inside the CREATE TABLE statement (SQLite supports named CONSTRAINT ... UNIQUE)
  // Exception: logical-delete-aware unique indexes need a WHERE clause, which a table-level CONSTRAINT UNIQUE
  // does not support, so they fall back to CREATE UNIQUE INDEX ... WHERE after the table (see the regular index loop below)
  table.indexes.forEach(index => {
    const indexType = resolveDialectOverride(index, 'sqlite', 'type', index.type)
    if (indexType === 'unique' && !resolveIndexLogicalDelete(index, table, 'sqlite', commonConfig)) {
      const indexName = resolveIndexName(index, 'sqlite', table.name)!
      let def = `  CONSTRAINT ${quoteIdent(indexName, commonConfig)} UNIQUE (${indexColumnList(index.columns, commonConfig)})`
      // SQLite has no COMMENT ON INDEX; index comments are emitted as comment lines
      if (index.comment) {
        def = `  -- ${index.comment}\n${def}`
      }
      indexDefinitions.push(def)
    }
  })

  sql += fieldDefinitions.join(',\n')
  if (indexDefinitions.length > 0) {
    sql += ',\n\n  -- 主键与索引\n'
    sql += indexDefinitions.join(',\n')
  }
  sql += '\n);\n\n'

  // Regular indexes are defined below the CREATE TABLE statement
  // Logical-delete-aware unique indexes are also emitted here: a partial unique index cannot be written as an inline CONSTRAINT
  let hasCreateIndexSql = false
  table.indexes.forEach(index => {
    const indexType = resolveDialectOverride(index, 'sqlite', 'type', index.type)
    const logicalDelete = indexType === 'unique'
      ? resolveIndexLogicalDelete(index, table, 'sqlite', commonConfig)
      : null

    if ((indexType !== 'unique' && (indexType || index.columns)) || logicalDelete) {
      if (index.pre_comment) {
        sql += `-- ${index.pre_comment}\n`
      }
      if (index.comment) {
        sql += `-- ${index.comment}\n`
      }
      // // Partial unique index: documents why it is not declared inline (table-level UNIQUE constraints do not support WHERE)
      // if (logicalDelete) {
      //   sql += `-- 部分唯一索引：${logicalDelete.predicate}\n`
      // }
      const indexName = resolveIndexName(index, 'sqlite', table.name)!
      const keyword = logicalDelete ? 'CREATE UNIQUE INDEX' : 'CREATE INDEX'
      const whereClause = logicalDelete ? ` WHERE ${logicalDelete.predicate}` : ''
      sql += `${keyword} ${quoteIdent(indexName, commonConfig)} ON ${qTableName} (${indexColumnList(index.columns, commonConfig)})${whereClause};\n`
      hasCreateIndexSql = true
    }
  })

  if (hasCreateIndexSql) {
    sql += '\n'
  }

  // Table post-SQL
  const postSql = getTablePostSql(table, 'sqlite')
  if (postSql) sql += '\n' + fmtPrePostSql(postSql)

  return sql
}

// ===== Generate SQL for the entire schema =====

export function generateSchemaSQLite(schema: Schema, commonConfig: CommonConfig | null): string {
  let sql = ''

  sql += [
    '/*',
    ' Source Server Type    : SQLite',
    ' Source Schema         : ' + schema.schema,
    '*/',
    '',
    'PRAGMA foreign_keys = OFF;',
    '',
    '',
  ].join('\n')

  // Schema pre-SQL
  const schemaPreSql = getSchemaPreSql(schema, 'sqlite')
  if (schemaPreSql) sql += fmtPrePostSql(schemaPreSql) + '\n'

  // SQLite has no CREATE SCHEMA: the schema maps to a database file (or ATTACH alias) and is only noted in a comment
  sql += `-- Schema: ${schema.schema}\n\n`

  schema.tables.forEach(table => {
    sql += generateTableSQLite(table, commonConfig)
    sql += '\n\n'
  })

  sql = sql.trimEnd() + '\n'

  // Schema post-SQL
  const schemaPostSql = getSchemaPostSql(schema, 'sqlite')
  if (schemaPostSql) sql += fmtPrePostSql(schemaPostSql) + '\n'

  sql = sql + '\nPRAGMA foreign_keys = ON;' + '\n'

  return sql
}

// ===== Initial data INSERT statement generation =====

/** Format a JS value as a SQL literal (SQLite has no native boolean type; values are represented as 1/0) */
export function formatSqlValue(val: unknown, isExpr = false): string {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'boolean') {
    return val ? '1' : '0'
  }
  if (typeof val === 'number') {
    if (Number.isNaN(val) || !Number.isFinite(val)) return 'NULL'
    return String(val)
  }
  if (typeof val === 'string') {
    // Flagged as a SQL expression (e.g. CURRENT_TIMESTAMP()): emit as-is without quotes
    if (isExpr) return val
    // Escape single quotes: ' → ''
    return `'${val.replace(/'/g, "''")}'`
  }
  // Objects/arrays etc.: JSON-serialize, then treat as a string
  return `'${JSON.stringify(val).replace(/'/g, "''")}'`
}

/** Generate INSERT statements for a single table */
export function generateInitialDataSQLite(
  table: Table,
  rows: JsonObject[], // rows must already contain only valid data with skipped rows removed
  rowComments: (string | null)[] | undefined,
  commonConfig: CommonConfig | null,
  exprFields?: Record<string, boolean>[], // aligned with rows by index: marks a field value as a SQL expression (no quotes)
): string {
  const cols = getTableColumnNames(table, null)
  if (cols.length === 0 || rows.length === 0) return ''

  const qTable = quoteIdent(table.name, commonConfig)
  const colList = cols.map(c => quoteIdent(c, commonConfig)).join(', ')

  // Row comments (only non-null ones are emitted)
  let comments = ''
  if (rowComments) {
    for (let i = 0; i < rowComments.length; i++) {
      if (rowComments[i]) {
        comments += `-- Row ${i + 1}: ${rowComments[i]}\n`
      }
    }
  }

  const valueRows = rows.map((row, i) => {
    const expr = exprFields?.[i]
    const vals = cols.map(col => formatSqlValue(row[col], !!expr?.[col]))
    return `  (${vals.join(', ')})`
  })

  return `${comments}INSERT INTO ${qTable} (${colList}) VALUES\n${valueRows.join(',\n')};\n`
}

/** Generate the combined SQLite initial data INSERT script for all schemas */
export function generateInitialDataAllSQLite(
  schemas: Schema[],
  initialDataMap: Map<string, InitialData>,
  commonConfig: CommonConfig | null
): string {
  let sql = ''

  sql += '/*\n'
  sql += ' Source Server Type    : SQLite\n'
  sql += '*/\n'
  sql += '\n'
  sql += 'PRAGMA foreign_keys = OFF;\n'
  sql += '\n'

  for (const schema of schemas) {
    let isSchemaCommentHeaderPrinted = false
    for (const table of schema.tables) {
      const key = `${schema.schema}/${table.name}`
      const initData = initialDataMap.get(key)
      if (!initData) continue

      const initPreSql = getInitialDataPreSql(initData, 'sqlite')
      const initPostSql = getInitialDataPostSql(initData, 'sqlite')

      const hasPreSql = !!initPreSql
      const hasPostSql = !!initPostSql

      // Filter out "do not generate" rows first to obtain the valid data rows (no leftover skip logic)
      const filtered = filterInitialDataRows(initData.rows)

      // Skip when there are no valid rows and no pre/post SQL
      if (!filtered.hasRows && !hasPreSql && !hasPostSql) continue

      if (!isSchemaCommentHeaderPrinted) {
        sql += `-- ----------------------------\n`
        sql += `-- Initial data for schema ${schema.schema}\n`
        sql += `-- ----------------------------\n`
        sql += `\n`
        isSchemaCommentHeaderPrinted = true
      }

      // initial-data level pre-SQL
      if (hasPreSql) {
        sql += fmtPrePostSql(initPreSql) + '\n'
      }

      if (filtered.hasRows) {
        const qTable = quoteIdent(table.name, commonConfig)
        sql += `-- Insert data into ${qTable}\n`
        sql += generateInitialDataSQLite(table, filtered.rows, filtered.rowComments, commonConfig, filtered.exprFields)
        sql += '\n'
      }

      // initial-data level post-SQL
      if (hasPostSql) {
        sql += fmtPrePostSql(initPostSql) + '\n'
      }
    }
  }

  sql += '\nPRAGMA foreign_keys = ON;\n'
  return sql
}
