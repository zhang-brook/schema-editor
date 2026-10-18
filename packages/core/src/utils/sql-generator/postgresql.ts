import type { CommonConfig, Schema, Table, Field, InitialData, InitialDataInsertMode, JsonObject } from '../../types/schema'
import { getTableColumnNames, getPrimaryKeyColumnNames, resolveInitialDataInsertMode, renderCommentBeforeField, renderCommentBeforeTable, resolveField, resolveFieldTypeForDialect, resolveQuoteDefault, formatSqlDefault, getTablePreSql, getTablePostSql, getSchemaPreSql, getSchemaPostSql, fmtPrePostSql, getInitialDataPreSql, getInitialDataPostSql, filterInitialDataRows, getTablePartitionClause, buildFieldComment, resolveIndexName } from './shared'
import { splitColumnForSql } from '../index-column-utils'
import { resolveDialectOverride } from '../dialect-resolver'
import { resolveIndexLogicalDelete } from '../logical-delete'

/*
  SQL generator
  Pure functions, no dependency on Node.js fs; runs in the browser
*/

// ===== Utility functions =====

/** Decide from commonConfig whether to double-quote PostgreSQL identifiers */
function quoteIdent(name: string, commonConfig: CommonConfig | null): string {
  const shouldQuote = commonConfig?.default_config?.postgresql?.quote_identifiers ?? true
  return shouldQuote ? `"${name}"` : name
}

/**
 * Comment text → PostgreSQL string literal: only single quotes are doubled, everything else is emitted as-is.
 *
 * The model stores real characters (a newline is a real newline, `C:\new` is a real backslash),
 * and PG standard strings (standard_conforming_strings=on) do not interpret backslashes and allow
 * line breaks, so writing them out verbatim yields exactly what the model holds — no escaping/decoding needed.
 *
 * `E'...'` is not used: that would make PG start interpreting backslashes, turning `C:\new` into a newline.
 */
function formatPgStringLiteral(text: string): string {
  return `'${text.replace(/'/g, "''")}'`
}

/** Prefix every line with `--`: commenting only the first line of a multi-line statement leaves the rest executable */
function commentOutLines(stmt: string): string {
  return stmt.split('\n').map(line => `-- ${line}`).join('\n')
}

// ===== Table field definitions =====

function getFieldDefinitionPostgreSQL(field: Field, commonConfig: CommonConfig | null): string {
  let fieldDef = quoteIdent(field.field_name, commonConfig)

  // Resolve the final type + length + scale through the unified type resolution chain
  const resolved = resolveFieldTypeForDialect(field, 'postgresql', commonConfig)
  const fieldType = resolved.type
  const fieldLength = resolved.length
  const fieldScale = resolved.scale

  // Resolve the default (bypasses unified_type to keep the field-level → dialect override chain)
  const defaultValue = resolveDialectOverride(field, 'postgresql', 'default')

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
    } else if (typeof defaultValue === 'boolean') {
      // Use uppercase TRUE / FALSE
      fieldDef += ` DEFAULT ${defaultValue ? 'TRUE' : 'FALSE'}`
    } else {
      const shouldQuote = resolveQuoteDefault(field, commonConfig)
      fieldDef += ` DEFAULT ${formatSqlDefault(defaultValue, shouldQuote)}`
    }
  }

  // PostgreSQL does not add COMMENT in the field definition; it uses COMMENT ON COLUMN statements.
  // For commented-out fields, the whole COMMENT ON COLUMN statement is emitted with a -- prefix (see generateTablePostgreSQL)

  if (field.is_commented_out) {
    fieldDef = `-- ${fieldDef}`
  }

  return fieldDef
}

// ===== Generate SQL for a single table =====

export function generateTablePostgreSQL(table: Table, schemaName: string, commonConfig: CommonConfig | null): string {
  const qSchemaName = quoteIdent(schemaName, commonConfig)
  const qTableName = quoteIdent(table.name, commonConfig)

  let sql = ''

  sql += renderCommentBeforeTable(table.comment_before_table)

  sql += `-- ----------------------------\n`
  sql += `-- Table structure for ${table.name}\n`
  sql += `-- ----------------------------\n`

  // Table pre-SQL
  const preSql = getTablePreSql(table, 'postgresql')
  if (preSql) sql += fmtPrePostSql(preSql) + '\n'

  // DDL generation strategy: drop_and_create | create_if_not_exists | create
  const ddlMode = commonConfig?.default_config?.table_ddl_mode ?? 'drop_and_create'
  if (ddlMode === 'create_if_not_exists') {
    sql += `CREATE TABLE IF NOT EXISTS ${qSchemaName}.${qTableName} (\n`
  } else if (ddlMode === 'create') {
    sql += `CREATE TABLE ${qSchemaName}.${qTableName} (\n`
  } else {
    sql += `DROP TABLE IF EXISTS ${qSchemaName}.${qTableName};\n`
    sql += `CREATE TABLE ${qSchemaName}.${qTableName} (\n`
  }

  // Field definitions
  const fieldDefinitions = table.fields.map(field => {
    const fieldConfig = resolveField(field, commonConfig)
    let fieldDef = `  ${getFieldDefinitionPostgreSQL(fieldConfig, commonConfig)}`

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

  // UNIQUE indexes are defined inside the CREATE TABLE statement
  // Exception: logical-delete-aware unique indexes need a WHERE clause, which PG table-level UNIQUE
  // constraints do not support, so they fall back to CREATE UNIQUE INDEX ... WHERE after the table (see the regular index loop below)
  table.indexes.forEach(index => {
    const indexType = resolveDialectOverride(index, 'postgresql', 'type', index.type)
    if (indexType === 'unique' && !resolveIndexLogicalDelete(index, table, 'postgresql', commonConfig)) {
      const indexName = resolveIndexName(index, 'postgresql', table.name)!
      indexDefinitions.push(`  CONSTRAINT ${quoteIdent(indexName, commonConfig)} UNIQUE (${index.columns.map(col => {
        const { name, sortPart } = splitColumnForSql(col, 'postgresql')
        return quoteIdent(name, commonConfig) + sortPart
      }).join(', ')})`)
    }
  })

  sql += fieldDefinitions.join(',\n')
  if (indexDefinitions.length > 0) {
    sql += ',\n\n  -- 主键与索引\n'
    sql += indexDefinitions.join(',\n')
  }
  sql += '\n)'
  // PARTITION BY is emitted after the closing parenthesis and before the semicolon
  const partitionClause = getTablePartitionClause(table, 'postgresql', commonConfig)
  if (partitionClause) {
    sql += ` ${partitionClause}`
  }
  sql += ';\n\n'

  // Regular indexes are defined below the CREATE TABLE statement
  // Logical-delete-aware unique indexes are also emitted here: a partial unique index cannot be written as an inline CONSTRAINT
  let hasCreateIndexSql = false
  table.indexes.forEach((index, _i) => {
    const indexType = resolveDialectOverride(index, 'postgresql', 'type', index.type)
    const logicalDelete = indexType === 'unique'
      ? resolveIndexLogicalDelete(index, table, 'postgresql', commonConfig)
      : null

    if ((indexType !== 'unique' && (indexType || index.columns)) || logicalDelete) {
      if (index.pre_comment) {
        sql += `-- ${index.pre_comment}\n`
      }
      const indexName = resolveIndexName(index, 'postgresql', table.name)!
      const keyword = logicalDelete ? 'CREATE UNIQUE INDEX' : 'CREATE INDEX'
      const whereClause = logicalDelete ? ` WHERE ${logicalDelete.predicate}` : ''
      // // Partial unique index: documents why it is not declared inline (table-level UNIQUE constraints do not support WHERE)
      // if (logicalDelete) {
      //   sql += `-- 部分唯一索引：${logicalDelete.predicate}\n`
      // }
      sql += `${keyword} ${quoteIdent(indexName, commonConfig)} ON ${qSchemaName}.${qTableName} (${index.columns.map(col => {
        const { name, sortPart } = splitColumnForSql(col, 'postgresql')
        return quoteIdent(name, commonConfig) + sortPart
      }).join(', ')})${whereClause};\n`
      // COMMENT ON INDEX (PostgreSQL)
      if (index.comment) {
        sql += `COMMENT ON INDEX ${qSchemaName}.${quoteIdent(indexName, commonConfig)} IS ${formatPgStringLiteral(index.comment)};\n`
      }
      hasCreateIndexSql = true
    }
  })

  if (hasCreateIndexSql) {
    sql += '\n'
  }

  // Table comment - emitted as a COMMENT ON TABLE statement
  sql += `COMMENT ON TABLE ${qSchemaName}.${qTableName} IS ${formatPgStringLiteral(table.comment)};\n`
  sql += '\n'

  // Field comments - emitted as COMMENT ON COLUMN statements.
  // Commented-out fields do not appear in the table structure, so their statements are kept whole with a -- prefix:
  // this keeps the syntax valid, and removing the prefix makes them directly executable; multi-line statements are prefixed on every line (see commentOutLines)
  table.fields.forEach(field => {
    const fieldConfig = resolveField(field, commonConfig)
    const finalComment = buildFieldComment(fieldConfig, 'postgresql')
    if (!finalComment) return
    const stmt = `COMMENT ON COLUMN ${qSchemaName}.${qTableName}.${quoteIdent(fieldConfig.field_name, commonConfig)} IS ${formatPgStringLiteral(finalComment)};`
    sql += `${fieldConfig.is_commented_out ? commentOutLines(stmt) : stmt}\n`
  })

  let isFirstIndex = true
  // Index comments — generate COMMENT ON INDEX for unique and named regular indexes
  table.indexes.forEach(index => {
    if (!index.comment) return
    const indexType = resolveDialectOverride(index, 'postgresql', 'type', index.type)
    // COMMENT ON INDEX for partial unique indexes is already emitted after CREATE UNIQUE INDEX; skip here to avoid duplicates
    if (indexType === 'unique' && !resolveIndexLogicalDelete(index, table, 'postgresql', commonConfig)) {
      if (isFirstIndex) {
        isFirstIndex = false
        sql += '\n'
      }
      const indexName = resolveIndexName(index, 'postgresql', table.name)!
      sql += `COMMENT ON INDEX ${qSchemaName}.${quoteIdent(indexName, commonConfig)} IS ${formatPgStringLiteral(index.comment)};\n`
    }
  })

  // Table post-SQL
  const postSql = getTablePostSql(table, 'postgresql')
  if (postSql) sql += '\n' + fmtPrePostSql(postSql)

  return sql
}

// ===== Generate SQL for the entire schema =====

export function generateSchemaPostgreSQL(schema: Schema, commonConfig: CommonConfig | null): string {
  const qSchema = quoteIdent(schema.schema, commonConfig)
  let sql = ''

  sql += [
    '/*',
    ' Source Server Type    : PostgreSQL',
    ' Source Schema         : ' + schema.schema,
    '*/',
    '',
    '',
  ].join('\n')

  // Schema pre-SQL
  const schemaPreSql = getSchemaPreSql(schema, 'postgresql')
  if (schemaPreSql) sql += fmtPrePostSql(schemaPreSql) + '\n'

  // Create schema
  sql += `DROP SCHEMA IF EXISTS ${qSchema} CASCADE;\n`
  sql += `CREATE SCHEMA ${qSchema};\n\n`

  schema.tables.forEach(table => {
    sql += generateTablePostgreSQL(table, schema.schema, commonConfig)
    sql += '\n\n'
  })

  sql = sql.trimEnd() + '\n'

  // Schema post-SQL
  const schemaPostSql = getSchemaPostSql(schema, 'postgresql')
  if (schemaPostSql) sql += fmtPrePostSql(schemaPostSql) + '\n'

  return sql
}

// ===== Initial data INSERT statement generation =====

/** Format a JS value as a SQL literal, handling dialect differences */
export function formatSqlValue(val: unknown, isExpr = false): string {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'boolean') {
    return val ? 'TRUE' : 'FALSE'
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

/**
 * Conflict target for ON CONFLICT DO UPDATE: the primary key first, otherwise the first plain unique index.
 * Partial unique indexes are skipped because inferring them requires repeating their WHERE predicate.
 */
function resolveConflictTargetColumns(table: Table, commonConfig: CommonConfig | null): string[] {
  const primaryKey = getPrimaryKeyColumnNames(table, commonConfig)
  if (primaryKey.length > 0) return primaryKey

  for (const index of table.indexes) {
    const indexType = resolveDialectOverride(index, 'postgresql', 'type', index.type)
    if (indexType !== 'unique') continue
    if (resolveIndexLogicalDelete(index, table, 'postgresql', commonConfig)) continue
    const names = index.columns.map(col => col.name).filter(Boolean)
    if (names.length > 0) return names
  }
  return []
}

/** Generate INSERT statements for a single table */
export function generateInitialDataPostgreSQL(
  table: Table,
  schemaName: string,
  rows: JsonObject[], // rows must already contain only valid data with skipped rows removed
  rowComments: (string | null)[] | undefined,
  commonConfig: CommonConfig | null,
  exprFields?: Record<string, boolean>[], // aligned with rows by index: marks a field value as a SQL expression (no quotes)
  insertMode: InitialDataInsertMode = 'insert',
): string {
  const cols = getTableColumnNames(table, commonConfig)
  if (cols.length === 0 || rows.length === 0) return ''

  const qSchema = quoteIdent(schemaName, commonConfig)
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

  let conflictClause = ''
  if (insertMode === 'ignore') {
    conflictClause = '\nON CONFLICT DO NOTHING'
  } else if (insertMode === 'overwrite') {
    const conflictTarget = resolveConflictTargetColumns(table, commonConfig)
    if (conflictTarget.length === 0) {
      comments += '-- ON CONFLICT DO UPDATE requires a primary key or unique index; generated as ON CONFLICT DO NOTHING\n'
      conflictClause = '\nON CONFLICT DO NOTHING'
    } else {
      const targetList = conflictTarget.map(c => quoteIdent(c, commonConfig)).join(', ')
      const updateColumns = cols.filter(col => !conflictTarget.includes(col))
      if (updateColumns.length === 0) {
        conflictClause = `\nON CONFLICT (${targetList}) DO NOTHING`
      } else {
        const assignments = updateColumns
          .map(col => `  ${quoteIdent(col, commonConfig)} = EXCLUDED.${quoteIdent(col, commonConfig)}`)
        conflictClause = `\nON CONFLICT (${targetList}) DO UPDATE SET\n${assignments.join(',\n')}`
      }
    }
  }

  return `${comments}INSERT INTO ${qSchema}.${qTable} (${colList}) VALUES\n${valueRows.join(',\n')}${conflictClause};\n`
}

/** Generate the combined PostgreSQL initial data INSERT script for all schemas */
export function generateInitialDataAllPostgreSQL(
  schemas: Schema[],
  initialDataMap: Map<string, InitialData>,
  commonConfig: CommonConfig | null
): string {
  let sql = ''

  sql += '/*\n'
  sql += ' Source Server Type    : PostgreSQL\n'
  sql += '*/\n'
  sql += '\n'

  for (const schema of schemas) {
    let isSchemaCommentHeaderPrinted = false
    for (const table of schema.tables) {
      const key = `${schema.schema}/${table.name}`
      const initData = initialDataMap.get(key)
      if (!initData) continue

      const initPreSql = getInitialDataPreSql(initData, 'postgresql')
      const initPostSql = getInitialDataPostSql(initData, 'postgresql')

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
        // sql += `-- ----------------------------\n`
        // sql += `-- Initial data for ${schema.schema}.${table.name}\n`
        // sql += `-- ----------------------------\n`
        const qSchema = quoteIdent(schema.schema, commonConfig)
        const qTable = quoteIdent(table.name, commonConfig)
        sql += `-- Insert data into ${qSchema}.${qTable}\n`
        sql += generateInitialDataPostgreSQL(table, schema.schema, filtered.rows, filtered.rowComments, commonConfig, filtered.exprFields, resolveInitialDataInsertMode(initData, commonConfig))
        sql += '\n'
      }

      // initial-data level post-SQL
      if (hasPostSql) {
        sql += fmtPrePostSql(initPostSql) + '\n'
      }
    }
  }

  return sql
}
