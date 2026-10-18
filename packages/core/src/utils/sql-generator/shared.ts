export type SqlDialect = 'mysql' | 'postgresql' | 'sqlite'

/** All supported dialects (this order drives SQL output and the UI dialect tab order) */
export const ALL_SQL_DIALECTS: SqlDialect[] = ['mysql', 'postgresql', 'sqlite']

// ===== Common field resolution =====

import type { CommonConfig, Field, Table, Schema, InitialData, InitialDataRow, JsonValue, JsonObject, TypeCaseMode, CommentOption, Index } from '../../types/schema'
import { resolveDialectOverride } from '../dialect-resolver'

export function resolveField(field: Field, commonConfig: CommonConfig | null): Field {
  if (field.use_common_used_fields && commonConfig) {
    return commonConfig.common_used_fields[field.field_name] || field
  }
  return field
}

// ===== Index name resolution =====

/** Whether the name consists only of {pre} / {post} placeholders (core name cleared) */
function isAffixOnly(name: string | undefined): boolean {
  return !!name && name.replace('{pre}', '').replace('{post}', '') === ''
}

/**
 * Resolve the {pre} / {post} placeholders in an index name and return the final name.
 * Prefix rules differ by dialect and index type (consistent with CREATE TABLE and index DDL in mysql.ts / postgresql.ts / sqlite.ts):
 * - mysql:      {pre} → uk_ / idx_
 * - sqlite:     {pre} → uk_ / idx_
 * - postgresql: {pre} → uk__<table>__ / idx__<table>__ (index names are database-wide unique, so the table name is included)
 *
 * {post} expands to an empty string for all three dialects. Missing index names (not filled in, or use_default_name checked) are handled per dialect:
 * - mysql:      return undefined and let the caller omit the name (MySQL names it after the first column)
 * - sqlite:     fall back to "prefix + joined column names" (CREATE INDEX requires a name)
 * - postgresql: fall back to "prefix + joined column names" (the prefix already contains the table name; CREATE INDEX / CONSTRAINT requires a name)
 *
 * @param index     index configuration
 * @param dialect   target dialect
 * @param tableName owning table name (only needed for the postgresql prefix)
 */
export function resolveIndexName(index: Index, dialect: SqlDialect, tableName: string): string | undefined {
  const indexType = resolveDialectOverride(index, dialect, 'type', index.type)
  // With "default" checked no index name is given: ignore name and the per-dialect name overrides
  const configuredName = index.use_default_name
    ? undefined
    : resolveDialectOverride(index, dialect, 'name', index.name)
  // A name left with only {pre}/{post} placeholders also counts as unspecified, otherwise it would expand to a bare prefix (e.g. uk_)
  const indexName = isAffixOnly(configuredName) ? undefined : configuredName

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

// ===== Unified type resolution =====

/**
 * Resolve the final type information of a field for the given database dialect
 * Priority (lowest to highest):
 *   1. unified_type mapping (looked up in CommonConfig.unified_types)
 *   2. field.field_type / field.field_length (field-level override, applies to every database)
 *   3. field[dialect].field_type / field[dialect].field_length (dialect override)
 *
 * When unified_type is empty, resolution starts at layer 2 (backwards compatible with old data)
 */
export function resolveFieldTypeForDialect(
  field: Field,
  dialect: SqlDialect,
  commonConfig: CommonConfig | null,
): { type: string; length: number | null; scale: number | null } {
  let type = ''
  let length: number | null = null
  let scale: number | null = null

  // Layer 1: unified_type mapping
  if (field.unified_type && commonConfig?.unified_types) {
    const def = commonConfig.unified_types.find(ut => ut.name === field.unified_type)
    // The dialect mapping may be missing (e.g. old common.json has no sqlite key); skip this layer then
    const mapping = def?.[dialect]
    if (mapping) {
      type = mapping.type
      length = mapping.length ?? null
      scale = mapping.scale ?? null
    }
  }

  // Layer 2: field-level bare properties (base when unified_type misses, override when it hits)
  // Note: null means the user cleared the input box, so it must not override the unified_type value
  if (!type && field.field_type) {
    type = field.field_type
    length = field.field_length ?? null
    scale = field.field_scale ?? null
  }
  // When unified_type already supplies a type, field.field_type can override it
  if (field.field_type !== undefined && field.field_type !== '') {
    type = field.field_type
  }
  if (field.field_length != null) {
    length = field.field_length
  }
  if (field.field_scale != null) {
    scale = field.field_scale
  }

  // Layer 3: database dialect override
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

  // User checked "not set": force-skip length/scale (final say)
  if (field.field_length_disabled) {
    length = null
  }
  if (field.field_scale_disabled) {
    scale = null
  }

  // Apply the global type case conversion
  type = applyTypeCase(type, commonConfig?.type_case)

  return { type: type || '', length, scale }
}

/** Convert the type name case according to the type_case setting */
export function applyTypeCase(type: string, mode: TypeCaseMode | undefined): string {
  if (!type || !mode || mode === 'keep') return type
  switch (mode) {
    case 'lowercase':
      return type.toLowerCase()
    case 'uppercase':
      return type.toUpperCase()
    case 'pascal':
      // PascalCase: uppercase the first letter, lowercase the rest
      return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()
    default:
      return type
  }
}

/**
 * Resolve whether a field's default value needs quoting
 * Priority: field.quote_default > unified_type.quote_default > false by default
 */
export function resolveQuoteDefault(
  field: Field,
  commonConfig: CommonConfig | null,
): boolean {
  // An explicit field-level setting wins
  if (field.quote_default !== undefined) return field.quote_default
  // Otherwise take it from the unified_type definition
  if (field.unified_type && commonConfig?.unified_types) {
    const def = commonConfig.unified_types.find(ut => ut.name === field.unified_type)
    if (def?.quote_default !== undefined) return def.quote_default
  }
  // No quotes by default (backwards compatible: defaults in old data already include quotes)
  return false
}

/**
 * Format an SQL DEFAULT value
 * - Special SQL expressions (e.g. CURRENT_TIMESTAMP) are emitted as-is
 * - quote=true wraps the value in single quotes and escapes it
 * - quote=false emits the value as-is (suitable for numbers, booleans, etc.)
 */
export function formatSqlDefault(value: JsonValue, quote: boolean): string {
  const str = String(value)
  // Special SQL expression: keep as-is
  if (typeof value === 'string' && (value === 'CURRENT_TIMESTAMP' || value.includes('CURRENT_TIMESTAMP'))) {
    return str
  }
  if (quote) {
    return `'${str.replace(/'/g, "''")}'`
  }
  return str
}

// ===== Field comments (with auto-appended option meanings) =====

/** Get an option's value for the given dialect (dialect override first, otherwise the generic value) */
function resolveOptionValue(opt: CommentOption, dialect: SqlDialect): string {
  if (dialect === 'mysql') return (opt.mysql ?? opt.value ?? '').trim()
  if (dialect === 'postgresql') return (opt.postgresql ?? opt.value ?? '').trim()
  if (dialect === 'sqlite') return (opt.sqlite ?? opt.value ?? '').trim()
  return ''
}

/** Render a field default value as display text for a dialect (boolean: mysql/sqlite→1/0, pg→TRUE/FALSE) */
function formatDefaultForCommentDialect(value: unknown, dialect: SqlDialect): string {
  if (typeof value === 'boolean') {
    switch (dialect) {
      case 'mysql':
      case 'sqlite':  // SQLite has no native boolean type; 1/0 is the convention
        return value ? '1' : '0'
      case 'postgresql':
        return value ? 'TRUE' : 'FALSE'
    }
  }
  return String(value)
}

/**
 * Build the final comment text of a field for the given dialect.
 * - Option meanings disabled or no options: return the raw comment.
 * - Enabled: `comment: value-meaning, value-meaning, defaultX` (full-width colon/comma).
 *   The default part reuses the field's existing default (dialect override first) and is omitted when empty.
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

  // Default value: reuse the field default (dialect override first), rendered per dialect
  const defaultValue = field[dialect]?.default ?? field.default
  if (defaultValue !== undefined && defaultValue !== '') {
    optionsText += `，默认${formatDefaultForCommentDialect(defaultValue, dialect)}`
  }

  return base ? `${base}：${optionsText}` : optionsText
}

// ===== comment_before_table output =====

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

// ===== comment_before_fields output =====

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

// ===== Initial data INSERT generation =====

/**
 * Whether a field is a "string-like" type: its value is normally stored as a string literal (quoted),
 * used for the visibility of the "expression" checkbox in initial-data expressions.
 *
 * Strategy (no longer relies on type-name keywords to avoid false positives):
 * - Common fields (use_common_used_fields): call resolveField first to get the configuration with the same name from
 *   common_used_fields, then decide reliably from its unified_type quote_default (whether values are stored as string literals).
 * - Custom types (no unified_type mapping, free-text type names): cannot be decided reliably,
 *   so the "expression" checkbox is always shown and left to the user.
 */
export function isStringTypeField(
  field: Field,
  commonConfig: CommonConfig | null,
): boolean {
  // Common field: take the same-named config from common_used_fields (placeholder fields in a table carry no type)
  const resolved = resolveField(field, commonConfig)

  // Custom type: no unified type mapping, so string-ness cannot be decided reliably; always show the checkbox
  if (!resolved.unified_type) {
    return true
  }

  // Common type: decide reliably from unified_type.quote_default (whether values are stored as string literals)
  const def = commonConfig?.unified_types?.find(ut => ut.name === resolved.unified_type)
  return def?.quote_default === true
}

/** Get the effective column names of a Table (excluding is_commented_out fields), resolving common fields */
export function getTableColumnNames(table: Table, commonConfig: CommonConfig | null): string[] {
  return table.fields
    .filter(f => !resolveField(f, commonConfig).is_commented_out)
    .map(f => resolveField(f, commonConfig).field_name)
}

/** Get the primary key column names of a Table (common fields resolved, commented-out fields excluded) */
export function getPrimaryKeyColumnNames(table: Table, commonConfig: CommonConfig | null): string[] {
  return table.fields
    .filter(field => {
      const resolved = resolveField(field, commonConfig)
      return resolved.primary_key === true && !resolved.is_commented_out
    })
    .map(field => field.field_name)
}

// ===== Pre/post SQL helpers =====

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
  // Make sure the SQL ends with a semicolon and append a newline
  let result = sql.trimEnd()
  if (result && !result.endsWith(';')) result += ';'
  return result + '\n'
}

// ===== Initial-data level pre/post SQL =====

export function getInitialDataPreSql(initialData: InitialData, dialect: SqlDialect): string {
  return initialData.pre_sql?.[dialect] || ''
}

export function getInitialDataPostSql(initialData: InitialData, dialect: SqlDialect): string {
  return initialData.post_sql?.[dialect] || ''
}

/**
 * Filter out initial data rows marked "do not generate" (is_skip === true)
 * Extracts the bare data of the remaining rows and their row comments (indices stay aligned) for the INSERT generation logic.
 * Note: only skip rows are removed; unfilled fields are left untouched (NULL semantics are preserved and handled by the generator).
 */
export function filterInitialDataRows(
  rows: InitialDataRow[] | undefined
): {
  rows: JsonObject[]
  rowComments: (string | null)[]
  exprFields: Record<string, boolean>[]
  hasRows: boolean
} {
  const srcRows = rows ?? []
  const result: JsonObject[] = []
  const resultComments: (string | null)[] = []
  const resultExprFields: Record<string, boolean>[] = []
  for (const row of srcRows) {
    if (row.is_skip === true) continue
    result.push(row.data ?? {})
    resultComments.push(row.row_comment ?? null)
    resultExprFields.push(row.expr_fields ?? {})
  }
  return {
    rows: result,
    rowComments: resultComments,
    exprFields: resultExprFields,
    hasRows: result.length > 0,
  }
}

// ===== Partitioned tables (PARTITION BY) =====

/**
 * Build the bare `PARTITION BY ...` clause (with **no** leading space / comma) from the table's dialect partition config.
 * Returns an empty string when unconfigured or invalid.
 *
 * Note: a partition is a table-level clause and must sit **alongside** the primary key / indexes (comma separated, same indentation);
 * the caller handles the comma and leading indentation (`  `), e.g. by emitting `,\n  PARTITION BY ...`.
 *
 * Two modes are supported:
 * - Structured: set `strategy` + `columns` → `PARTITION BY <strategy> (col1, col2)`
 * - Raw: set only `expression` → `PARTITION BY <expression>`
 *
 * Partition column names are quoted by each dialect's identifier rules (backticks for MySQL, double quotes for PostgreSQL / SQLite).
 *
 * Note: SQLite does not support `PARTITION BY`; its partition config is kept only as a structural placeholder and no clause is generated.
 */
export function getTablePartitionClause(
  table: Table,
  dialect: SqlDialect,
  commonConfig: CommonConfig | null,
): string {
  const cfg = table.partition?.[dialect]
  if (!cfg) return ''
  // SQLite has no partitioned table syntax
  if (dialect === 'sqlite') return ''

  const quote = (name: string): string => {
    if (dialect === 'mysql') return `\`${name}\``
    const shouldQuote = commonConfig?.default_config?.postgresql?.quote_identifiers ?? true
    return shouldQuote ? `"${name}"` : name
  }

  // Structured mode: strategy + columns
  if (cfg.strategy && cfg.columns && cfg.columns.length > 0) {
    const cols = cfg.columns.map(c => c.trim()).filter(Boolean).map(quote).join(', ')
    if (cols) return `PARTITION BY ${cfg.strategy} (${cols})`
  }

  // Raw expression fallback mode
  if (cfg.expression && cfg.expression.trim()) {
    return `PARTITION BY ${cfg.expression.trim()}`
  }

  return ''
}
