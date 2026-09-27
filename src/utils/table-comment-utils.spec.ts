import { describe, it, expect } from 'vitest'
import type { Table } from '@/types/schema'
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
  it('改名后字段前注释跟随新字段名', () => {
    const table = makeTable({ age: '-- 年龄' })
    moveFieldCommentBefore(table, 'age', 'user_age')
    expect(table.comment_before_fields).toEqual({ user_age: '-- 年龄' })
  })

  it('撤销后恢复原键', () => {
    const table = makeTable({ age: '-- 年龄' })
    const undo = moveFieldCommentBefore(table, 'age', 'user_age')!
    undo()
    expect(table.comment_before_fields).toEqual({ age: '-- 年龄' })
  })

  it('目标名已存在注释时撤销后仍保留原值', () => {
    const table = makeTable({ age: '-- 年龄', user_age: '-- 用户年龄' })
    const undo = moveFieldCommentBefore(table, 'age', 'user_age')!
    expect(table.comment_before_fields).toEqual({ user_age: '-- 年龄' })
    undo()
    expect(table.comment_before_fields).toEqual({ age: '-- 年龄', user_age: '-- 用户年龄' })
  })

  it('无对应注释或同名时返回 null', () => {
    expect(moveFieldCommentBefore(makeTable(), 'age', 'user_age')).toBeNull()
    expect(moveFieldCommentBefore(makeTable({ age: '-- 年龄' }), 'age', 'age')).toBeNull()
  })
})

describe('removeFieldCommentBefore', () => {
  it('删除字段时清掉该字段的旧键', () => {
    const table = makeTable({ age: '-- 年龄', name: '-- 姓名' })
    removeFieldCommentBefore(table, 'age')
    expect(table.comment_before_fields).toEqual({ name: '-- 姓名' })
  })

  it('最后一个注释被删时移除整个 map，撤销后重建', () => {
    const table = makeTable({ age: '-- 年龄' })
    const undo = removeFieldCommentBefore(table, 'age')!
    expect(table.comment_before_fields).toBeUndefined()
    undo()
    expect(table.comment_before_fields).toEqual({ age: '-- 年龄' })
  })

  it('撤销后恢复旧键值', () => {
    const table = makeTable({ age: '-- 年龄', name: '-- 姓名' })
    const undo = removeFieldCommentBefore(table, 'age')!
    undo()
    expect(table.comment_before_fields).toEqual({ age: '-- 年龄', name: '-- 姓名' })
  })

  it('无对应注释或空字段名时返回 null', () => {
    expect(removeFieldCommentBefore(makeTable(), 'age')).toBeNull()
    expect(removeFieldCommentBefore(makeTable({ age: '-- 年龄' }), '')).toBeNull()
    expect(removeFieldCommentBefore(makeTable({ age: '-- 年龄' }), 'name')).toBeNull()
  })
})
