export type SqlDialect = 'mysql' | 'postgresql' | 'sqlite'

/** 全部受支持的方言（顺序即 SQL 输出、UI 方言切换页签的展示顺序） */
export const ALL_SQL_DIALECTS: SqlDialect[] = ['mysql', 'postgresql', 'sqlite']

// ===== 解析公共字段 =====

import type { CommonConfig, Field, Table, Schema, InitialData, InitialDataRow, TypeCaseMode, CommentOption, Index } from "@/types/schema"
import { resolveDialectOverride } from "@/utils/dialect-resolver"

export function resolveField(field: Field, commonConfig: CommonConfig | null): Field {
  if (field.use_common_used_fields && commonConfig) {
    return commonConfig.common_used_fields[field.field_name] || field
  }
  return field
}

// ===== 索引名称解析 =====

/**
 * 解析索引名称中的 {pre} / {post} 占位符，返回最终索引名。
 * 前缀规则按方言与索引类型区分（与 mysql.ts / postgresql.ts / sqlite.ts 的建表、索引 DDL 生成保持一致）：
 * - mysql:      {pre} → uk_ / idx_
 * - sqlite:     {pre} → uk_ / idx_
 * - postgresql: {pre} → uk__<table>__ / idx__<table>__（同库内索引名全局唯一，故带表名）
 *
 * {post} 三种方言均展开为空串。名称为空时的处理按方言区分：
 * - mysql:      返回 undefined，由调用方省略索引名（MySQL 自动按首列命名）
 * - sqlite:     回退「前缀 + 列名拼接」
 * - postgresql: 回退「前缀 + 列名拼接」（前缀已含表名）
 *
 * @param index     索引配置
 * @param dialect   目标方言
 * @param tableName 所属表名（仅 postgresql 前缀需要）
 */
export function resolveIndexName(index: Index, dialect: SqlDialect, tableName: string): string | undefined {
  const indexType = resolveDialectOverride(index, dialect, 'type', index.type)
  const indexName = resolveDialectOverride(index, dialect, 'name', index.name)

  switch (dialect) {
    case 'sqlite': {
      const prefix = indexType === 'unique' ? 'uk_' : 'idx_'
      return (
        indexName?.replace('{pre}', prefix).replace('{post}', '') ||
        `${prefix}${index.columns.map(c => c.name).join('_')}`
      )
    }
    case 'postgresql': {
      const prefix = indexType === 'unique' ? `uk__${tableName}__` : `idx__${tableName}__`
      return (
        indexName?.replace('{pre}', prefix).replace('{post}', '') ||
        `${prefix}${index.columns.map(c => c.name).join('_')}`
      )
    }
    default:
    case 'mysql': {
      const prefix = indexType === 'unique' ? 'uk_' : 'idx_'
      return indexName?.replace('{pre}', prefix).replace('{post}', '')
    }
  }
}

// ===== 统一类型解析 =====

/**
 * 解析字段在指定数据库方言中的最终类型信息
 * 优先级（由低到高）：
 *   1. unified_type 映射（从 CommonConfig.unified_types 查找）
 *   2. field.field_type / field.field_length（字段级覆盖，对所有数据库生效）
 *   3. field[dialect].field_type / field[dialect].field_length（方言覆盖）
 *
 * 当 unified_type 为空时，从第 2 层开始（向后兼容旧数据）
 */
export function resolveFieldTypeForDialect(
  field: Field,
  dialect: SqlDialect,
  commonConfig: CommonConfig | null,
): { type: string; length: number | null; scale: number | null } {
  let type = ''
  let length: number | null = null
  let scale: number | null = null

  // 第 1 层：unified_type 映射
  if (field.unified_type && commonConfig?.unified_types) {
    const def = commonConfig.unified_types.find(ut => ut.name === field.unified_type)
    // 方言映射可能缺失（如旧 common.json 的 unified_types 无 sqlite 键），此时跳过该层
    const mapping = def?.[dialect]
    if (mapping) {
      type = mapping.type
      length = mapping.length ?? null
      scale = mapping.scale ?? null
    }
  }

  // 第 2 层：字段级 bare 属性（当 unified_type 未命中时作为 base，命中时可作为 override）
  // 注意：null 表示用户清空了输入框，不应覆盖 unified_type 的值
  if (!type && field.field_type) {
    type = field.field_type
    length = field.field_length ?? null
    scale = field.field_scale ?? null
  }
  // 当 unified_type 已给出 type 值，field.field_type 可作为覆盖
  if (field.field_type !== undefined && field.field_type !== '') {
    type = field.field_type
  }
  if (field.field_length != null) {
    length = field.field_length
  }
  if (field.field_scale != null) {
    scale = field.field_scale
  }

  // 第 3 层：数据库方言覆盖
  const dbOverride = field[dialect]
  if (dbOverride) {
    if (dbOverride.field_type !== undefined && dbOverride.field_type !== '') {
      type = dbOverride.field_type
    }
    if (dbOverride.field_length !== undefined) {
      length = dbOverride.field_length
    }
    if (dbOverride.field_scale !== undefined) {
      scale = dbOverride.field_scale
    }
  }

  // 用户勾选了「不设置」，强制跳过长度/小数位（最终裁决）
  if (field.field_length_disabled) {
    length = null
  }
  if (field.field_scale_disabled) {
    scale = null
  }

  // 应用全局类型大小写转换
  type = applyTypeCase(type, commonConfig?.type_case)

  return { type: type || '', length, scale }
}

/** 根据 type_case 配置转换类型名大小写 */
export function applyTypeCase(type: string, mode: TypeCaseMode | undefined): string {
  if (!type || !mode || mode === 'keep') return type
  switch (mode) {
    case 'lowercase':
      return type.toLowerCase()
    case 'uppercase':
      return type.toUpperCase()
    case 'pascal':
      // 大驼峰（PascalCase）：首字母大写，其余小写
      return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()
    default:
      return type
  }
}

/**
 * 解析字段默认值是否需要引号包裹
 * 优先级：field.quote_default > unified_type.quote_default > 默认 false
 */
export function resolveQuoteDefault(
  field: Field,
  commonConfig: CommonConfig | null,
): boolean {
  // 字段级显式设置优先
  if (field.quote_default !== undefined) return field.quote_default
  // 从 unified_type 定义中获取
  if (field.unified_type && commonConfig?.unified_types) {
    const def = commonConfig.unified_types.find(ut => ut.name === field.unified_type)
    if (def?.quote_default !== undefined) return def.quote_default
  }
  // 默认不加引号（保持向后兼容，旧数据中 default 值已自带引号）
  return false
}

/**
 * 格式化 SQL DEFAULT 值
 * - 特殊 SQL 表达式（如 CURRENT_TIMESTAMP）原样输出
 * - quote=true 时用单引号包裹并转义
 * - quote=false 时原样输出（适用于数字、布尔等）
 */
export function formatSqlDefault(value: any, quote: boolean): string {
  const str = String(value)
  // 特殊 SQL 表达式：保持原样
  if (typeof value === 'string' && (value === 'CURRENT_TIMESTAMP' || value.includes('CURRENT_TIMESTAMP'))) {
    return str
  }
  if (quote) {
    return `'${str.replace(/'/g, "''")}'`
  }
  return str
}

// ===== 字段注释（含选项含义自动拼接） =====

/** 获取选项在指定方言下的值（方言覆盖优先，否则回退通用值） */
function resolveOptionValue(opt: CommentOption, dialect: SqlDialect): string {
  if (dialect === 'mysql') return (opt.mysql ?? opt.value ?? '').trim()
  if (dialect === 'postgresql') return (opt.postgresql ?? opt.value ?? '').trim()
  if (dialect === 'sqlite') return (opt.sqlite ?? opt.value ?? '').trim()
  return ''
}

/** 将字段 default 值按方言渲染为展示文本（布尔：mysql/sqlite→1/0，pg→TRUE/FALSE） */
function formatDefaultForCommentDialect(value: unknown, dialect: SqlDialect): string {
  if (typeof value === 'boolean') {
    switch (dialect) {
      case 'mysql':
      case 'sqlite':  // SQLite 无原生布尔类型，惯例以 1/0 存储
        return value ? '1' : '0'
      case 'postgresql':
        return value ? 'TRUE' : 'FALSE'
    }
  }
  return String(value)
}

/**
 * 构建字段在指定方言下的最终注释文本。
 * - 未启用选项含义或无选项：直接返回原始 comment。
 * - 启用时：`原注释：值-含义，值-含义，默认X`（全角冒号/逗号）。
 *   默认部分复用字段已有 default（带方言覆盖），为空时不输出。
 */
export function buildFieldComment(field: Field, dialect: SqlDialect): string {
  const base = field.comment ?? ''
  if (!field.comment_options_enabled || !field.comment_options || field.comment_options.length === 0) {
    return base
  }

  const parts: string[] = []
  for (const opt of field.comment_options) {
    const val = resolveOptionValue(opt, dialect)
    const label = (opt.label ?? '').trim()
    if (val === '' && label === '') continue
    parts.push(`${val}-${label}`)
  }
  if (parts.length === 0) return base

  let optionsText = parts.join('，')

  // 默认值：复用字段 default（方言覆盖优先），按方言渲染
  const defaultValue = field[dialect]?.default ?? field.default
  if (defaultValue !== undefined && defaultValue !== '') {
    optionsText += `，默认${formatDefaultForCommentDialect(defaultValue, dialect)}`
  }

  return base ? `${base}：${optionsText}` : optionsText
}

// ===== comment_before_table 输出 =====

export function renderCommentBeforeTable(comment: string | (string | null)[] | undefined): string {
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

export function renderCommentBeforeField(comment: string | (string | null)[]): string {
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

// ===== Initial Data INSERT 语句生成 =====

/** 获取 Table 的有效字段名列表（排除 is_commented_out 的字段），解析 common fields */
export function getTableColumnNames(table: Table, commonConfig: CommonConfig | null): string[] {
  return table.fields
    .filter(f => !resolveField(f, commonConfig).is_commented_out)
    .map(f => resolveField(f, commonConfig).field_name)
}

// ===== 前置/后置 SQL 辅助 =====

export function getTablePreSql(table: Table, dialect: SqlDialect): string {
  return table.pre_sql?.[dialect] || ''
}

export function getTablePostSql(table: Table, dialect: SqlDialect): string {
  return table.post_sql?.[dialect] || ''
}

export function getSchemaPreSql(schema: Schema, dialect: SqlDialect): string {
  return schema.pre_sql?.[dialect] || ''
}

export function getSchemaPostSql(schema: Schema, dialect: SqlDialect): string {
  return schema.post_sql?.[dialect] || ''
}

export function getGlobalPreSql(commonConfig: CommonConfig | null, dialect: SqlDialect): string {
  if (!commonConfig) return ''
  if (dialect === 'mysql') return commonConfig.default_config.mysql.pre_sql || ''
  if (dialect === 'postgresql') return commonConfig.default_config.postgresql.pre_sql || ''
  if (dialect === 'sqlite') return commonConfig.default_config.sqlite?.pre_sql || ''
  return ''
}

export function getGlobalPostSql(commonConfig: CommonConfig | null, dialect: SqlDialect): string {
  if (!commonConfig) return ''
  if (dialect === 'mysql') return commonConfig.default_config.mysql.post_sql || ''
  if (dialect === 'postgresql') return commonConfig.default_config.postgresql.post_sql || ''
  if (dialect === 'sqlite') return commonConfig.default_config.sqlite?.post_sql || ''
  return ''
}

export function fmtPrePostSql(sql: string): string {
  if (!sql) return ''
  // 确保 SQL 以分号结尾，并添加换行
  let result = sql.trimEnd()
  if (result && !result.endsWith(';')) result += ';'
  return result + '\n'
}

// ===== Initial-Data 级别 pre/post SQL =====

export function getInitialDataPreSql(initialData: InitialData, dialect: SqlDialect): string {
  return initialData.pre_sql?.[dialect] || ''
}

export function getInitialDataPostSql(initialData: InitialData, dialect: SqlDialect): string {
  return initialData.post_sql?.[dialect] || ''
}

/**
 * 过滤掉被标记为「不生成」(is_skip === true) 的初始数据行
 * 从行内结构中提取有效行的裸数据与对应行注释（索引已对齐），供 INSERT 生成逻辑使用。
 * 注意：仅剔除 skip 行，不改变未填字段（保持 NULL 语义，由生成器处理）。
 */
export function filterInitialDataRows(
  rows: InitialDataRow[] | undefined
): {
  rows: Record<string, any>[]
  rowComments: (string | null)[]
  hasRows: boolean
} {
  const srcRows = rows ?? []
  const result: Record<string, any>[] = []
  const resultComments: (string | null)[] = []
  for (const row of srcRows) {
    if (row.is_skip === true) continue
    result.push(row.data ?? {})
    resultComments.push(row.row_comment ?? null)
  }
  return {
    rows: result,
    rowComments: resultComments,
    hasRows: result.length > 0,
  }
}

// ===== 分区表（PARTITION BY） =====

/**
 * 根据表的方言分区配置生成 `PARTITION BY ...` 裸子句（**不含**前导空格 / 逗号）。
 * 未配置或配置无效时返回空字符串。
 *
 * 注意：分区是表级子句，必须与主键 / 索引**并列**（用逗号分隔，缩进一致），
 * 调用方需自行处理逗号与前导缩进（`  `），例如拼成 `,\n  PARTITION BY ...`。
 *
 * 支持两种模式：
 * - 结构化：设置 `strategy` + `columns` → `PARTITION BY <strategy> (col1, col2)`
 * - 原始：仅设置 `expression` → `PARTITION BY <expression>`
 *
 * 分区列名按对应方言的标识符引用规则加引号（MySQL 用反引号，PostgreSQL / SQLite 用双引号）。
 *
 * 注意：SQLite 不支持 `PARTITION BY`，其分区配置仅保留结构占位，不会生成子句。
 */
export function getTablePartitionClause(
  table: Table,
  dialect: SqlDialect,
  commonConfig: CommonConfig | null,
): string {
  const cfg = table.partition?.[dialect]
  if (!cfg) return ''
  // SQLite 无分区表语法
  if (dialect === 'sqlite') return ''

  const quote = (name: string): string => {
    if (dialect === 'mysql') return `\`${name}\``
    const shouldQuote = commonConfig?.default_config?.postgresql?.quote_identifiers ?? true
    return shouldQuote ? `"${name}"` : name
  }

  // 结构化模式：strategy + columns
  if (cfg.strategy && cfg.columns && cfg.columns.length > 0) {
    const cols = cfg.columns.map(c => c.trim()).filter(Boolean).map(quote).join(', ')
    if (cols) return `PARTITION BY ${cfg.strategy} (${cols})`
  }

  // 原始表达式兜底模式
  if (cfg.expression && cfg.expression.trim()) {
    return `PARTITION BY ${cfg.expression.trim()}`
  }

  return ''
}
