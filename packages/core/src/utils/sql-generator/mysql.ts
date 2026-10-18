import type { CommonConfig, Schema, Table, Field, Index, InitialData, InitialDataInsertMode, JsonObject } from '../../types/schema'
import { getTableColumnNames, getPrimaryKeyColumnNames, resolveInitialDataInsertMode, renderCommentBeforeField, renderCommentBeforeTable, resolveField, resolveFieldTypeForDialect, resolveQuoteDefault, formatSqlDefault, getTablePreSql, getTablePostSql, getSchemaPreSql, getSchemaPostSql, fmtPrePostSql, getInitialDataPreSql, getInitialDataPostSql, filterInitialDataRows, getTablePartitionClause, buildFieldComment, resolveIndexName } from './shared'
import { splitColumnForSql } from '../index-column-utils'
import { resolveDialectOverride } from '../dialect-resolver'
import { buildMysqlActiveExpression, resolveIndexLogicalDelete } from '../logical-delete'

/*
  SQL generator
  Pure functions with no Node.js fs dependency, runnable in the browser
*/

/**
 * MySQL string literal escaping: double backslashes and single quotes, emit real newlines/carriage returns as `\n`/`\r`.
 *
 * Comments in the model hold real characters (JSON `\n` has already been parsed into a real newline and `\\` into a single backslash),
 * so this is standard MySQL escaping: `C:\new` → `'C:\\new'`, a real newline → `'\n'`,
 * which MySQL decodes back to the same characters as in the model.
 *
 * Backslashes must be replaced first, otherwise the backslashes inserted by later steps get doubled again.
 */
function escapeMySqlStringLiteral(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
}

// ===== Table field definitions =====

function getFieldDefinitionMySQL(field: Field, commonConfig: CommonConfig | null): string {
  let fieldDef = `\`${field.field_name}\``

  // Use the unified type resolution chain to get the final type + length + scale
  const resolved = resolveFieldTypeForDialect(field, 'mysql', commonConfig)
  const fieldType = resolved.type
  const fieldLength = resolved.length
  const fieldScale = resolved.scale

  // Determine the default value (bypassing unified_type, keeping the field-level → dialect override chain)
  const defaultValue = resolveDialectOverride(field, 'mysql', 'default')

  if (fieldType) {
    if (typeof fieldScale === 'number' && typeof fieldLength === 'number') {
      fieldDef += ` ${fieldType}(${fieldLength},${fieldScale})`
    } else if (typeof fieldLength === 'number') {
      fieldDef += ` ${fieldType}(${fieldLength})`
    } else {
      fieldDef += ` ${fieldType}`
    }

    switch (fieldType.toLowerCase()) {
      case 'varchar':
      case 'text':
        const mysqlTable = commonConfig?.default_config?.mysql?.table
        if (mysqlTable?.mysql_charset) {
          fieldDef += ` CHARACTER SET ${mysqlTable.mysql_charset}`
        }
        if (mysqlTable?.mysql_collation) {
          fieldDef += ` COLLATE ${mysqlTable.mysql_collation}`
        }
        break
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
      if (field.default === 'CURRENT_TIMESTAMP' && fieldLength === 3) {
        fieldDef += '(3)'
      }
    } else if (typeof defaultValue === 'boolean') {
      // MySQL boolean defaults use 0/1 (no longer true/false, even though MySQL accepts that too)
      fieldDef += ` DEFAULT ${defaultValue ? 1 : 0}`
    } else {
      const shouldQuote = resolveQuoteDefault(field, commonConfig)
      fieldDef += ` DEFAULT ${formatSqlDefault(defaultValue, shouldQuote)}`
    }
  }

  // ON UPDATE CURRENT_TIMESTAMP[(n)]
  if (field.on_update_current_timestamp) {
    const precision = field.on_update_current_timestamp_precision
    fieldDef += typeof precision === 'number'
      ? ` ON UPDATE CURRENT_TIMESTAMP(${precision})`
      : ' ON UPDATE CURRENT_TIMESTAMP'
  }

  // COMMENT
  const finalComment = buildFieldComment(field, 'mysql')
  if (finalComment) {
    fieldDef += ` COMMENT '${escapeMySqlStringLiteral(finalComment)}'`
  }

  if (field.is_commented_out) {
    fieldDef = `-- ${fieldDef}`
  }

  return fieldDef
}

// ===== Table index definitions =====

function getMySQLIndexDefinition(index: Index, table: Table, commonConfig: CommonConfig | null): string {
  // Get the database-specific index name
  let indexType = index.type
  let indexUsing = index.using

  if (index.mysql) {
    indexType = index.mysql.type || indexType
    indexUsing = index.mysql.using || indexUsing
  }

  // When resolveIndexName returns undefined (missing name), omit the index name and let MySQL name it automatically
  const indexName = resolveIndexName(index, 'mysql', '')

  // If no type is specified, default to BTREE (MySQL's default index type)
  const finalIndexUsing = indexUsing ? ' USING ' + indexUsing.toUpperCase() : ''

  // Logical delete awareness: MySQL has no partial indexes, so work around it with a functional index or by adding the delete column to the index columns
  const logicalDelete = resolveIndexLogicalDelete(index, table, 'mysql', commonConfig)
  const appendDeleteColumn =
    logicalDelete?.mysqlStrategy === 'timestamp_union' &&
    !index.columns.some(c => c.name === logicalDelete.field)
  const columnsForSql = appendDeleteColumn && logicalDelete
    ? [...index.columns, { name: logicalDelete.field }]
    : index.columns

  const colList = columnsForSql.map(c => {
    // Functional index: deleted rows map to NULL as a whole (multiple NULLs do not conflict in a unique index)
    if (logicalDelete && logicalDelete.mysqlStrategy === 'functional') {
      const { sortPart } = splitColumnForSql(c, 'mysql')
      return `(${buildMysqlActiveExpression(c.name, logicalDelete.field)})${sortPart}`
    }
    const { name, sortPart } = splitColumnForSql(c, 'mysql')
    return '`' + name + '`' + sortPart
  }).join(', ')

  // Determine the index comment (field-level comment, not a dialect override)
  let commentPart = ''
  const idxComment = index.comment
  if (idxComment) {
    commentPart = ` COMMENT '${escapeMySqlStringLiteral(idxComment)}'`
  }

  // Omit the index name when missing (MySQL allows this and names it after the first column)
  const indexNameSql = indexName ? ` \`${indexName}\`` : ''

  if (indexType === 'unique') {
    // Multi-column unique indexes must be declared explicitly as UNIQUE INDEX; single-column ones can be shortened to UNIQUE KEY
    if (index.columns.length > 1) {
      // UNIQUE INDEX `indexName` (`column1`, `column2`) USING BTREE
      // UNIQUE INDEX (`column1`, `column2`) USING BTREE
      return `UNIQUE INDEX${indexNameSql} (${colList})${finalIndexUsing}${commentPart}`
    }
    // UNIQUE KEY (`column1`) USING BTREE
    // UNIQUE KEY `indexName` (`column1`) USING BTREE
    return `UNIQUE KEY${indexNameSql} (${colList})${finalIndexUsing}${commentPart}`
  } else {
    // INDEX `indexName` (`column1`, `column2`) USING BTREE
    return `INDEX${indexNameSql} (${colList})${finalIndexUsing}${commentPart}`
  }
}


// ===== Generate SQL for a single table =====

export function generateTableMySQL(table: Table, commonConfig: CommonConfig | null): string {
  let sql = ''

  sql += renderCommentBeforeTable(table.comment_before_table)

  sql += `-- ----------------------------\n`
  sql += `-- Table structure for ${table.name}\n`
  sql += `-- ----------------------------\n`

  // Table pre-SQL
  const preSql = getTablePreSql(table, 'mysql')
  if (preSql) sql += fmtPrePostSql(preSql) + '\n'

  // DDL generation strategy: drop_and_create | create_if_not_exists | create
  const ddlMode = commonConfig?.default_config?.table_ddl_mode ?? 'drop_and_create'
  if (ddlMode === 'drop_and_create') {
    sql += `DROP TABLE IF EXISTS \`${table.name}\`;\n`
  }

  // Check whether there is any real column (MySQL cannot create a table without columns)
  const hasRealColumn = table.fields.some(field => {
    const fieldConfig = resolveField(field, commonConfig)
    return !fieldConfig.is_commented_out
  })
  if (!hasRealColumn) {
    sql += '/*\n'
  }

  if (ddlMode === 'create_if_not_exists') {
    sql += `CREATE TABLE IF NOT EXISTS \`${table.name}\` (\n`
  } else if (ddlMode === 'create') {
    sql += `CREATE TABLE \`${table.name}\` (\n`
  } else if (ddlMode === 'drop_and_create') {
    sql += `CREATE TABLE \`${table.name}\` (\n`
  }

  // Field definitions
  const fieldDefinitions = table.fields.map(field => {
    const fieldConfig = resolveField(field, commonConfig)
    let fieldDef = `  ${getFieldDefinitionMySQL(fieldConfig, commonConfig)}`

    // Check whether a comment needs to be added before the field
    if (table.comment_before_fields?.[field.field_name]) {
      fieldDef = renderCommentBeforeField(table.comment_before_fields[field.field_name]!) + fieldDef
    }

    return fieldDef
  })

  // Primary key (compound primary keys supported)
  const primaryKeyFields = table.fields.filter(field => {
    const fieldConfig = resolveField(field, commonConfig)
    return fieldConfig.primary_key
  })

  const indexDefinitions: string[] = []
  if (primaryKeyFields.length > 0) {
    const primaryKeyColumns = primaryKeyFields.map(field => `\`${field.field_name}\``).join(', ')
    indexDefinitions.push(`  PRIMARY KEY (${primaryKeyColumns}) USING BTREE`)
  }

  // Indexes
  table.indexes.forEach(index => {
    const indexDef = `  ${getMySQLIndexDefinition(index, table, commonConfig)}`
    if (index.pre_comment) {
      indexDefinitions.push(`  -- ${index.pre_comment}\n${indexDef}`)
    } else {
      indexDefinitions.push(indexDef)
    }
  })

  sql += fieldDefinitions.join(',\n')
  if (indexDefinitions.length > 0) {
    sql += ',\n\n  -- 主键与索引\n'
    sql += indexDefinitions.join(',\n')
  }
  sql += '\n)'

  // Table-level options
  const mysqlConfig = (table.mysql && Object.keys(table.mysql).length > 0)
    ? table.mysql
    : commonConfig?.default_config?.mysql?.table

  if (mysqlConfig?.mysql_engine) {
    sql += ` ENGINE = ${mysqlConfig.mysql_engine}`
  }
  if (mysqlConfig?.mysql_charset) {
    sql += ` CHARACTER SET = ${mysqlConfig.mysql_charset}`
  }
  if (mysqlConfig?.mysql_collation) {
    sql += ` COLLATE = ${mysqlConfig.mysql_collation}`
  }

  // PARTITION BY is emitted after the closing parenthesis (MySQL requires it after all table options)
  const partitionClause = getTablePartitionClause(table, 'mysql', commonConfig)
  if (partitionClause) {
    sql += ` ${partitionClause}`
  }
  sql += ` COMMENT = '${escapeMySqlStringLiteral(table.comment)}'`
  sql += ' ROW_FORMAT = Dynamic;\n'

  // Table post-SQL
  const postSql = getTablePostSql(table, 'mysql')
  if (postSql) sql += '\n' + fmtPrePostSql(postSql)

  if (!hasRealColumn) {
    sql += '*/\n'
  }

  return sql
}

// ===== Generate SQL for the whole schema =====

export function generateSchemaMySQL(schema: Schema, commonConfig: CommonConfig | null): string {
  let sql = ''

  sql += [
    '/*',
    ' Source Server Type    : MySQL',
    ' Source Schema         : ' + schema.schema,
    '*/',
    '',
    'SET NAMES utf8mb4;',
    'SET FOREIGN_KEY_CHECKS = 0;',
    '',
    '',
    '',
  ].join('\n')

  // Schema pre-SQL
  const schemaPreSql = getSchemaPreSql(schema, 'mysql')
  if (schemaPreSql) sql += fmtPrePostSql(schemaPreSql) + '\n'

  schema.tables.forEach(table => {
    sql += generateTableMySQL(table, commonConfig)
    sql += '\n\n\n'
  })

  sql = sql.trimEnd() + '\n\n'

  // Schema post-SQL
  const schemaPostSql = getSchemaPostSql(schema, 'mysql')
  if (schemaPostSql) sql += fmtPrePostSql(schemaPostSql) + '\n'

  sql = sql + 'SET FOREIGN_KEY_CHECKS = 1;' + '\n'

  return sql
}

// ===== Initial data INSERT generation =====

/** Format a JS value as an SQL literal, handling dialect differences */
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
    // Marked as an SQL expression (e.g. CURRENT_TIMESTAMP()): emit as-is without quotes
    if (isExpr) return val
    // Escape single quotes: ' → ''
    return `'${val.replace(/'/g, "''")}'`
  }
  // Objects/arrays and the like: JSON-serialize and emit as a string
  return `'${JSON.stringify(val).replace(/'/g, "''")}'`
}

/** Generate INSERT statements for a single table */
export function generateInitialDataMySQL(
  table: Table,
  rows: JsonObject[], // rows must already have skip rows filtered out
  rowComments?: (string | null)[],
  exprFields?: Record<string, boolean>[], // index-aligned with rows: marks a field value as an SQL expression (unquoted)
  commonConfig: CommonConfig | null = null,
  insertMode: InitialDataInsertMode = 'insert',
): string {
  const cols = getTableColumnNames(table, commonConfig)
  if (cols.length === 0 || rows.length === 0) return ''

  const colList = cols.map(c => `\`${c}\``).join(', ')

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

  let keyword = 'INSERT INTO'
  let conflictClause = ''
  if (insertMode === 'ignore') {
    keyword = 'INSERT IGNORE INTO'
  } else if (insertMode === 'overwrite') {
    // Update every inserted non-primary-key column; a primary-key-only table falls back to a no-op assignment
    const primaryKey = getPrimaryKeyColumnNames(table, commonConfig)
    const updateColumns = cols.filter(col => !primaryKey.includes(col))
    const assignments = (updateColumns.length > 0 ? updateColumns : cols.slice(0, 1))
      .map(col => `  \`${col}\` = VALUES(\`${col}\`)`)
    conflictClause = `\nON DUPLICATE KEY UPDATE\n${assignments.join(',\n')}`
  }

  return `${comments}${keyword} \`${table.name}\` (${colList}) VALUES\n${valueRows.join(',\n')}${conflictClause};\n`
}

/** Generate the MySQL initial data INSERT summary for all schemas */
export function generateInitialDataAllMySQL(
  schemas: Schema[],
  initialDataMap: Map<string, InitialData>,
  commonConfig: CommonConfig | null
): string {
  let sql = ''

  sql += '/*\n'
  sql += ' Source Server Type    : MySQL\n'
  sql += '*/\n'
  sql += '\n'
  sql += 'SET NAMES utf8mb4;\n'
  sql += 'SET FOREIGN_KEY_CHECKS = 0;\n'
  sql += '\n'

  for (const schema of schemas) {
    let isSchemaCommentHeaderPrinted = false
    for (const table of schema.tables) {
      const key = `${schema.schema}/${table.name}`
      const initData = initialDataMap.get(key)
      if (!initData) continue

      const initPreSql = getInitialDataPreSql(initData, 'mysql')
      const initPostSql = getInitialDataPostSql(initData, 'mysql')

      const hasPreSql = !!initPreSql
      const hasPostSql = !!initPostSql

      // Filter out "do not generate" rows first to get the effective data rows (no skip logic left)
      const filtered = filterInitialDataRows(initData.rows)

      // Skip when there are no effective rows and no pre/post SQL
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
        sql += `-- Insert data into \`${table.name}\`\n`
        sql += generateInitialDataMySQL(table, filtered.rows, filtered.rowComments, filtered.exprFields, commonConfig, resolveInitialDataInsertMode(initData, commonConfig))
        sql += '\n'
      }

      // initial-data level post-SQL
      if (hasPostSql) {
        sql += fmtPrePostSql(initPostSql) + '\n'
      }
    }
  }

  sql += 'SET FOREIGN_KEY_CHECKS = 1;\n'
  return sql
}
