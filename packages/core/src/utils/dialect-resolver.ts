// Dialect resolution helper layer: centralizes property reads with dialect overrides and avoids scattered `obj.mysql?.attr ?? obj.attr ?? fallback` patterns.

import type { SqlDialect } from "./sql-generator/shared"

/** View of an entity's dialect sub-object; the caller guarantees the entity shape, values are read as unknown */
function dialectSubObject<T>(obj: T | null | undefined, dialect: SqlDialect): Record<string, unknown> | undefined {
  return (obj as Record<string, unknown> | null | undefined)?.[dialect] as Record<string, unknown> | undefined
}

/**
 * Read a property with dialect override: dialect value first, then the top-level property of the same name, then the fallback.
 * Equivalent to `obj[dialect]?.[key] ?? obj[key] ?? fallback`.
 *
 * @typeParam T - Entity type (e.g. Field / Index / IndexColumn)
 * @typeParam K - Top-level key of T; `key` is constrained to this for type hints
 * @param obj - Target entity object
 * @param dialect - Current dialect
 * @param key - Property key to read
 * @param fallback - Fallback value when not found
 * @returns The resolved property value
 */
export function resolveDialectOverride<T, K extends keyof T & string>(
  obj: T | null | undefined,
  dialect: SqlDialect,
  key: K,
  fallback?: T[K]
): T[K] {
  const dialectVal = dialectSubObject(obj, dialect)?.[key]
  if (dialectVal !== undefined) return dialectVal as T[K]
  const topVal = obj?.[key]
  if (topVal !== undefined) return topVal
  return fallback as T[K]
}

/**
 * Read only the override value on the dialect sub-object; falls back to `fallback` when missing (no fallback to the top-level property of the same name).
 * Equivalent to `obj[dialect]?.[key] ?? fallback`.
 *
 * @typeParam T - Entity type
 * @typeParam K - Top-level key of T; `key` is constrained to this for type hints
 * @param obj - Target entity object
 * @param dialect - Current dialect
 * @param key - Property key to read
 * @param fallback - Fallback value when not found
 * @returns The value on the dialect sub-object, or the fallback
 */
export function getDialectOverrideValue<T, K extends keyof T & string>(
  obj: T | null | undefined,
  dialect: SqlDialect,
  key: K,
  fallback?: T[K]
): T[K] {
  const dialectVal = dialectSubObject(obj, dialect)?.[key]
  return dialectVal !== undefined ? (dialectVal as T[K]) : (fallback as T[K])
}

/**
 * Read a config item that exists only on the dialect sub-object (e.g. `table.mysql.mysql_engine`); falls back to `fallback` when absent.
 * Unlike `getDialectOverrideValue`, such properties have no top-level key of the same name, so there is no top-level fallback.
 *
 * @typeParam O - Dialect sub-object type (e.g. TableMysqlConfig / FieldOverride)
 * @typeParam K - Key of O; `key` is constrained to this for type hints
 * @param subConfig - Dialect sub-object
 * @param key - Property key to read
 * @param fallback - Fallback value when not found
 * @returns The value on the dialect sub-object, or the fallback
 */
export function getDialectSubConfig<O, K extends keyof O & string>(
  subConfig: O | null | undefined,
  key: K,
  fallback?: O[K]
): O[K] {
  const val = subConfig?.[key]
  return val !== undefined ? val : (fallback as O[K])
}
