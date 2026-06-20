export type SqlDialect = 'mysql' | 'postgresql'

// ===== 解析公共字段 =====

import type { CommonConfig, Field, Table, Schema, InitialData, TypeCaseMode } from "@/types/schema"

export function resolveField(field: Field, commonConfig: CommonConfig | null): Field {
  if (field.use_common_used_fields && commonConfig) {
    return commonConfig.common_used_fields[field.field_name] || field
  }
  return field
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
  dialect: 'mysql' | 'pgsql',
  commonConfig: CommonConfig | null,
): { type: string; length: number | null; scale: number | null } {
  let type = ''
  let length: number | null = null
  let scale: number | null = null

  // 第 1 层：unified_type 映射
  if (field.unified_type && commonConfig?.unified_types) {
    const def = commonConfig.unified_types.find(ut => ut.name === field.unified_type)
    if (def) {
      const mapping = def[dialect]
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

export function getTablePreSql(table: Table, dialect: 'mysql' | 'pgsql'): string {
  return table.pre_sql?.[dialect] || ''
}

export function getTablePostSql(table: Table, dialect: 'mysql' | 'pgsql'): string {
  return table.post_sql?.[dialect] || ''
}

export function getSchemaPreSql(schema: Schema, dialect: 'mysql' | 'pgsql'): string {
  return schema.pre_sql?.[dialect] || ''
}

export function getSchemaPostSql(schema: Schema, dialect: 'mysql' | 'pgsql'): string {
  return schema.post_sql?.[dialect] || ''
}

export function getGlobalPreSql(commonConfig: CommonConfig | null, dialect: 'mysql' | 'pgsql'): string {
  if (!commonConfig) return ''
  if (dialect === 'mysql') return commonConfig.default_config.mysql.pre_sql || ''
  return commonConfig.default_config.pgsql.pre_sql || ''
}

export function getGlobalPostSql(commonConfig: CommonConfig | null, dialect: 'mysql' | 'pgsql'): string {
  if (!commonConfig) return ''
  if (dialect === 'mysql') return commonConfig.default_config.mysql.post_sql || ''
  return commonConfig.default_config.pgsql.post_sql || ''
}

export function fmtPrePostSql(sql: string): string {
  if (!sql) return ''
  // 确保 SQL 以分号结尾，并添加换行
  let result = sql.trimEnd()
  if (result && !result.endsWith(';')) result += ';'
  return result + '\n'
}

// ===== Initial-Data 级别 pre/post SQL =====

export function getInitialDataPreSql(initialData: InitialData, dialect: 'mysql' | 'pgsql'): string {
  return initialData.pre_sql?.[dialect] || ''
}

export function getInitialDataPostSql(initialData: InitialData, dialect: 'mysql' | 'pgsql'): string {
  return initialData.post_sql?.[dialect] || ''
}
