// Logical delete resolution layer: turns "project-level config + index-level override" into concrete parameters usable by each dialect.
//
// Background: a unique index only sees physical rows and ignores the business notion of "deleted", so re-inserting
// the same business key after a soft delete hits Duplicate entry. This module centralizes the decision of how to work
// around that, avoiding repeated configuration for every table and index.

import type { CommonConfig, Index, LogicalDeleteConfig, LogicalDeleteMysqlStrategy, Table } from '../types/schema'
import { resolveDialectOverride } from './dialect-resolver'
import { getTableColumnNames } from './sql-generator/shared'
import type { SqlDialect } from './sql-generator/shared'

/** Resolved logical delete parameters ready for SQL generation */
export interface ResolvedLogicalDelete {
  /** Logical delete field name (already verified to exist in the table) */
  field: string
  /** "Not deleted" predicate (without the WHERE keyword), used for PostgreSQL / SQLite partial indexes */
  predicate: string
  /** MySQL implementation strategy */
  mysqlStrategy: LogicalDeleteMysqlStrategy
}

/**
 * Merges project-level and index-level config: index-level keys override one by one, unset keys fall back to project level.
 * Returns an empty object when neither side is configured.
 */
export function mergeLogicalDelete(
  index: Index,
  commonConfig: CommonConfig | null,
): LogicalDeleteConfig {
  const project = commonConfig?.logical_delete ?? {}
  const own = index.logical_delete ?? {}
  return { ...project, ...own }
}

/** Derives the "not deleted" predicate from the field name: fields containing delete / del → IS NULL, otherwise → = 0 */
export function deriveDeletePredicate(field: string): string {
  if (!field) return ''
  return /delet|del_|_del/i.test(field) ? `${field} IS NULL` : `${field} = 0`
}

/**
 * Determines whether an index on the given table needs logical delete handling.
 *
 * Conditions for taking effect (missing any one falls back to a plain unique index):
 * 1. The index type resolved for this dialect is unique (plain indexes have no uniqueness conflicts)
 * 2. The index has active_only checked
 * 3. The merged config has enabled === true and a non-empty field name
 * 4. The field actually exists in the table (fields with is_commented_out are excluded)
 */
export function resolveIndexLogicalDelete(
  index: Index,
  table: Table,
  dialect: SqlDialect,
  commonConfig: CommonConfig | null,
): ResolvedLogicalDelete | null {
  const indexType = resolveDialectOverride(index, dialect, 'type', index.type)
  if (indexType !== 'unique') return null
  if (index.active_only !== true) return null

  const cfg = mergeLogicalDelete(index, commonConfig)
  if (cfg.enabled !== true) return null

  const field = (cfg.field ?? '').trim()
  if (!field) return null
  if (!getTableColumnNames(table, commonConfig).includes(field)) return null

  const predicate = (cfg.predicate ?? '').trim() || deriveDeletePredicate(field)
  return {
    field,
    predicate,
    mysqlStrategy: cfg.mysql_strategy === 'timestamp_union' ? 'timestamp_union' : 'functional',
  }
}

/**
 * Builds the expression for a single index column in a MySQL functional index: `IF(<field> IS NULL, <col>, NULL)`.
 * Deleted rows map to NULL, and multiple NULLs do not conflict in a unique index, which frees up uniqueness.
 */
export function buildMysqlActiveExpression(columnName: string, deleteField: string): string {
  return `IF(\`${deleteField}\` IS NULL, \`${columnName}\`, NULL)`
}
