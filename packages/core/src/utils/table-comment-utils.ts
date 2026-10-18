import type { Table } from '../types/schema'

type FieldComment = string | (string | null)[]

/**
 * Removes the entry for a field from table.comment_before_fields when the field is deleted (that map is keyed by field name).
 * Returns an undo function; returns null when there is no matching comment.
 */
export function removeFieldCommentBefore(table: Table, fieldName: string): (() => void) | null {
  const record = table.comment_before_fields
  if (!record || !fieldName || record[fieldName] === undefined) return null

  const value = record[fieldName]!
  delete record[fieldName]
  if (Object.keys(record).length === 0) delete table.comment_before_fields

  return () => {
    if (!table.comment_before_fields) table.comment_before_fields = {}
    table.comment_before_fields[fieldName] = value
  }
}

/**
 * Migrates the key in table.comment_before_fields when a field is renamed (that map is keyed by field name).
 * Returns an undo function; returns null when the table has no comment for that field or the names are the same.
 */
export function moveFieldCommentBefore(table: Table, oldName: string, newName: string): (() => void) | null {
  const record = table.comment_before_fields
  if (!record || oldName === newName) return null

  const oldValue = record[oldName] as FieldComment | undefined
  if (oldValue === undefined) return null

  const hadTarget = newName in record
  const targetValue = record[newName]

  delete record[oldName]
  record[newName] = oldValue

  return () => {
    const rec = table.comment_before_fields
    if (!rec) return
    if (hadTarget && targetValue !== undefined) rec[newName] = targetValue
    else delete rec[newName]
    rec[oldName] = oldValue
  }
}
