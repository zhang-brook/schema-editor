/**
 * SQL 类型映射器 — 三级回退策略
 *
 * 将解析出的 SQL 原始类型映射到项目的 Field 结构。
 * Level 1: 精确匹配统一类型（比较类型名 + 可选长度/scale）
 * Level 2: 匹配统一类型但覆盖 SQL 中的具体长度/scale
 * Level 3: 无匹配时回退到原始 SQL 类型
 */

import type { UnifiedTypeDefinition, Field } from '@/types/schema'
import type { ParsedColumn } from './create-table-parser'

/** 类型映射结果 */
export interface TypeMappingResult {
  /** 匹配到的统一类型名（Level 1/2 时有效） */
  unified_type?: string
  /** 未匹配到统一类型时的原始类型名（Level 3 时有效） */
  field_type?: string
  /** 字段长度 */
  field_length?: number | null
  /** 小数位 */
  field_scale?: number | null
  /** 默认值是否需要引号包裹 */
  quote_default?: boolean
  /** 勾选后强制跳过长度输出 */
  field_length_disabled?: boolean
  /** 勾选后强制跳过小数位输出 */
  field_scale_disabled?: boolean
}

// ===== MySQL 类型别名规范化 =====

/**
 * MySQL 有些类型是别名，需要规范化为标准名再匹配
 * 返回规范化后的类型名
 */
function normalizeMySqlType(rawType: string): { type: string; length?: number | null; scale?: number | null } {
  const upper = rawType.toUpperCase()

  // BOOLEAN / BOOL 在 MySQL 中等同于 TINYINT(1)
  if (upper === 'BOOLEAN' || upper === 'BOOL') {
    return { type: 'TINYINT', length: 1 }
  }

  // INT 别名
  if (upper === 'INTEGER') return { type: 'INT' }

  // DEC / FIXED 别名
  if (upper === 'DEC' || upper === 'FIXED') return { type: 'DECIMAL' }

  // CHARACTER → CHAR
  if (upper === 'CHARACTER') return { type: 'CHAR' }

  // CHARACTER VARYING → VARCHAR
  if (upper === 'CHARACTER VARYING') return { type: 'VARCHAR' }

  // DOUBLE PRECISION → DOUBLE
  if (upper === 'DOUBLE PRECISION') return { type: 'DOUBLE' }

  // REAL → FLOAT (MySQL 中 REAL 是 FLOAT 的同义词)
  if (upper === 'REAL') return { type: 'FLOAT' }

  // NUMERIC → DECIMAL
  if (upper === 'NUMERIC') return { type: 'DECIMAL' }

  // SERIAL → BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
  if (upper === 'SERIAL') return { type: 'BIGINT' }

  return { type: upper }
}

// ===== PostgreSQL 类型别名规范化 =====

function normalizePgSqlType(rawType: string): { type: string; length?: number | null; scale?: number | null } {
  const upper = rawType.toUpperCase()

  // INT / INT4 → INTEGER
  if (upper === 'INT' || upper === 'INT4') return { type: 'INTEGER' }

  // BIGINT / INT8 → BIGINT
  if (upper === 'INT8') return { type: 'BIGINT' }

  // SMALLINT / INT2 → SMALLINT
  if (upper === 'INT2') return { type: 'SMALLINT' }

  // SERIAL → INTEGER (PG 中 SERIAL 本质是 INTEGER + auto-increment)
  if (upper === 'SERIAL') return { type: 'INTEGER' }

  // BIGSERIAL → BIGINT
  if (upper === 'BIGSERIAL') return { type: 'BIGINT' }

  // SMALLSERIAL → SMALLINT
  if (upper === 'SMALLSERIAL') return { type: 'SMALLINT' }

  // BOOL → BOOLEAN
  if (upper === 'BOOL') return { type: 'BOOLEAN' }

  // CHAR / CHARACTER → CHAR
  if (upper === 'CHARACTER') return { type: 'CHAR' }

  // CHARACTER VARYING → VARCHAR
  if (upper === 'CHARACTER VARYING') return { type: 'VARCHAR' }

  // DOUBLE PRECISION / FLOAT8 → DOUBLE PRECISION
  if (upper === 'FLOAT8') return { type: 'DOUBLE PRECISION' }

  // REAL / FLOAT4 → REAL
  if (upper === 'FLOAT4') return { type: 'REAL' }

  // NUMERIC → DECIMAL
  if (upper === 'NUMERIC') return { type: 'DECIMAL' }

  // TIMESTAMP WITHOUT TIME ZONE / TIMESTAMPTZ
  if (upper === 'TIMESTAMP WITHOUT TIME ZONE') return { type: 'TIMESTAMP' }
  if (upper === 'TIMESTAMP WITH TIME ZONE') return { type: 'TIMESTAMPTZ' }
  if (upper === 'TIME WITHOUT TIME ZONE') return { type: 'TIME' }
  if (upper === 'TIME WITH TIME ZONE') return { type: 'TIMETZ' }

  return { type: upper }
}

// ===== 主映射函数 =====

/**
 * 将解析出的 SQL 列类型映射到项目的 Field 结构
 *
 * @param column - 解析后的列定义
 * @param dialect - 数据库方言
 * @param unifiedTypes - 统一类型列表
 * @returns 类型映射结果
 */
export function mapSqlTypeToField(
  column: ParsedColumn,
  dialect: 'mysql' | 'postgresql',
  unifiedTypes: UnifiedTypeDefinition[],
): TypeMappingResult {
  // 规范化类型名
  let normalized: { type: string; length?: number | null; scale?: number | null }
  if (dialect === 'mysql') {
    normalized = normalizeMySqlType(column.rawType)
  } else {
    normalized = normalizePgSqlType(column.rawType)
  }

  const normType = normalized.type

  // 使用 SQL 中的长度/scale，除非规范化过程中已经指定了
  const sqlLength = normalized.length !== undefined ? normalized.length : column.length
  const sqlScale = normalized.scale !== undefined ? normalized.scale : column.scale

  // ===== Level 1: 精确匹配统一类型 =====
  for (const ut of unifiedTypes) {
    const mapping = ut[dialect]
    if (!mapping) continue

    // 类型名比较（大小写不敏感）
    if (mapping.type.toUpperCase() !== normType.toUpperCase()) continue

    // 长度比较：undefined 表示不限制（任意长度都匹配）
    if (mapping.length !== undefined && mapping.length !== null) {
      if (sqlLength !== mapping.length) continue
    }

    // scale 比较：undefined 表示不限制
    if (mapping.scale !== undefined && mapping.scale !== null) {
      if (sqlScale !== mapping.scale) continue
    }

    // Level 1 精确匹配！
    const result: TypeMappingResult = {
      unified_type: ut.name,
    }

    // Level 2: 如果 SQL 中提供了具体值但统一类型未指定，设置为字段级覆盖
    if ((mapping.length === undefined || mapping.length === null) && sqlLength != null) {
      result.field_length = sqlLength
    }
    if ((mapping.scale === undefined || mapping.scale === null) && sqlScale != null) {
      result.field_scale = sqlScale
    }

    // quote_default 从统一类型定义获取
    if (ut.quote_default !== undefined) {
      result.quote_default = ut.quote_default
    }

    // 长度/scale 禁用标记
    if (mapping.length === null) {
      result.field_length_disabled = true
    }
    if (mapping.scale === null) {
      result.field_scale_disabled = true
    }

    // 特殊处理：SERIAL 类型
    if (column.rawType.toUpperCase() === 'SERIAL' || column.rawType.toUpperCase() === 'BIGSERIAL') {
      result.field_length_disabled = true
    }

    return result
  }

  // ===== Level 2: 部分匹配（类型名匹配但长度/scale 不满足精确条件）=====
  for (const ut of unifiedTypes) {
    const mapping = ut[dialect]
    if (!mapping) continue

    if (mapping.type.toUpperCase() !== normType.toUpperCase()) continue

    // 类型名匹配但长度或 scale 不匹配 → 仍使用统一类型，但覆盖具体值
    const result: TypeMappingResult = {
      unified_type: ut.name,
    }

    if (sqlLength != null) {
      result.field_length = sqlLength
    }
    if (sqlScale != null) {
      result.field_scale = sqlScale
    }

    if (ut.quote_default !== undefined) {
      result.quote_default = ut.quote_default
    }

    return result
  }

  // ===== Level 3: 回退到原始类型 =====
  const result: TypeMappingResult = {
    field_type: column.rawType.toUpperCase(),
  }

  if (sqlLength != null) {
    result.field_length = sqlLength
  }
  if (sqlScale != null) {
    result.field_scale = sqlScale
  }

  // 无参数类型默认禁用长度/scale
  if (sqlLength == null && sqlScale == null) {
    // 检查是否是典型的无参数类型
    const noParamTypes = new Set([
      'TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT',
      'DATE', 'DATETIME', 'TIME', 'TIMESTAMP', 'TIMESTAMPTZ', 'YEAR',
      'JSON', 'JSONB', 'BOOLEAN', 'BOOL',
      'BLOB', 'LONGBLOB', 'MEDIUMBLOB', 'TINYBLOB',
      'BYTEA', 'UUID', 'INTERVAL', 'INET', 'CIDR',
      'SERIAL', 'BIGSERIAL', 'SMALLSERIAL',
    ])
    if (noParamTypes.has(normType)) {
      result.field_length_disabled = true
      result.field_scale_disabled = true
    }
  }

  return result
}

/**
 * 将 ParsedColumn 转换为项目的 Field 对象
 */
export function convertColumnToField(
  column: ParsedColumn,
  dialect: 'mysql' | 'postgresql',
  unifiedTypes: UnifiedTypeDefinition[],
): Field {
  const typeInfo = mapSqlTypeToField(column, dialect, unifiedTypes)

  const field: Field = {
    field_name: column.name,
  }

  // 设置类型信息
  if (typeInfo.unified_type) {
    field.unified_type = typeInfo.unified_type
  }
  if (typeInfo.field_type) {
    field.field_type = typeInfo.field_type
  }
  if (typeInfo.field_length !== undefined) {
    field.field_length = typeInfo.field_length
  }
  if (typeInfo.field_scale !== undefined) {
    field.field_scale = typeInfo.field_scale
  }
  if (typeInfo.quote_default !== undefined) {
    field.quote_default = typeInfo.quote_default
  }
  if (typeInfo.field_length_disabled) {
    field.field_length_disabled = true
  }
  if (typeInfo.field_scale_disabled) {
    field.field_scale_disabled = true
  }

  // 约束
  if (column.notNull || column.primaryKey || (dialect === 'postgresql' && ['SERIAL', 'BIGSERIAL'].includes(column.rawType.toUpperCase()))) {
    field.not_null = true
  }
  if (column.primaryKey) {
    field.primary_key = true
  }
  if (column.defaultValue !== undefined && column.defaultValue !== null) {
    field.default = column.defaultValue
  }
  if (column.comment) {
    field.comment = column.comment
  }

  return field
}
