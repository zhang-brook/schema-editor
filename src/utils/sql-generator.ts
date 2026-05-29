import type { CommonConfig, Schema, Table, Field, Index } from '@/types/schema'

/*
  SQL 生成器 —— 移植自 generate-sql.ts
  纯函数，不依赖 Node.js fs，可在浏览器端运行
*/

export type SqlDialect = 'mysql' | 'postgresql'

// ===== MySQL 字段定义 =====

function getFieldDefinitionMySQL(field: Field, commonConfig: CommonConfig | null): string {
  let fieldDef = `\`${field.field_name}\``

  // 确定字段类型
  let fieldType = field.field_type
  let fieldLength = field.field_length
  let defaultValue = field.default

  if (field.mysql) {
    fieldType = field.mysql.field_type !== undefined ? field.mysql.field_type : fieldType
    fieldLength = field.mysql.field_length !== undefined ? field.mysql.field_length : fieldLength
    defaultValue = field.mysql.default !== undefined ? field.mysql.default : defaultValue
  }

  if (fieldType) {
    if (typeof fieldLength === 'number') {
      fieldDef += ` ${fieldType}(${fieldLength})`
    } else {
      fieldDef += ` ${fieldType}`
    }

    switch (fieldType.toLowerCase()) {
      case 'varchar':
      case 'text':
        if (commonConfig?.default_config?.mysql?.table?.mysql_charset) {
          fieldDef += ` CHARACTER SET ${commonConfig.default_config.mysql.table.mysql_charset}`
        }
        if (commonConfig?.default_config?.mysql?.table?.mysql_collation) {
          fieldDef += ` COLLATE ${commonConfig.default_config.mysql.table.mysql_collation}`
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
      fieldDef += ` DEFAULT ${defaultValue}`
    }
  }

  // COMMENT
  if (field.comment) {
    fieldDef += ` COMMENT '${field.comment}'`
  }

  if (field.is_commented_out) {
    fieldDef = `-- ${fieldDef}`
  }

  return fieldDef
}

// ===== PostgreSQL 字段定义 =====

function getFieldDefinitionPostgreSQL(field: Field): string {
  let fieldDef = `"${field.field_name}"`

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

// ===== MySQL 索引定义 =====

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

  const colList = index.columns.map(c => '`' + c + '`').join(', ')

  if (indexType === 'unique') {
    // 也可以写作 UNIQUE INDEX `indexName` (`column1`, `column2`) USING BTREE
    if (index.columns.length > 1) {
      return `UNIQUE INDEX \`${indexName}\` (${colList})${finalIndexUsing}`
    }
    return `UNIQUE KEY (${colList})`
  } else {
    return `INDEX \`${indexName}\` (${colList})${finalIndexUsing}`
  }
}

// ===== 解析公共字段 =====

function resolveField(field: Field, commonConfig: CommonConfig | null): Field {
  if (field.use_common_used_fields && commonConfig) {
    return commonConfig.common_used_fields[field.field_name] || field
  }
  return field
}

// ===== comment_before_table 输出 =====

function renderCommentBeforeTable(comment: string | (string | null)[] | undefined): string {
  if (!comment) return ''
  let result = ''
  if (Array.isArray(comment)) {
    result += comment.map(c => {
      if (c === null) {
        return '\n'
      } else if (c.trim() === '') {
        return '--\n'
      } else {
        return `-- ${c}\n`
      }
    }).join('')
  } else {
    result += `-- ${comment}\n`
  }
  return result
}

// ===== comment_before_fields 输出 =====

function renderCommentBeforeField(comment: string | (string | null)[]): string {
  if (Array.isArray(comment)) {
    return comment.map(c => {
      if (c === null) {
        return '\n'
      } else if (c.trim() === '') {
        return '  --\n'
      } else {
        return `  -- ${c}\n`
      }
    }).join('')
  } else {
    return `  -- ${comment}\n`
  }
}

// ===== 生成单表 MySQL =====

export function generateTableMySQL(table: Table, commonConfig: CommonConfig | null): string {
  let sql = ''

  sql += renderCommentBeforeTable(table.comment_before_table)

  sql += `-- ----------------------------\n`
  sql += `-- Table structure for ${table.name}\n`
  sql += `-- ----------------------------\n`

  // DROP TABLE IF EXISTS
  sql += `DROP TABLE IF EXISTS \`${table.name}\`;\n`

  // CREATE TABLE
  sql += `CREATE TABLE \`${table.name}\` (\n`

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
    let indexDef = `  ${getMySQLIndexDefinition(index)}`
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
  sql += ` COMMENT = '${table.comment}'`
  sql += ' ROW_FORMAT = Dynamic;\n'

  return sql
}

// ===== 生成单表 PostgreSQL =====

export function generateTablePostgreSQL(table: Table, schemaName: string, commonConfig: CommonConfig | null): string {
  let sql = ''

  sql += renderCommentBeforeTable(table.comment_before_table)

  sql += `-- ----------------------------\n`
  sql += `-- Table structure for ${table.name}\n`
  sql += `-- ----------------------------\n`

  // DROP TABLE IF EXISTS
  sql += `DROP TABLE IF EXISTS "${schemaName}"."${table.name}";\n`

  // CREATE TABLE
  sql += `CREATE TABLE "${schemaName}"."${table.name}" (\n`

  // 字段定义
  const fieldDefinitions = table.fields.map(field => {
    const fieldConfig = resolveField(field, commonConfig)
    let fieldDef = `  ${getFieldDefinitionPostgreSQL(fieldConfig)}`

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
    indexDefinitions.push(`  PRIMARY KEY ("${primaryKeyField.field_name}")`)
  }

  // UNIQUE 索引在建表语句中定义
  table.indexes.forEach(index => {
    if (index.type === 'unique' || index.pgsql?.type === 'unique') {
      indexDefinitions.push(`  UNIQUE (${index.columns.map(col => `"${col}"`).join(', ')})`)
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
      indexName = indexName?.replace('{pre}', `idx__${table.name}__`).replace('{post}', '')
      sql += `CREATE INDEX "${indexName}" ON "${schemaName}"."${table.name}" (${index.columns.map(col => `"${col}"`).join(', ')});\n`
      hasCreateIndexSql = true
    }
  })

  if (hasCreateIndexSql) {
    sql += '\n'
  }

  // 表级注释 - 使用 COMMENT ON TABLE 语句
  sql += `COMMENT ON TABLE "${schemaName}"."${table.name}" IS '${table.comment}';\n`
  sql += '\n'

  // 字段注释 - 使用 COMMENT ON COLUMN 语句
  table.fields
    .filter(field => !field.is_commented_out)
    .forEach(field => {
      const fieldConfig = resolveField(field, commonConfig)
      if (fieldConfig.comment) {
        sql += `COMMENT ON COLUMN "${schemaName}"."${table.name}"."${fieldConfig.field_name}" IS '${fieldConfig.comment}';\n`
      }
    })

  return sql
}

// ===== 生成整个 schema 的 MySQL SQL =====

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

  schema.tables.forEach(table => {
    sql += generateTableMySQL(table, commonConfig)
    sql += '\n\n\n'
  })

  sql = sql.trimEnd() + '\n\n' + 'SET FOREIGN_KEY_CHECKS = 1;' + '\n'

  return sql
}

// ===== 生成整个 schema 的 PostgreSQL SQL =====

export function generateSchemaPostgreSQL(schema: Schema, commonConfig: CommonConfig | null): string {
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
  sql += `DROP SCHEMA IF EXISTS "${schema.schema}" CASCADE;\n`
  sql += `CREATE SCHEMA "${schema.schema}";\n\n`

  schema.tables.forEach(table => {
    sql += generateTablePostgreSQL(table, schema.schema, commonConfig)
    sql += '\n\n'
  })

  sql = sql.trimEnd() + '\n'

  return sql
}

// ===== Initial Data INSERT 语句生成 =====

/** 将 JS 值格式化为 SQL 字面量（适用于 MySQL 和 PostgreSQL） */
function formatSqlValue(val: unknown): string {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE'
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

/** 获取 Table 的有效字段名列表（排除 is_commented_out 的字段），解析 common fields */
function getTableColumnNames(table: Table, commonConfig: CommonConfig | null): string[] {
  return table.fields
    .filter(f => !resolveField(f, commonConfig).is_commented_out)
    .map(f => resolveField(f, commonConfig).field_name)
}

/** 生成单表的 MySQL INSERT 语句 */
function generateInitialDataMySQL(
  table: Table,
  rows: Record<string, any>[]
): string {
  const cols = getTableColumnNames(table, null)  // MySQL DDL 也是用同名字段，不需要 commonConfig 解析字段名（name 在 INSERT 中用引号括起来即可）
  // 实际需要用 resolveField 处理，重新获取列名
  // 列名保持原样，INSERT 中只需字段名一致
  if (cols.length === 0 || rows.length === 0) return ''

  const colList = cols.map(c => `\`${c}\``).join(', ')

  const valueRows = rows.map(row => {
    const vals = cols.map(col => formatSqlValue(row[col]))
    return `(${vals.join(', ')})`
  })

  return `INSERT INTO \`${table.name}\` (${colList}) VALUES\n${valueRows.join(',\n')};\n`
}

/** 生成单表的 PostgreSQL INSERT 语句 */
function generateInitialDataPostgreSQL(
  table: Table,
  schemaName: string,
  rows: Record<string, any>[]
): string {
  const cols = getTableColumnNames(table, null)
  if (cols.length === 0 || rows.length === 0) return ''

  const colList = cols.map(c => `"${c}"`).join(', ')

  const valueRows = rows.map(row => {
    const vals = cols.map(col => formatSqlValue(row[col]))
    return `(${vals.join(', ')})`
  })

  return `INSERT INTO "${schemaName}"."${table.name}" (${colList}) VALUES\n${valueRows.join(',\n')};\n`
}

/** 生成所有 Schema 的 MySQL initial data INSERT 汇总 */
export function generateInitialDataAllMySQL(
  schemas: Schema[],
  initialDataMap: Map<string, Record<string, any>[]>,
  commonConfig: CommonConfig | null
): string {
  let sql = ''

  sql += '/*\n'
  sql += ' Initial Data - MySQL\n'
  sql += '*/\n\n'
  sql += 'SET NAMES utf8mb4;\n\n'

  for (const schema of schemas) {
    for (const table of schema.tables) {
      const key = `${schema.schema}/${table.name}`
      const rows = initialDataMap.get(key)
      if (!rows || rows.length === 0) continue

      sql += `-- ----------------------------\n`
      sql += `-- Initial data for ${schema.schema}.${table.name}\n`
      sql += `-- ----------------------------\n`
      sql += generateInitialDataMySQL(table, rows)
      sql += '\n'
    }
  }

  return sql
}

/** 生成所有 Schema 的 PostgreSQL initial data INSERT 汇总 */
export function generateInitialDataAllPostgreSQL(
  schemas: Schema[],
  initialDataMap: Map<string, Record<string, any>[]>,
  commonConfig: CommonConfig | null
): string {
  let sql = ''

  sql += '/*\n'
  sql += ' Initial Data - PostgreSQL\n'
  sql += '*/\n\n'

  for (const schema of schemas) {
    for (const table of schema.tables) {
      const key = `${schema.schema}/${table.name}`
      const rows = initialDataMap.get(key)
      if (!rows || rows.length === 0) continue

      sql += `-- ----------------------------\n`
      sql += `-- Initial data for ${schema.schema}.${table.name}\n`
      sql += `-- ----------------------------\n`
      sql += generateInitialDataPostgreSQL(table, schema.schema, rows)
      sql += '\n'
    }
  }

  return sql
}
