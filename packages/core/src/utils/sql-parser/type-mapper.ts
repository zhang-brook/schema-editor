/**
 * SQL type mapper — three-level fallback strategy
 *
 * Maps parsed raw SQL types to the project's Field structure.
 * Level 1: exact match of a unified type (compares type name + optional length/scale)
 * Level 2: matches a unified type but overrides the concrete length/scale from the SQL
 * Level 3: falls back to the raw SQL type when nothing matches
 */

import type { UnifiedTypeDefinition, Field } from '../../types/schema'
import type { ParsedColumn } from './create-table-parser'
import type { SqlDialect } from '../sql-generator/shared'

/** Type mapping result */
export interface TypeMappingResult {
  /** Matched unified type name (valid for Level 1/2) */
  unified_type?: string
  /** Raw type name when no unified type matched (valid for Level 3) */
  field_type?: string
  /** Field length */
  field_length?: number | null
  /** Decimal scale */
  field_scale?: number | null
  /** Whether the default value needs to be wrapped in quotes */
  quote_default?: boolean
  /** Force skipping length output when checked */
  field_length_disabled?: boolean
  /** Force skipping scale output when checked */
  field_scale_disabled?: boolean
}

// ===== MySQL type alias normalization =====

/**
 * Some MySQL types are aliases and must be normalized to canonical names before matching
 * Returns the normalized type name
 */
function normalizeMySqlType(rawType: string): { type: string; length?: number | null; scale?: number | null } {
  const upper = rawType.toUpperCase()

  // BOOLEAN / BOOL are equivalent to TINYINT(1) in MySQL
  if (upper === 'BOOLEAN' || upper === 'BOOL') {
    return { type: 'TINYINT', length: 1 }
  }

  // INT alias
  if (upper === 'INTEGER') return { type: 'INT' }

  // DEC / FIXED aliases
  if (upper === 'DEC' || upper === 'FIXED') return { type: 'DECIMAL' }

  // CHARACTER → CHAR
  if (upper === 'CHARACTER') return { type: 'CHAR' }

  // CHARACTER VARYING → VARCHAR
  if (upper === 'CHARACTER VARYING') return { type: 'VARCHAR' }

  // DOUBLE PRECISION → DOUBLE
  if (upper === 'DOUBLE PRECISION') return { type: 'DOUBLE' }

  // REAL → FLOAT (in MySQL, REAL is a synonym for FLOAT)
  if (upper === 'REAL') return { type: 'FLOAT' }

  // NUMERIC → DECIMAL
  if (upper === 'NUMERIC') return { type: 'DECIMAL' }

  // SERIAL → BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
  if (upper === 'SERIAL') return { type: 'BIGINT' }

  return { type: upper }
}

// ===== PostgreSQL type alias normalization =====

function normalizePgSqlType(rawType: string): { type: string; length?: number | null; scale?: number | null } {
  const upper = rawType.toUpperCase()

  // INT / INT4 → INTEGER
  if (upper === 'INT' || upper === 'INT4') return { type: 'INTEGER' }

  // BIGINT / INT8 → BIGINT
  if (upper === 'INT8') return { type: 'BIGINT' }

  // SMALLINT / INT2 → SMALLINT
  if (upper === 'INT2') return { type: 'SMALLINT' }

  // SERIAL → INTEGER (in PG, SERIAL is essentially INTEGER + auto-increment)
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

// ===== SQLite type alias normalization =====

/**
 * Classifies declared types into the five storage classes according to SQLite's
 * "type affinity" rules. The rule order matches the official documentation:
 * INT → INTEGER; CHAR/CLOB/TEXT → TEXT; BLOB → BLOB; REAL/FLOA/DOUB → REAL; everything else → NUMERIC.
 */
function normalizeSqliteType(rawType: string): { type: string; length?: number | null; scale?: number | null } {
  const upper = rawType.toUpperCase()

  // BOOLEAN / BOOL have no native type; conventionally stored as 0/1
  if (upper === 'BOOLEAN' || upper === 'BOOL') return { type: 'INTEGER', length: 1 }

  if (upper.includes('INT')) return { type: 'INTEGER' }
  if (upper.includes('CHAR') || upper.includes('CLOB') || upper.includes('TEXT')) return { type: 'TEXT' }
  if (upper === '' || upper.includes('BLOB')) return { type: 'BLOB' }
  if (upper.includes('REAL') || upper.includes('FLOA') || upper.includes('DOUB')) return { type: 'REAL' }

  return { type: 'NUMERIC' }
}

// ===== Main mapping function =====

/**
 * Maps a parsed SQL column type to the project's Field structure
 *
 * @param column - Parsed column definition
 * @param dialect - Database dialect
 * @param unifiedTypes - List of unified types
 * @returns Type mapping result
 */
export function mapSqlTypeToField(
  column: ParsedColumn,
  dialect: SqlDialect,
  unifiedTypes: UnifiedTypeDefinition[],
): TypeMappingResult {
  // Normalize the type name
  let normalized: { type: string; length?: number | null; scale?: number | null }
  if (dialect === 'mysql') {
    normalized = normalizeMySqlType(column.rawType)
  } else if (dialect === 'postgresql') {
    normalized = normalizePgSqlType(column.rawType)
  } else if (dialect === 'sqlite') {
    normalized = normalizeSqliteType(column.rawType)
  } else {
    throw new Error(`Unsupported SQL dialect: ${dialect}`)
  }

  const normType = normalized.type

  // Use the length/scale from SQL unless the normalization step already specified them
  const sqlLength = normalized.length !== undefined ? normalized.length : column.length
  const sqlScale = normalized.scale !== undefined ? normalized.scale : column.scale

  // ===== Level 1: exact match of a unified type =====
  for (const ut of unifiedTypes) {
    const mapping = ut[dialect]
    if (!mapping) continue

    // Type name comparison (case-insensitive)
    if (mapping.type.toUpperCase() !== normType.toUpperCase()) continue

    // Length comparison: undefined means unrestricted (any length matches)
    if (mapping.length !== undefined && mapping.length !== null) {
      if (sqlLength !== mapping.length) continue
    }

    // Scale comparison: undefined means unrestricted
    if (mapping.scale !== undefined && mapping.scale !== null) {
      if (sqlScale !== mapping.scale) continue
    }

    // Level 1 exact match!
    const result: TypeMappingResult = {
      unified_type: ut.name,
    }

    // Level 2: if SQL provides a concrete value but the unified type does not specify one, set it as a field-level override
    if ((mapping.length === undefined || mapping.length === null) && sqlLength != null) {
      result.field_length = sqlLength
    }
    if ((mapping.scale === undefined || mapping.scale === null) && sqlScale != null) {
      result.field_scale = sqlScale
    }

    // quote_default comes from the unified type definition
    if (ut.quote_default !== undefined) {
      result.quote_default = ut.quote_default
    }

    // Length/scale disable flags
    if (mapping.length === null) {
      result.field_length_disabled = true
    }
    if (mapping.scale === null) {
      result.field_scale_disabled = true
    }

    // Special case: SERIAL types
    if (column.rawType.toUpperCase() === 'SERIAL' || column.rawType.toUpperCase() === 'BIGSERIAL') {
      result.field_length_disabled = true
    }

    return result
  }

  // ===== Level 2: partial match (type name matches but length/scale does not meet the exact criteria) =====
  for (const ut of unifiedTypes) {
    const mapping = ut[dialect]
    if (!mapping) continue

    if (mapping.type.toUpperCase() !== normType.toUpperCase()) continue

    // Type name matches but length or scale does not → still use the unified type, but override with the concrete values
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

  // ===== Level 3: fall back to the raw type =====
  const result: TypeMappingResult = {
    field_type: column.rawType.toUpperCase(),
  }

  if (sqlLength != null) {
    result.field_length = sqlLength
  }
  if (sqlScale != null) {
    result.field_scale = sqlScale
  }

  // Parameterless types disable length/scale by default
  if (sqlLength == null && sqlScale == null) {
    // Check whether it is a typical parameterless type (including SQLite's five storage classes)
    const noParamTypes = new Set([
      'TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT',
      'DATE', 'DATETIME', 'TIME', 'TIMESTAMP', 'TIMESTAMPTZ', 'YEAR',
      'JSON', 'JSONB', 'BOOLEAN', 'BOOL',
      'BLOB', 'LONGBLOB', 'MEDIUMBLOB', 'TINYBLOB',
      'BYTEA', 'UUID', 'INTERVAL', 'INET', 'CIDR',
      'SERIAL', 'BIGSERIAL', 'SMALLSERIAL',
      // SQLite storage classes (INTEGER / REAL / NUMERIC / TEXT / BLOB)
      'INTEGER', 'REAL', 'NUMERIC', 'CLOB',
    ])
    if (noParamTypes.has(normType)) {
      result.field_length_disabled = true
      result.field_scale_disabled = true
    }
  }

  return result
}

/**
 * Converts a ParsedColumn into the project's Field object
 */
export function convertColumnToField(
  column: ParsedColumn,
  dialect: SqlDialect,
  unifiedTypes: UnifiedTypeDefinition[],
): Field {
  const typeInfo = mapSqlTypeToField(column, dialect, unifiedTypes)

  const field: Field = {
    field_name: column.name,
  }

  // Set type information
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

  // Constraints
  if (column.notNull || column.primaryKey || (dialect === 'postgresql' && ['SERIAL', 'BIGSERIAL'].includes(column.rawType.toUpperCase()))) {
    field.not_null = true
  }
  if (column.primaryKey) {
    field.primary_key = true
  }
  if (column.defaultValue !== undefined && column.defaultValue !== null) {
    field.default = column.defaultValue
  }
  if (column.onUpdateCurrentTimestamp) {
    field.on_update_current_timestamp = true
    if (typeof column.onUpdateCurrentTimestampPrecision === 'number') {
      field.on_update_current_timestamp_precision = column.onUpdateCurrentTimestampPrecision
    }
  }
  if (column.comment) {
    field.comment = column.comment
  }

  return field
}
