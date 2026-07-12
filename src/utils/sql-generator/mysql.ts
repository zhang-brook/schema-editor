import type { CommonConfig, Schema, Table, Field, Index, InitialData } from '@/types/schema'
import { getTableColumnNames, renderCommentBeforeField, renderCommentBeforeTable, resolveField, resolveFieldTypeForDialect, resolveQuoteDefault, formatSqlDefault, getTablePreSql, getTablePostSql, getSchemaPreSql, getSchemaPostSql, fmtPrePostSql, getInitialDataPreSql, getInitialDataPostSql, filterInitialDataRows, getTablePartitionClause } from './shared'
import { splitColumnForSql } from '@/utils/index-column-utils'
import { resolveDialectOverride } from '@/utils/dialect-resolver'

/*
  SQL 生成器
  纯函数，不依赖 Node.js fs，可在浏览器端运行
*/

// ===== 表字段定义 =====

function getFieldDefinitionMySQL(field: Field, commonConfig: CommonConfig | null): string {
  let fieldDef = `\`${field.field_name}\``

  // 使用统一类型解析链获取最终 type + length + scale
  const resolved = resolveFieldTypeForDialect(field, 'mysql', commonConfig)
  const fieldType = resolved.type
  const fieldLength = resolved.length
  const fieldScale = resolved.scale

  // 确定 default 值（不走 unified_type，保持字段级 → 方言覆盖链）
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
      if (field.field_name === 'last_modified_time') {
        fieldDef += ' ON UPDATE CURRENT_TIMESTAMP(3)'
      }
    } else {
      const shouldQuote = resolveQuoteDefault(field, commonConfig)
      fieldDef += ` DEFAULT ${formatSqlDefault(defaultValue, shouldQuote)}`
    }
  }

  // COMMENT
  if (field.comment) {
    fieldDef += ` COMMENT '${field.comment.replace(/'/g, "''")}'`
  }

  if (field.is_commented_out) {
    fieldDef = `-- ${fieldDef}`
  }

  return fieldDef
}

// ===== 表索引定义 =====

function getMySQLIndexDefinition(index: Index): string {
  // 获取数据库特定的索引名称
  let indexName = index.name
  let indexType = index.type
  let indexUsing = index.using

  if (index.mysql) {
    indexName = index.mysql.name || indexName
    indexType = index.mysql.type || indexType
    indexUsing = index.mysql.using || indexUsing
  }

  indexName = indexName?.replace('{pre}', indexType === 'unique' ? 'uk_' : 'idx_').replace('{post}', '')

  // 如果没有指定 type，默认使用 BTREE（MySQL 默认索引类型）
  const finalIndexUsing = indexUsing ? ' USING ' + indexUsing.toUpperCase() : ''

  const colList = index.columns.map(c => {
    const { name, sortPart } = splitColumnForSql(c, 'mysql')
    return '`' + name + '`' + sortPart
  }).join(', ')

  // 确定索引注释（字段级 comment，非方言覆盖）
  let commentPart = ''
  const idxComment = index.comment
  if (idxComment) {
    commentPart = ` COMMENT '${idxComment.replace(/'/g, "''")}'`
  }

  if (indexType === 'unique') {
    // 也可以写作 UNIQUE INDEX `indexName` (`column1`, `column2`) USING BTREE
    if (index.columns.length > 1) {
      return `UNIQUE INDEX \`${indexName}\` (${colList})${finalIndexUsing}${commentPart}`
    }
    return `UNIQUE KEY (${colList})${commentPart}`
  } else {
    return `INDEX \`${indexName}\` (${colList})${finalIndexUsing}${commentPart}`
  }
}


// ===== 生成单表 SQL =====

export function generateTableMySQL(table: Table, commonConfig: CommonConfig | null): string {
  let sql = ''

  sql += renderCommentBeforeTable(table.comment_before_table)

  sql += `-- ----------------------------\n`
  sql += `-- Table structure for ${table.name}\n`
  sql += `-- ----------------------------\n`

  // 表前置 SQL
  const preSql = getTablePreSql(table, 'mysql')
  if (preSql) sql += fmtPrePostSql(preSql) + '\n'

  // DDL 生成策略：drop_and_create | create_if_not_exists | create
  const ddlMode = commonConfig?.default_config?.table_ddl_mode ?? 'drop_and_create'
  if (ddlMode === 'create_if_not_exists') {
    sql += `CREATE TABLE IF NOT EXISTS \`${table.name}\` (\n`
  } else if (ddlMode === 'create') {
    sql += `CREATE TABLE \`${table.name}\` (\n`
  } else {
    sql += `DROP TABLE IF EXISTS \`${table.name}\`;\n`
    sql += `CREATE TABLE \`${table.name}\` (\n`
  }

  // 字段定义
  const fieldDefinitions = table.fields.map(field => {
    const fieldConfig = resolveField(field, commonConfig)
    let fieldDef = `  ${getFieldDefinitionMySQL(fieldConfig, commonConfig)}`

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
    indexDefinitions.push(`  PRIMARY KEY (\`${primaryKeyField.field_name}\`) USING BTREE`)
  }

  // 索引
  table.indexes.forEach(index => {
    const indexDef = `  ${getMySQLIndexDefinition(index)}`
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

  // 表级配置
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

  // PARTITION BY 生成在右括号之后（MySQL 要求位于所有表选项之后）
  const partitionClause = getTablePartitionClause(table, 'mysql', commonConfig)
  if (partitionClause) {
    sql += ` ${partitionClause}`
  }
  sql += ` COMMENT = '${table.comment}'`
  sql += ' ROW_FORMAT = Dynamic;\n'

  // 表后置 SQL
  const postSql = getTablePostSql(table, 'mysql')
  if (postSql) sql += '\n' + fmtPrePostSql(postSql)

  return sql
}

// ===== 生成整个 schema 的 SQL =====

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

  // Schema 前置 SQL
  const schemaPreSql = getSchemaPreSql(schema, 'mysql')
  if (schemaPreSql) sql += fmtPrePostSql(schemaPreSql) + '\n'

  schema.tables.forEach(table => {
    sql += generateTableMySQL(table, commonConfig)
    sql += '\n\n\n'
  })

  sql = sql.trimEnd() + '\n\n'

  // Schema 后置 SQL
  const schemaPostSql = getSchemaPostSql(schema, 'mysql')
  if (schemaPostSql) sql += fmtPrePostSql(schemaPostSql) + '\n'

  sql = sql + 'SET FOREIGN_KEY_CHECKS = 1;' + '\n'

  return sql
}

// ===== Initial Data INSERT 语句生成 =====

/** 将 JS 值格式化为 SQL 字面量，根据方言处理差异 */
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

/** 生成单表的 INSERT 语句（） */
export function generateInitialDataMySQL(
  table: Table,
  rows: Record<string, any>[], // rows 应为已过滤掉 skip 行的有效数据
  rowComments?: (string | null)[],
): string {
  const cols = getTableColumnNames(table, null)  // MySQL DDL 也是用同名字段，不需要 commonConfig 解析字段名（name 在 INSERT 中用引号括起来即可）
  // 实际需要用 resolveField 处理，重新获取列名
  // 列名保持原样，INSERT 中只需字段名一致
  if (cols.length === 0 || rows.length === 0) return ''

  const colList = cols.map(c => `\`${c}\``).join(', ')

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

  return `${comments}INSERT INTO \`${table.name}\` (${colList}) VALUES\n${valueRows.join(',\n')};\n`
}

/** 生成所有 Schema 的 MySQL initial data INSERT 汇总 */
export function generateInitialDataAllMySQL(
  schemas: Schema[],
  initialDataMap: Map<string, InitialData>,
  _commonConfig: CommonConfig | null
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
        sql += `-- Insert data into \`${table.name}\`\n`
        sql += generateInitialDataMySQL(table, filtered.rows, filtered.rowComments)
        sql += '\n'
      }

      // initial-data 级别后置 SQL
      if (hasPostSql) {
        sql += fmtPrePostSql(initPostSql) + '\n'
      }
    }
  }

  sql += 'SET FOREIGN_KEY_CHECKS = 1;\n'
  return sql
}
