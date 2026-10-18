import { describe, it, expect } from 'vitest'
import type { Table } from '../types/schema'
import { moveFieldCommentBefore, removeFieldCommentBefore } from './table-comment-utils'

function makeTable(comments?: Record<string, string>): Table {
  return {
    name: 'users',
    comment: '',
    comment_before_fields: comments,
    fields: [{ field_name: 'age' }],
    indexes: [],
  } as Table
}

describe('moveFieldCommentBefore', () => {
  it('comment before the field follows the new field name after renaming', () => {
    const table = makeTable({ age: '-- 年龄' })
    moveFieldCommentBefore(table, 'age', 'user_age')
    expect(table.comment_before_fields).toEqual({ user_age: '-- 年龄' })
  })

  it('undo restores the original key', () => {
    const table = makeTable({ age: '-- 年龄' })
    const undo = moveFieldCommentBefore(table, 'age', 'user_age')!
    undo()
    expect(table.comment_before_fields).toEqual({ age: '-- 年龄' })
  })

  it('keeps the original value after undo when the target name already has a comment', () => {
    const table = makeTable({ age: '-- 年龄', user_age: '-- 用户年龄' })
    const undo = moveFieldCommentBefore(table, 'age', 'user_age')!
    expect(table.comment_before_fields).toEqual({ user_age: '-- 年龄' })
    undo()
    expect(table.comment_before_fields).toEqual({ age: '-- 年龄', user_age: '-- 用户年龄' })
  })

  it('returns null when there is no matching comment or the names are the same', () => {
    expect(moveFieldCommentBefore(makeTable(), 'age', 'user_age')).toBeNull()
    expect(moveFieldCommentBefore(makeTable({ age: '-- 年龄' }), 'age', 'age')).toBeNull()
  })
})

describe('removeFieldCommentBefore', () => {
  it('clears the field\'s old key when the field is deleted', () => {
    const table = makeTable({ age: '-- 年龄', name: '-- 姓名' })
    removeFieldCommentBefore(table, 'age')
    expect(table.comment_before_fields).toEqual({ name: '-- 姓名' })
  })

  it('removes the entire map when the last comment is deleted, and undo rebuilds it', () => {
    const table = makeTable({ age: '-- 年龄' })
    const undo = removeFieldCommentBefore(table, 'age')!
    expect(table.comment_before_fields).toBeUndefined()
    undo()
    expect(table.comment_before_fields).toEqual({ age: '-- 年龄' })
  })

  it('undo restores the old key-value', () => {
    const table = makeTable({ age: '-- 年龄', name: '-- 姓名' })
    const undo = removeFieldCommentBefore(table, 'age')!
    undo()
    expect(table.comment_before_fields).toEqual({ age: '-- 年龄', name: '-- 姓名' })
  })

  it('returns null when there is no matching comment or the field name is empty', () => {
    expect(removeFieldCommentBefore(makeTable(), 'age')).toBeNull()
    expect(removeFieldCommentBefore(makeTable({ age: '-- 年龄' }), '')).toBeNull()
    expect(removeFieldCommentBefore(makeTable({ age: '-- 年龄' }), 'name')).toBeNull()
  })
})
