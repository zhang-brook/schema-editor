import type { CommonConfig, Schema, Table, Field, InitialData } from '@/types/schema'
import { getTableColumnNames, renderCommentBeforeField, renderCommentBeforeTable, resolveField, resolveFieldTypeForDialect, resolveQuoteDefault, formatSqlDefault, getTablePreSql, getTablePostSql, getSchemaPreSql, getSchemaPostSql, fmtPrePostSql, getInitialDataPreSql, getInitialDataPostSql, filterInitialDataRows, getTablePartitionClause, buildFieldComment, resolveIndexName } from './shared'
import { splitColumnForSql } from '@/utils/index-column-utils'
import { resolveDialectOverride } from '@/utils/dialect-resolver'

/*
  SQL 生成器
  纯函数，不依赖 Node.js fs，可在浏览器端运行
*/

// ===== 工具函数 =====

/** 根据 commonConfig 决定是否对 PostgreSQL 标识符加双引号 */
function quoteIdent(name: string, commonConfig: CommonConfig | null): string {
  const shouldQuote = commonConfig?.default_config?.postgresql?.quote_identifiers ?? true
  return shouldQuote ? `"${name}"` : name
}

/**
 * 注释文本 → PostgreSQL 字符串字面量：仅单引号加倍，其余原样输出。
 *
 * 模型里存的是真实字符（换行即真换行、`C:\new` 即真实反斜杠），
 * PG 标准字符串（standard_conforming_strings=on）不解析反斜杠、且允许跨行，
 * 原样写出即可得到与模型一致的结果，无需任何转义/解码。
 *
 * 不使用 `E'...'`：那会让 PG 开始解析反斜杠，`C:\new` 会被吃成换行。
 */
function formatPgStringLiteral(text: string): string {
  return `'${text.replace(/'/g, "''")}'`
}

/** 逐行加 `--` 注释前缀：跨行语句若只注释首行，后续行会变成可执行 SQL */
function commentOutLines(stmt: string): string {
  return stmt.split('\n').map(line => `-- ${line}`).join('\n')
}

// ===== 表字段定义 =====

function getFieldDefinitionPostgreSQL(field: Field, commonConfig: CommonConfig | null): string {
  let fieldDef = quoteIdent(field.field_name, commonConfig)

  // 使用统一类型解析链获取最终 type + length + scale
  const resolved = resolveFieldTypeForDialect(field, 'postgresql', commonConfig)
  const fieldType = resolved.type
  const fieldLength = resolved.length
  const fieldScale = resolved.scale

  // 确定 default 值（不走 unified_type，保持字段级 → 方言覆盖链）
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
    } else {
      const shouldQuote = resolveQuoteDefault(field, commonConfig)
      fieldDef += ` DEFAULT ${formatSqlDefault(defaultValue, shouldQuote)}`
    }
  }

  // PostgreSQL 不在字段定义中添加 COMMENT，使用 COMMENT ON COLUMN 语句；
  // 被注释掉的字段其 COMMENT ON COLUMN 语句整体加 -- 前缀输出（见 generateTablePostgreSQL）

  if (field.is_commented_out) {
    fieldDef = `-- ${fieldDef}`
  }

  return fieldDef
}

// ===== 生成单表 SQL =====

export function generateTablePostgreSQL(table: Table, schemaName: string, commonConfig: CommonConfig | null): string {
  const qSchemaName = quoteIdent(schemaName, commonConfig)
  const qTableName = quoteIdent(table.name, commonConfig)

  let sql = ''

  sql += renderCommentBeforeTable(table.comment_before_table)

  sql += `-- ----------------------------\n`
  sql += `-- Table structure for ${table.name}\n`
  sql += `-- ----------------------------\n`

  // 表前置 SQL
  const preSql = getTablePreSql(table, 'postgresql')
  if (preSql) sql += fmtPrePostSql(preSql) + '\n'

  // DDL 生成策略：drop_and_create | create_if_not_exists | create
  const ddlMode = commonConfig?.default_config?.table_ddl_mode ?? 'drop_and_create'
  if (ddlMode === 'create_if_not_exists') {
    sql += `CREATE TABLE IF NOT EXISTS ${qSchemaName}.${qTableName} (\n`
  } else if (ddlMode === 'create') {
    sql += `CREATE TABLE ${qSchemaName}.${qTableName} (\n`
  } else {
    sql += `DROP TABLE IF EXISTS ${qSchemaName}.${qTableName};\n`
    sql += `CREATE TABLE ${qSchemaName}.${qTableName} (\n`
  }

  // 字段定义
  const fieldDefinitions = table.fields.map(field => {
    const fieldConfig = resolveField(field, commonConfig)
    let fieldDef = `  ${getFieldDefinitionPostgreSQL(fieldConfig, commonConfig)}`

    // 检查是否需要在字段前添加注释
    if (table.comment_before_fields?.[field.field_name]) {
      fieldDef = renderCommentBeforeField(table.comment_before_fields[field.field_name]!) + fieldDef
    }

    return fieldDef
  })

  // 主键（支持复合主键）
  const primaryKeyFields = table.fields.filter(field => {
    const fieldConfig = resolveField(field, commonConfig)
    return fieldConfig.primary_key
  })

  const indexDefinitions: string[] = []
  if (primaryKeyFields.length > 0) {
    const primaryKeyColumns = primaryKeyFields.map(field => quoteIdent(field.field_name, commonConfig)).join(', ')
    indexDefinitions.push(`  PRIMARY KEY (${primaryKeyColumns})`)
  }

  // UNIQUE 索引在建表语句中定义
  table.indexes.forEach(index => {
    const indexType = resolveDialectOverride(index, 'postgresql', 'type', index.type)
    if (indexType === 'unique') {
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
  // PARTITION BY 生成在右括号之后、分号之前
  const partitionClause = getTablePartitionClause(table, 'postgresql', commonConfig)
  if (partitionClause) {
    sql += ` ${partitionClause}`
  }
  sql += ';\n\n'

  // 普通索引在建表语句下方定义
  let hasCreateIndexSql = false
  table.indexes.forEach((index, i) => {
    const indexType = resolveDialectOverride(index, 'postgresql', 'type', index.type)

    if (indexType !== 'unique' && (indexType || index.columns)) {
      if (index.pre_comment) {
        sql += `-- ${index.pre_comment}\n`
      }
      const indexName = resolveIndexName(index, 'postgresql', table.name)!
      sql += `CREATE INDEX ${quoteIdent(indexName, commonConfig)} ON ${qSchemaName}.${qTableName} (${index.columns.map(col => {
        const { name, sortPart } = splitColumnForSql(col, 'postgresql')
        return quoteIdent(name, commonConfig) + sortPart
      }).join(', ')});\n`
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

  // 表级注释 - 使用 COMMENT ON TABLE 语句
  sql += `COMMENT ON TABLE ${qSchemaName}.${qTableName} IS ${formatPgStringLiteral(table.comment)};\n`
  sql += '\n'

  // 字段注释 - 使用 COMMENT ON COLUMN 语句。
  // 被注释掉的字段不出现在表结构中，其语句整体加 -- 前缀保留：既不会破坏语法，
  // 去掉前缀即可直接执行；跨行时每行都加前缀（见 commentOutLines）
  table.fields.forEach(field => {
    const fieldConfig = resolveField(field, commonConfig)
    const finalComment = buildFieldComment(fieldConfig, 'postgresql')
    if (!finalComment) return
    const stmt = `COMMENT ON COLUMN ${qSchemaName}.${qTableName}.${quoteIdent(fieldConfig.field_name, commonConfig)} IS ${formatPgStringLiteral(finalComment)};`
    sql += `${fieldConfig.is_commented_out ? commentOutLines(stmt) : stmt}\n`
  })

  let isFirstIndex = true
  // 索引注释 — 为唯一索引和已命名普通索引生成 COMMENT ON INDEX
  table.indexes.forEach(index => {
    if (!index.comment) return
    const indexType = resolveDialectOverride(index, 'postgresql', 'type', index.type)
    if (indexType === 'unique') {
      if (isFirstIndex) {
        isFirstIndex = false
        sql += '\n'
      }
      const indexName = resolveIndexName(index, 'postgresql', table.name)!
      sql += `COMMENT ON INDEX ${qSchemaName}.${quoteIdent(indexName, commonConfig)} IS ${formatPgStringLiteral(index.comment)};\n`
    }
  })

  // 表后置 SQL
  const postSql = getTablePostSql(table, 'postgresql')
  if (postSql) sql += '\n' + fmtPrePostSql(postSql)

  return sql
}

// ===== 生成整个 schema 的 SQL =====

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

  // Schema 前置 SQL
  const schemaPreSql = getSchemaPreSql(schema, 'postgresql')
  if (schemaPreSql) sql += fmtPrePostSql(schemaPreSql) + '\n'

  // 创建schema
  sql += `DROP SCHEMA IF EXISTS ${qSchema} CASCADE;\n`
  sql += `CREATE SCHEMA ${qSchema};\n\n`

  schema.tables.forEach(table => {
    sql += generateTablePostgreSQL(table, schema.schema, commonConfig)
    sql += '\n\n'
  })

  sql = sql.trimEnd() + '\n'

  // Schema 后置 SQL
  const schemaPostSql = getSchemaPostSql(schema, 'postgresql')
  if (schemaPostSql) sql += fmtPrePostSql(schemaPostSql) + '\n'

  return sql
}

// ===== Initial Data INSERT 语句生成 =====

/** 将 JS 值格式化为 SQL 字面量，根据方言处理差异 */
export function formatSqlValue(val: unknown): string {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'boolean') {
    return val ? 'TRUE' : 'FALSE'
  }
  if (typeof val === 'number') {
    if (Number.isNaN(val) || !Number.isFinite(val)) return 'NULL'
    return String(val)
  }
  if (typeof val === 'string') {
    // 转义单引号：' → ''
    return `'${val.replace(/'/g, "''")}'`
  }
  // 对象/数组等：JSON 序列化后作为字符串
  return `'${JSON.stringify(val).replace(/'/g, "''")}'`
}

/** 生成单表的 INSERT 语句 */
export function generateInitialDataPostgreSQL(
  table: Table,
  schemaName: string,
  rows: Record<string, any>[], // rows 应为已过滤掉 skip 行的有效数据
  rowComments: (string | null)[] | undefined,
  commonConfig: CommonConfig | null
): string {
  const cols = getTableColumnNames(table, null)
  if (cols.length === 0 || rows.length === 0) return ''

  const qSchema = quoteIdent(schemaName, commonConfig)
  const qTable = quoteIdent(table.name, commonConfig)
  const colList = cols.map(c => quoteIdent(c, commonConfig)).join(', ')

  // 行注释（仅输出非 null 的）
  let comments = ''
  if (rowComments) {
    for (let i = 0; i < rowComments.length; i++) {
      if (rowComments[i]) {
        comments += `-- Row ${i + 1}: ${rowComments[i]}\n`
      }
    }
  }

  const valueRows = rows.map(row => {
    const vals = cols.map(col => formatSqlValue(row[col]))
    return `  (${vals.join(', ')})`
  })

  return `${comments}INSERT INTO ${qSchema}.${qTable} (${colList}) VALUES\n${valueRows.join(',\n')};\n`
}

/** 生成所有 Schema 的 PostgreSQL initial data INSERT 汇总 */
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

      // 先过滤掉「不生成」的行，得到有效数据行（无 skip 逻辑残留）
      const filtered = filterInitialDataRows(initData.rows)

      // 无有效数据行且无 pre/post SQL 则跳过
      if (!filtered.hasRows && !hasPreSql && !hasPostSql) continue

      if (!isSchemaCommentHeaderPrinted) {
        sql += `-- ----------------------------\n`
        sql += `-- Initial data for schema ${schema.schema}\n`
        sql += `-- ----------------------------\n`
        sql += `\n`
        isSchemaCommentHeaderPrinted = true
      }

      // initial-data 级别前置 SQL
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
        sql += generateInitialDataPostgreSQL(table, schema.schema, filtered.rows, filtered.rowComments, commonConfig)
        sql += '\n'
      }

      // initial-data 级别后置 SQL
      if (hasPostSql) {
        sql += fmtPrePostSql(initPostSql) + '\n'
      }
    }
  }

  return sql
}
