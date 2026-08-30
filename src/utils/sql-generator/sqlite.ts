import type { CommonConfig, Schema, Table, Field, InitialData } from '@/types/schema'
import { getTableColumnNames, renderCommentBeforeField, renderCommentBeforeTable, resolveField, resolveFieldTypeForDialect, resolveQuoteDefault, formatSqlDefault, getTablePreSql, getTablePostSql, getSchemaPreSql, getSchemaPostSql, fmtPrePostSql, getInitialDataPreSql, getInitialDataPostSql, filterInitialDataRows, buildFieldComment, resolveIndexName } from './shared'
import { splitColumnForSql } from '@/utils/index-column-utils'
import { resolveDialectOverride } from '@/utils/dialect-resolver'

/*
  SQL 生成器（SQLite 方言）
  纯函数，不依赖 Node.js fs，可在浏览器端运行

  与 MySQL / PostgreSQL 的差异：
  - 无 CREATE SCHEMA：schema 仅作为注释标注（对应数据库文件或 ATTACH 别名）
  - 无 COMMENT 语法：表/字段/索引注释一律以 `--` 注释行输出
  - 无 PARTITION BY：分区配置不参与生成
  - 外键开关用 PRAGMA foreign_keys（对应 MySQL 的 SET FOREIGN_KEY_CHECKS）
*/

// ===== 工具函数 =====

/** 根据 commonConfig 决定是否对 SQLite 标识符加双引号（双引号是 SQLite 的标准引用符） */
function quoteIdent(name: string, commonConfig: CommonConfig | null): string {
  const shouldQuote = commonConfig?.default_config?.sqlite?.quote_identifiers ?? true
  return shouldQuote ? `"${name}"` : name
}

/** 生成索引列列表（含排序方向） */
function indexColumnList(columns: Table['indexes'][number]['columns'], commonConfig: CommonConfig | null): string {
  return columns.map(col => {
    const { name, sortPart } = splitColumnForSql(col, 'sqlite')
    return quoteIdent(name, commonConfig) + sortPart
  }).join(', ')
}

// ===== 表字段定义 =====

function getFieldDefinitionSQLite(field: Field, commonConfig: CommonConfig | null): string {
  let fieldDef = quoteIdent(field.field_name, commonConfig)

  // 使用统一类型解析链获取最终 type + length + scale
  const resolved = resolveFieldTypeForDialect(field, 'sqlite', commonConfig)
  const fieldType = resolved.type
  const fieldLength = resolved.length
  const fieldScale = resolved.scale

  // 确定 default 值（不走 unified_type，保持字段级 → 方言覆盖链）
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

  // SQLite 无字段级 COMMENT 语法，注释由建表逻辑以独立 `--` 行输出在字段定义之上

  if (field.is_commented_out) {
    fieldDef = `-- ${fieldDef}`
  }

  return fieldDef
}

// ===== 生成单表 SQL =====

/**
 * 生成单表建表 SQL。
 * 与 PostgreSQL 不同，SQLite 无 schema 前缀（schema 对应数据库文件），故无需 schemaName 参数。
 */
export function generateTableSQLite(table: Table, commonConfig: CommonConfig | null): string {
  const qTableName = quoteIdent(table.name, commonConfig)

  let sql = ''

  sql += renderCommentBeforeTable(table.comment_before_table)

  sql += `-- ----------------------------\n`
  sql += `-- Table structure for ${table.name}\n`
  // SQLite 无表级 COMMENT 语法，表注释落在表头注释块内
  if (table.comment) {
    sql += `-- ${table.comment}\n`
  }
  sql += `-- ----------------------------\n`

  // 表前置 SQL
  const preSql = getTablePreSql(table, 'sqlite')
  if (preSql) sql += fmtPrePostSql(preSql) + '\n'

  // DDL 生成策略：drop_and_create | create_if_not_exists | create
  const ddlMode = commonConfig?.default_config?.table_ddl_mode ?? 'drop_and_create'
  if (ddlMode === 'create_if_not_exists') {
    sql += `CREATE TABLE IF NOT EXISTS ${qTableName} (\n`
  } else if (ddlMode === 'create') {
    sql += `CREATE TABLE ${qTableName} (\n`
  } else {
    sql += `DROP TABLE IF EXISTS ${qTableName};\n`
    sql += `CREATE TABLE ${qTableName} (\n`
  }

  // 字段定义
  const fieldDefinitions = table.fields.map(field => {
    const fieldConfig = resolveField(field, commonConfig)
    let fieldDef = `  ${getFieldDefinitionSQLite(fieldConfig, commonConfig)}`

    // 字段注释以独立注释行输出（SQLite 无 COMMENT 语法）
    const finalComment = buildFieldComment(fieldConfig, 'sqlite')
    if (finalComment) {
      fieldDef = `  -- ${finalComment}\n${fieldDef}`
    }

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

  // UNIQUE 索引在建表语句中定义（SQLite 支持具名 CONSTRAINT ... UNIQUE）
  table.indexes.forEach(index => {
    const indexType = resolveDialectOverride(index, 'sqlite', 'type', index.type)
    if (indexType === 'unique') {
      const indexName = resolveIndexName(index, 'sqlite', table.name)!
      let def = `  CONSTRAINT ${quoteIdent(indexName, commonConfig)} UNIQUE (${indexColumnList(index.columns, commonConfig)})`
      // SQLite 无 COMMENT ON INDEX，索引注释以注释行输出
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

  // 普通索引在建表语句下方定义
  let hasCreateIndexSql = false
  table.indexes.forEach(index => {
    const indexType = resolveDialectOverride(index, 'sqlite', 'type', index.type)

    if (indexType !== 'unique' && (indexType || index.columns)) {
      if (index.pre_comment) {
        sql += `-- ${index.pre_comment}\n`
      }
      if (index.comment) {
        sql += `-- ${index.comment}\n`
      }
      const indexName = resolveIndexName(index, 'sqlite', table.name)!
      sql += `CREATE INDEX ${quoteIdent(indexName, commonConfig)} ON ${qTableName} (${indexColumnList(index.columns, commonConfig)});\n`
      hasCreateIndexSql = true
    }
  })

  if (hasCreateIndexSql) {
    sql += '\n'
  }

  // 表后置 SQL
  const postSql = getTablePostSql(table, 'sqlite')
  if (postSql) sql += '\n' + fmtPrePostSql(postSql)

  return sql
}

// ===== 生成整个 schema 的 SQL =====

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

  // Schema 前置 SQL
  const schemaPreSql = getSchemaPreSql(schema, 'sqlite')
  if (schemaPreSql) sql += fmtPrePostSql(schemaPreSql) + '\n'

  // SQLite 无 CREATE SCHEMA：schema 对应数据库文件（或 ATTACH 别名），仅以注释标注
  sql += `-- Schema: ${schema.schema}\n\n`

  schema.tables.forEach(table => {
    sql += generateTableSQLite(table, commonConfig)
    sql += '\n\n'
  })

  sql = sql.trimEnd() + '\n'

  // Schema 后置 SQL
  const schemaPostSql = getSchemaPostSql(schema, 'sqlite')
  if (schemaPostSql) sql += fmtPrePostSql(schemaPostSql) + '\n'

  sql = sql + '\nPRAGMA foreign_keys = ON;' + '\n'

  return sql
}

// ===== Initial Data INSERT 语句生成 =====

/** 将 JS 值格式化为 SQL 字面量（SQLite 无原生布尔类型，以 1/0 表示） */
export function formatSqlValue(val: unknown): string {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'boolean') {
    return val ? '1' : '0'
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
export function generateInitialDataSQLite(
  table: Table,
  rows: Record<string, any>[], // rows 应为已过滤掉 skip 行的有效数据
  rowComments: (string | null)[] | undefined,
  commonConfig: CommonConfig | null
): string {
  const cols = getTableColumnNames(table, null)
  if (cols.length === 0 || rows.length === 0) return ''

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

  return `${comments}INSERT INTO ${qTable} (${colList}) VALUES\n${valueRows.join(',\n')};\n`
}

/** 生成所有 Schema 的 SQLite initial data INSERT 汇总 */
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
        const qTable = quoteIdent(table.name, commonConfig)
        sql += `-- Insert data into ${qTable}\n`
        sql += generateInitialDataSQLite(table, filtered.rows, filtered.rowComments, commonConfig)
        sql += '\n'
      }

      // initial-data 级别后置 SQL
      if (hasPostSql) {
        sql += fmtPrePostSql(initPostSql) + '\n'
      }
    }
  }

  sql += '\nPRAGMA foreign_keys = ON;\n'
  return sql
}
