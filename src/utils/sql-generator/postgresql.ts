import type { CommonConfig, Schema, Table, Field, InitialData } from '@/types/schema'
import { getTableColumnNames, renderCommentBeforeField, renderCommentBeforeTable, resolveField } from './shared'
import { splitColumnForSql } from '@/utils/index-column-utils'

/*
  SQL 生成器
  纯函数，不依赖 Node.js fs，可在浏览器端运行
*/

// ===== 工具函数 =====

/** 根据 commonConfig 决定是否对 PostgreSQL 标识符加双引号 */
function quoteIdent(name: string, commonConfig: CommonConfig | null): string {
  const shouldQuote = commonConfig?.default_config?.pgsql?.quote_identifiers ?? true
  return shouldQuote ? `"${name}"` : name
}

// ===== 表字段定义 =====

function getFieldDefinitionPostgreSQL(field: Field, commonConfig: CommonConfig | null): string {
  let fieldDef = quoteIdent(field.field_name, commonConfig)

  // 确定字段类型
  let fieldType = field.field_type
  let fieldLength = field.field_length
  let defaultValue = field.default

  if (field.pgsql) {
    fieldType = field.pgsql.field_type !== undefined ? field.pgsql.field_type : fieldType
    fieldLength = field.pgsql.field_length !== undefined ? field.pgsql.field_length : fieldLength
    defaultValue = field.pgsql.default !== undefined ? field.pgsql.default : defaultValue
  }

  if (fieldType) {
    if (typeof fieldLength === 'number') {
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
      fieldDef += ` DEFAULT ${defaultValue}`
    }
  }

  // PostgreSQL 不在字段定义中添加 COMMENT，使用 COMMENT ON COLUMN 语句

  if (field.is_commented_out) {
    // 如果字段被标记为 is_commented_out，则将注释保留在字段定义中
    fieldDef = `-- ${fieldDef} COMMENT '${field.comment}'`
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

  // DROP TABLE IF EXISTS
  sql += `DROP TABLE IF EXISTS ${qSchemaName}.${qTableName};\n`

  // CREATE TABLE
  sql += `CREATE TABLE ${qSchemaName}.${qTableName} (\n`

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

  // 主键
  const primaryKeyField = table.fields.find(field => {
    const fieldConfig = resolveField(field, commonConfig)
    return fieldConfig.primary_key
  })

  const indexDefinitions: string[] = []
  if (primaryKeyField) {
    indexDefinitions.push(`  PRIMARY KEY (${quoteIdent(primaryKeyField.field_name, commonConfig)})`)
  }

  // UNIQUE 索引在建表语句中定义
  table.indexes.forEach(index => {
    if (index.type === 'unique' || index.pgsql?.type === 'unique') {
      indexDefinitions.push(`  UNIQUE (${index.columns.map(col => {
        const { name, sortPart } = splitColumnForSql(col, 'pgsql')
        return quoteIdent(name, commonConfig) + sortPart
      }).join(', ')})`)
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
    const indexType = index.pgsql?.type || index.type

    if (indexType !== 'unique' && (indexType || index.columns)) {
      if (index.pre_comment) {
        sql += `-- ${index.pre_comment}\n`
      }
      let indexName = index.pgsql?.name || index.mysql?.name || index.name
      indexName = indexName?.replace('{pre}', `idx__${table.name}__`).replace('{post}', '') ?? `idx_${table.name}_${index.columns.map(c => c.name).join('_')}`
      sql += `CREATE INDEX ${quoteIdent(indexName, commonConfig)} ON ${qSchemaName}.${qTableName} (${index.columns.map(col => {
        const { name, sortPart } = splitColumnForSql(col, 'pgsql')
        return quoteIdent(name, commonConfig) + sortPart
      }).join(', ')});\n`
      hasCreateIndexSql = true
    }
  })

  if (hasCreateIndexSql) {
    sql += '\n'
  }

  // 表级注释 - 使用 COMMENT ON TABLE 语句
  sql += `COMMENT ON TABLE ${qSchemaName}.${qTableName} IS '${table.comment}';\n`
  sql += '\n'

  // 字段注释 - 使用 COMMENT ON COLUMN 语句
  table.fields
    .filter(field => !field.is_commented_out)
    .forEach(field => {
      const fieldConfig = resolveField(field, commonConfig)
      if (fieldConfig.comment) {
        sql += `COMMENT ON COLUMN ${qSchemaName}.${qTableName}.${quoteIdent(fieldConfig.field_name, commonConfig)} IS '${fieldConfig.comment.replace(/'/g, "''")}';\n`
      }
    })

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

  // 创建schema
  sql += `DROP SCHEMA IF EXISTS ${qSchema} CASCADE;\n`
  sql += `CREATE SCHEMA ${qSchema};\n\n`

  schema.tables.forEach(table => {
    sql += generateTablePostgreSQL(table, schema.schema, commonConfig)
    sql += '\n\n'
  })

  sql = sql.trimEnd() + '\n'

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
function generateInitialDataPostgreSQL(
  table: Table,
  schemaName: string,
  rows: Record<string, any>[],
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
      if (!initData || initData.rows.length === 0) continue

      if (!isSchemaCommentHeaderPrinted) {
        sql += `-- ----------------------------\n`
        sql += `-- Initial data for schema ${schema.schema}\n`
        sql += `-- ----------------------------\n`
        sql += `\n`
        isSchemaCommentHeaderPrinted = true
      }
      // sql += `-- ----------------------------\n`
      // sql += `-- Initial data for ${schema.schema}.${table.name}\n`
      // sql += `-- ----------------------------\n`
      const qSchema = quoteIdent(schema.schema, commonConfig)
      const qTable = quoteIdent(table.name, commonConfig)
      sql += `-- Insert data into ${qSchema}.${qTable}\n`
      sql += generateInitialDataPostgreSQL(table, schema.schema, initData.rows, initData.row_comments, commonConfig)
      sql += '\n'
    }
  }

  return sql
}
