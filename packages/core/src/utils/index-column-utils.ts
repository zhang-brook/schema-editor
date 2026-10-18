import type { Index, IndexColumn } from '../types/schema'
import { resolveDialectOverride } from './dialect-resolver'
import type { SqlDialect } from './sql-generator/shared'

/**
 * Parses the legacy plain-string column format → new IndexColumn
 * "create_time DESC" → { name: "create_time", sort_order: "DESC" }
 * "biz_type" → { name: "biz_type" }
 */
export function parseLegacyColumn(raw: string): IndexColumn {
  const trimmed = raw.trim()
  if (!trimmed) return { name: '' }
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return { name: parts[0]! }
  const last = parts[parts.length - 1]!.toUpperCase()
  if (last === 'ASC' || last === 'DESC') {
    return { name: parts.slice(0, -1).join(' '), sort_order: last }
  }
  return { name: trimmed }
}

/**
 * Batch-upgrades legacy columns (string[] | IndexColumn[]) → IndexColumn[]
 */
export function upgradeIndexColumns(columns: string[]): IndexColumn[] {
  return columns.map(c => {
    if (typeof c === 'string') {
      return parseLegacyColumn(c)
    }
    return c
  })
}

/**
 * Formats an IndexColumn into a display string
 * { name: "create_time", sort_order: "DESC" } → "create_time DESC"
 */
export function formatIndexColumn(col: IndexColumn): string {
  if (!col.name.trim()) return ''
  if (col.sort_order) return `${col.name.trim()} ${col.sort_order}`
  return col.name.trim()
}

/**
 * For the SQL generator: separates the column name and the sort part
 * @returns { name: "create_time", sortPart: " DESC" } (sortPart carries a leading space)
 */
export function splitColumnForSql(col: IndexColumn, db?: SqlDialect): { name: string; sortPart: string } {
  const sort = db === undefined
    ? col.sort_order
    : resolveDialectOverride(col, db, 'sort_order', col.sort_order)
  return { name: col.name, sortPart: sort ? ` ${sort}` : '' }
}

/** Action that cleans up index references when a field is deleted (used by command-mode apply/revert) */
export interface IndexFieldRemoval {
  /** Performs the cleanup; safe to call repeatedly, rolls back the previous result first */
  apply(): void
  /** Reverts: restores the removed columns and any indexes removed entirely (including their original positions) */
  restore(): void
}

/**
 * Cleans up references to a field in indexes when the field is deleted:
 * - index contains that column → remove the column;
 * - index has no columns left after removal → remove the whole index.
 *
 * Purely functional (only mutates the passed-in indexes array); returns apply/restore actions
 * for command mode to call as a pair in apply/revert so undo/redo works fully.
 */
export function createIndexFieldRemoval(indexes: Index[], fieldName: string): IndexFieldRemoval {
  /** Column snapshots of the modified indexes (recorded in descending index order) */
  const snapshots: { index: Index; indexIdx: number; columns: IndexColumn[] }[] = []
  /** Indexes removed entirely because they were emptied */
  const removedIndexes: { index: Index; indexIdx: number }[] = []

  function restore() {
    // Reverse iteration reinserts in ascending index order, keeping positions correct when several indexes are removed at once
    for (let i = removedIndexes.length - 1; i >= 0; i--) {
      const item = removedIndexes[i]!
      if (!indexes.includes(item.index)) indexes.splice(item.indexIdx, 0, item.index)
    }
    removedIndexes.length = 0
    for (const s of snapshots) {
      s.index.columns = s.columns
    }
    snapshots.length = 0
  }

  function apply() {
    restore()
    if (!fieldName) return
    // Iterate backwards so splice does not affect indexes not yet processed
    for (let i = indexes.length - 1; i >= 0; i--) {
      const index = indexes[i]
      if (!index?.columns) continue
      if (!index.columns.some(c => c.name === fieldName)) continue
      snapshots.push({ index, indexIdx: i, columns: index.columns.map(c => ({ ...c })) })
      index.columns = index.columns.filter(c => c.name !== fieldName)
      if (index.columns.length === 0) {
        indexes.splice(i, 1)
        removedIndexes.push({ index, indexIdx: i })
      }
    }
  }

  return { apply, restore }
}
