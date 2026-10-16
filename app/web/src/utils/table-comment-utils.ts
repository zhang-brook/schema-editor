import type { Table } from '@/types/schema'

type FieldComment = string | (string | null)[]

/**
 * 删除字段时清理 table.comment_before_fields 中对应的键（该 map 以字段名为键）。
 * 返回撤销函数；无对应注释时返回 null。
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
 * 字段名改名时迁移 table.comment_before_fields 的键（该 map 以字段名为键）。
 * 返回撤销函数；表未配置该字段的前注释、或新旧名相同时返回 null。
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
