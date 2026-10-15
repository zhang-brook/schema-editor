import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CommandManager,
  affectedCommon,
  affectedDatabase,
  affectedInitialData,
  affectedSchema,
  affectedSql,
  affectedTable,
  mergeAffectedFiles,
  type AffectedFile,
} from './command'

function edit(
  state: { value: string },
  value: string,
  coalesceKey?: string,
  files: AffectedFile[] = [affectedTable('public', 'users')],
) {
  const before = state.value
  return {
    label: `输入 ${value}`,
    coalesceKey,
    apply: vi.fn(() => { state.value = value }),
    revert: vi.fn(() => { state.value = before }),
    affectedFiles: vi.fn(() => files),
  }
}

describe('CommandManager', () => {
  let manager: CommandManager
  let state: { value: string }
  let persist: ReturnType<typeof vi.fn<(files: AffectedFile[]) => void>>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    manager = new CommandManager()
    state = { value: '' }
    persist = vi.fn<(files: AffectedFile[]) => void>()
    manager.setPersistHook(persist)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('空历史的 undo/redo/clear/断合并均无副作用', () => {
    manager.undo()
    manager.redo()
    manager.clear()
    manager.breakCoalescing()
    expect(manager.canUndo).toBe(false)
    expect(manager.canRedo).toBe(false)
    expect(manager.undoLabel).toBeNull()
    expect(manager.redoLabel).toBeNull()
    expect(state.value).toBe('')
    expect(persist).not.toHaveBeenCalled()
  })

  it('未设置合并键的命令按顺序 execute、undo、redo，并更新标签', () => {
    const first = edit(state, 'a')
    manager.execute(first)
    const second = edit(state, 'ab')
    manager.execute(second)
    expect(state.value).toBe('ab')
    expect(manager.undoLabel).toBe(second.label)
    expect(manager.canRedo).toBe(false)

    manager.undo()
    expect(state.value).toBe('a')
    expect(manager.undoLabel).toBe(first.label)
    expect(manager.redoLabel).toBe(second.label)
    manager.undo()
    expect(state.value).toBe('')
    expect(manager.canUndo).toBe(false)
    expect(manager.undoLabel).toBeNull()
    expect(manager.redoLabel).toBe(first.label)

    manager.redo()
    expect(state.value).toBe('a')
    expect(manager.undoLabel).toBe(first.label)
    expect(manager.redoLabel).toBe(second.label)
    manager.redo()
    expect(state.value).toBe('ab')
    expect(manager.undoLabel).toBe(second.label)
    expect(manager.redoLabel).toBeNull()
    expect(manager.canRedo).toBe(false)
    expect(first.apply).toHaveBeenCalledTimes(2)
    expect(second.apply).toHaveBeenCalledTimes(2)
    expect(first.revert).toHaveBeenCalledTimes(1)
    expect(second.revert).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledTimes(6)
  })

  it('abc 合并保留首个 revert、最终 apply/label，重复 undo/redo 不丢字', () => {
    const first = edit(state, 'a', 'typing')
    manager.execute(first)
    vi.advanceTimersByTime(100)
    const middle = edit(state, 'ab', 'typing')
    manager.execute(middle)
    vi.advanceTimersByTime(100)
    const last = edit(state, 'abc', 'typing')
    manager.execute(last)
    expect(state.value).toBe('abc')
    expect(manager.undoLabel).toBe(last.label)
    expect(first.label).toBe('输入 a')

    for (let i = 0; i < 2; i++) {
      manager.undo()
      expect(state.value).toBe('')
      expect(manager.canUndo).toBe(false)
      expect(manager.redoLabel).toBe(last.label)
      manager.redo()
      expect(state.value).toBe('abc')
      expect(manager.canRedo).toBe(false)
    }
    expect(first.revert).toHaveBeenCalledTimes(2)
    expect(middle.revert).not.toHaveBeenCalled()
    expect(last.revert).not.toHaveBeenCalled()
    expect(first.apply).toHaveBeenCalledTimes(1)
    expect(middle.apply).toHaveBeenCalledTimes(1)
    expect(last.apply).toHaveBeenCalledTimes(3)
  })

  it.each([799, 800, 801])('合并窗口边界：间隔 %i ms', delay => {
    manager.execute(edit(state, 'a', 'typing'))
    vi.advanceTimersByTime(delay)
    manager.execute(edit(state, 'ab', 'typing'))
    manager.undo()
    expect(state.value).toBe(delay <= 800 ? '' : 'a')
    expect(manager.canUndo).toBe(delay > 800)
    manager.redo()
    expect(state.value).toBe('ab')
  })

  it('窗口从最近一次输入计时，而非从首个命令计时', () => {
    manager.execute(edit(state, 'a', 'typing'))
    vi.advanceTimersByTime(600)
    manager.execute(edit(state, 'ab', 'typing'))
    vi.advanceTimersByTime(600)
    manager.execute(edit(state, 'abc', 'typing'))
    manager.undo()
    expect(state.value).toBe('')
    expect(manager.canUndo).toBe(false)
    manager.redo()
    expect(state.value).toBe('abc')
  })

  it('时钟回退不会将命令误判为窗口内输入', () => {
    vi.setSystemTime(1000)
    manager.execute(edit(state, 'a', 'typing'))
    vi.setSystemTime(900)
    manager.execute(edit(state, 'ab', 'typing'))
    manager.undo()
    expect(state.value).toBe('a')
  })

  it.each([
    ['name', 'comment'],
    [undefined, undefined],
    ['typing', undefined],
    [undefined, 'typing'],
  ])('不同或缺失 key 不合并：%s / %s', (firstKey, secondKey) => {
    manager.execute(edit(state, 'a', firstKey))
    manager.execute(edit(state, 'ab', secondKey))
    manager.undo()
    expect(state.value).toBe('a')
    manager.undo()
    expect(state.value).toBe('')
  })

  it('空字符串仍是有效的显式合并键', () => {
    manager.execute(edit(state, 'a', ''))
    manager.execute(edit(state, 'ab', ''))
    manager.undo()
    expect(state.value).toBe('')
    expect(manager.canUndo).toBe(false)
  })

  it.each([
    ['不同 schema', affectedTable('first', 'users'), affectedTable('second', 'users')],
    ['不同 table', affectedTable('public', 'users'), affectedTable('public', 'orders')],
    ['冒号名称', affectedTable('a:b', 'c'), affectedTable('a', 'b:c')],
    ['不同种类', affectedTable('public', 'users'), affectedInitialData('public', 'users')],
    ['不同全局文件', affectedCommon(), affectedDatabase()],
  ])('同 key 但%s不合并，即使共享 SQL 文件', (_label, firstFile, secondFile) => {
    manager.execute(edit(state, 'a', 'typing', [firstFile, affectedSql()]))
    manager.execute(edit(state, 'ab', 'typing', [secondFile, affectedSql()]))
    manager.undo()
    expect(state.value).toBe('a')
    expect(persist).toHaveBeenLastCalledWith([secondFile, affectedSql()])
    manager.undo()
    expect(state.value).toBe('')
    expect(persist).toHaveBeenLastCalledWith([firstFile, affectedSql()])
  })

  it('目标文件集合必须相同，不能仅有部分重合', () => {
    const table = affectedTable('public', 'users')
    manager.execute(edit(state, 'a', 'typing', [table]))
    manager.execute(edit(state, 'ab', 'typing', [table, affectedSql()]))
    manager.undo()
    expect(state.value).toBe('a')
  })

  it('文件顺序及重复项不影响身份比较', () => {
    const table = affectedTable('public', 'users')
    const sql = affectedSql()
    manager.execute(edit(state, 'a', 'typing', [table, sql, { ...table }]))
    manager.execute(edit(state, 'ab', 'typing', [sql, { ...table }]))
    manager.undo()
    expect(state.value).toBe('')
    expect(manager.canUndo).toBe(false)
    expect(persist).toHaveBeenLastCalledWith([table, sql])
  })

  it('身份比较使用执行时快照，不受复用文件描述对象的修改影响', () => {
    const file = affectedTable('public', 'users')
    manager.execute(edit(state, 'a', 'typing', [file]))
    file.table = 'orders'
    manager.execute(edit(state, 'ab', 'typing', [file]))
    manager.undo()
    expect(state.value).toBe('a')
    expect(manager.canUndo).toBe(true)
  })

  it('撤销后新编辑丢弃 redo 分支，且不与剩余栈顶合并', () => {
    manager.execute(edit(state, 'a', 'typing'))
    const discarded = edit(state, 'ab', 'other')
    manager.execute(discarded)
    manager.undo()
    expect(state.value).toBe('a')
    expect(manager.canRedo).toBe(true)

    manager.execute(edit(state, 'ac', 'typing'))
    expect(manager.canRedo).toBe(false)
    expect(manager.redoLabel).toBeNull()
    manager.redo()
    expect(state.value).toBe('ac')
    expect(discarded.apply).toHaveBeenCalledTimes(1)
    manager.undo()
    expect(state.value).toBe('a')
    manager.undo()
    expect(state.value).toBe('')
    manager.redo()
    manager.redo()
    expect(state.value).toBe('ac')
  })

  it('撤销整个合并记录后新输入同样丢弃旧分支', () => {
    manager.execute(edit(state, 'a', 'typing'))
    manager.execute(edit(state, 'ab', 'typing'))
    manager.undo()
    manager.execute(edit(state, 'x', 'typing'))
    expect(manager.canRedo).toBe(false)
    manager.undo()
    expect(state.value).toBe('')
    manager.redo()
    expect(state.value).toBe('x')
  })

  it('redo 打断后续同键输入合并', () => {
    manager.execute(edit(state, 'a', 'typing'))
    manager.undo()
    manager.redo()
    manager.execute(edit(state, 'ab', 'typing'))
    manager.undo()
    expect(state.value).toBe('a')
    manager.undo()
    expect(state.value).toBe('')
  })

  it('无可重做记录时调用 redo 也会打断合并', () => {
    manager.execute(edit(state, 'a', 'typing'))
    manager.redo()
    expect(persist).toHaveBeenCalledTimes(1)
    manager.execute(edit(state, 'ab', 'typing'))
    manager.undo()
    expect(state.value).toBe('a')
  })

  it('显式 breakCoalescing 保留历史及 hook，边界后的输入可重新合并', () => {
    manager.execute(edit(state, 'a', 'typing'))
    manager.breakCoalescing()
    manager.breakCoalescing()
    expect(manager.undoLabel).toBe('输入 a')
    expect(manager.canUndo).toBe(true)
    expect(persist).toHaveBeenCalledTimes(1)
    manager.execute(edit(state, 'ab', 'typing'))
    manager.execute(edit(state, 'abc', 'typing'))
    manager.undo()
    expect(state.value).toBe('a')
    expect(manager.undoLabel).toBe('输入 a')
    expect(manager.redoLabel).toBe('输入 abc')
    manager.breakCoalescing()
    expect(manager.canRedo).toBe(true)
    manager.redo()
    expect(state.value).toBe('abc')
  })

  it('clear 同时清空两栈且不回滚/写盘；之后从新快照开始合并', () => {
    manager.execute(edit(state, 'a', 'typing'))
    manager.execute(edit(state, 'ab', 'other'))
    manager.undo()
    expect(manager.canUndo).toBe(true)
    expect(manager.canRedo).toBe(true)
    persist.mockClear()
    manager.clear()
    expect(state.value).toBe('a')
    expect(manager.canUndo).toBe(false)
    expect(manager.canRedo).toBe(false)
    expect(manager.undoLabel).toBeNull()
    expect(manager.redoLabel).toBeNull()
    manager.undo()
    manager.redo()
    expect(persist).not.toHaveBeenCalled()
    manager.execute(edit(state, 'ax', 'typing'))
    manager.execute(edit(state, 'axy', 'typing'))
    manager.undo()
    expect(state.value).toBe('a')
    expect(manager.canUndo).toBe(false)
    manager.redo()
    expect(state.value).toBe('axy')
    expect(persist).toHaveBeenCalledTimes(4)
  })

  it('execute hook 仅含本次文件，合并 undo/redo hook 含全部旧路径且在内存更新后触发', () => {
    manager.execute(edit(state, 'baseline', undefined, [affectedCommon()]))
    const snapshots: string[] = []
    persist = vi.fn<(files: AffectedFile[]) => void>(() => { snapshots.push(state.value) })
    manager.setPersistHook(persist)
    const target = affectedTable('public', 'users')
    const firstFile = { ...target, oldSchema: 'old:a', oldTable: 'first' }
    const lastFile = { ...target, oldSchema: 'old:b', oldTable: 'last' }
    const sql = affectedSql()
    manager.execute(edit(state, 'a', 'typing', [firstFile, sql, { ...firstFile }]))
    manager.execute(edit(state, 'ab', 'typing', [lastFile, sql]))
    manager.execute(edit(state, 'abc', 'typing', [lastFile, sql]))
    manager.undo()
    manager.redo()
    expect(snapshots).toEqual(['a', 'ab', 'abc', 'baseline', 'abc'])
    expect(persist.mock.calls.map(([files]) => files)).toEqual([
      [firstFile, sql],
      [lastFile, sql],
      [lastFile, sql],
      [firstFile, sql, lastFile],
      [firstFile, sql, lastFile],
    ])
  })

  it('未合并命令仍在 undo/redo 后动态计算 affectedFiles，保留方法 this 绑定', () => {
    const command = {
      label: '重命名',
      before: 'old',
      after: 'new',
      schema: 'public',
      apply() { state.value = this.after },
      revert() { state.value = this.before },
      affectedFiles() { return [affectedTable(this.schema, state.value)] },
    }
    manager.execute(command)
    manager.undo()
    manager.redo()
    expect(persist.mock.calls.map(([files]) => files)).toEqual([
      [affectedTable('public', 'new')],
      [affectedTable('public', 'old')],
      [affectedTable('public', 'new')],
    ])
  })

  it('未注册 persist hook 时也支持执行和历史操作', () => {
    const withoutHook = new CommandManager()
    withoutHook.execute(edit(state, 'a', 'typing'))
    withoutHook.execute(edit(state, 'ab', 'typing'))
    withoutHook.undo()
    expect(state.value).toBe('')
    withoutHook.redo()
    expect(state.value).toBe('ab')
    expect(persist).not.toHaveBeenCalled()
  })

  it('大量连续输入只调用首/末闭包，不递归重放中间命令', () => {
    const withoutHook = new CommandManager()
    let applies = 0
    let reverts = 0
    for (let i = 1; i <= 20000; i++) {
      const before = state.value
      const value = String(i)
      withoutHook.execute({
        label: value,
        coalesceKey: 'typing',
        apply() { applies++; state.value = value },
        revert() { reverts++; state.value = before },
        affectedFiles() { return [affectedTable('public', 'users')] },
      })
    }
    expect(withoutHook.undoLabel).toBe('20000')
    withoutHook.undo()
    expect(state.value).toBe('')
    expect(withoutHook.canUndo).toBe(false)
    withoutHook.redo()
    expect(state.value).toBe('20000')
    expect(applies).toBe(20001)
    expect(reverts).toBe(1)
  })
})

describe('mergeAffectedFiles', () => {
  it('空集合返回空数组', () => {
    expect(mergeAffectedFiles([])).toEqual([])
  })

  it('所有文件种类均去重，保持首项引用和顺序且不修改输入', () => {
    const files = [
      affectedTable('public', 'users'),
      affectedInitialData('public', 'users'),
      affectedSchema('public'),
      affectedDatabase(),
      affectedCommon(),
      affectedSql(),
    ]
    const input = [...files, ...files.map(file => ({ ...file }))]
    const result = mergeAffectedFiles(input)
    expect(result).toEqual(files)
    expect(input).toHaveLength(12)
    files.forEach((file, index) => { expect(result[index]).toBe(file) })
  })

  it('tuple 身份区分冒号、引号、反斜线、换行、空字符串与缺省值', () => {
    const files: AffectedFile[] = [
      affectedTable('a:b', 'c'),
      affectedTable('a', 'b:c'),
      affectedInitialData('a:b', 'c'),
      affectedInitialData('a', 'b:c'),
      affectedSchema('a:b'),
      { kind: 'schema', schema: 'a', table: 'b:' },
      affectedTable('a,"b', 'c'),
      affectedTable('a', 'b,"c'),
      affectedTable('路径\\a', '表\n名'),
      affectedTable('路径', '\\a:表\n名'),
      { kind: 'table' },
      { kind: 'table', schema: '' },
      { kind: 'table', schema: 'undefined' },
      { kind: 'table', schema: 'null' },
      { kind: 'table', table: '' },
      { kind: 'table', schema: '', table: '' },
    ]
    expect(mergeAffectedFiles([...files, ...files.map(file => ({ ...file }))])).toEqual(files)
  })

  it.each(['table', 'initial-data', 'schema'] as const)('%s 保留不同 oldSchema/oldTable，只去重完整身份', kind => {
    const target: AffectedFile = { kind, schema: 'current', table: 'users' }
    const files: AffectedFile[] = [
      target,
      { ...target, oldSchema: 'old' },
      { ...target, oldSchema: 'another' },
      { ...target, oldTable: 'old' },
      { ...target, oldTable: 'another' },
      { ...target, oldSchema: 'a:b', oldTable: 'c' },
      { ...target, oldSchema: 'a', oldTable: 'b:c' },
      { ...target, oldSchema: '' },
      { ...target, oldTable: '' },
    ]
    expect(mergeAffectedFiles([...files, ...files.map(file => ({ ...file }))])).toEqual(files)
    expect(mergeAffectedFiles([target, { ...target, oldSchema: undefined, oldTable: undefined }]))
      .toEqual([target])
  })
})
