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

  it('undo/redo/clear/breakCoalescing on an empty history have no side effects', () => {
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

  it('executes, undoes, and redoes commands without a coalesce key in order, updating labels', () => {
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

  it('abc coalescing keeps the first revert and the final apply/label, and repeated undo/redo loses no characters', () => {
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

  it.each([799, 800, 801])('coalescing window boundary: gap of %i ms', delay => {
    manager.execute(edit(state, 'a', 'typing'))
    vi.advanceTimersByTime(delay)
    manager.execute(edit(state, 'ab', 'typing'))
    manager.undo()
    expect(state.value).toBe(delay <= 800 ? '' : 'a')
    expect(manager.canUndo).toBe(delay > 800)
    manager.redo()
    expect(state.value).toBe('ab')
  })

  it('times the window from the latest input, not from the first command', () => {
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

  it('does not misclassify a command as within the window when the clock rolls back', () => {
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
  ])('different or missing keys do not coalesce: %s / %s', (firstKey, secondKey) => {
    manager.execute(edit(state, 'a', firstKey))
    manager.execute(edit(state, 'ab', secondKey))
    manager.undo()
    expect(state.value).toBe('a')
    manager.undo()
    expect(state.value).toBe('')
  })

  it('still treats an empty string as a valid explicit coalesce key', () => {
    manager.execute(edit(state, 'a', ''))
    manager.execute(edit(state, 'ab', ''))
    manager.undo()
    expect(state.value).toBe('')
    expect(manager.canUndo).toBe(false)
  })

  it.each([
    ['different schema', affectedTable('first', 'users'), affectedTable('second', 'users')],
    ['different table', affectedTable('public', 'users'), affectedTable('public', 'orders')],
    ['colon in name', affectedTable('a:b', 'c'), affectedTable('a', 'b:c')],
    ['different kind', affectedTable('public', 'users'), affectedInitialData('public', 'users')],
    ['different global files', affectedCommon(), affectedDatabase()],
  ])('same key but %s does not coalesce, even when sharing the SQL file', (_label, firstFile, secondFile) => {
    manager.execute(edit(state, 'a', 'typing', [firstFile, affectedSql()]))
    manager.execute(edit(state, 'ab', 'typing', [secondFile, affectedSql()]))
    manager.undo()
    expect(state.value).toBe('a')
    expect(persist).toHaveBeenLastCalledWith([secondFile, affectedSql()])
    manager.undo()
    expect(state.value).toBe('')
    expect(persist).toHaveBeenLastCalledWith([firstFile, affectedSql()])
  })

  it('requires identical affected file sets, not merely partial overlap', () => {
    const table = affectedTable('public', 'users')
    manager.execute(edit(state, 'a', 'typing', [table]))
    manager.execute(edit(state, 'ab', 'typing', [table, affectedSql()]))
    manager.undo()
    expect(state.value).toBe('a')
  })

  it('file order and duplicates do not affect identity comparison', () => {
    const table = affectedTable('public', 'users')
    const sql = affectedSql()
    manager.execute(edit(state, 'a', 'typing', [table, sql, { ...table }]))
    manager.execute(edit(state, 'ab', 'typing', [sql, { ...table }]))
    manager.undo()
    expect(state.value).toBe('')
    expect(manager.canUndo).toBe(false)
    expect(persist).toHaveBeenLastCalledWith([table, sql])
  })

  it('identity comparison uses the execution-time snapshot and ignores later mutations of reused file descriptors', () => {
    const file = affectedTable('public', 'users')
    manager.execute(edit(state, 'a', 'typing', [file]))
    file.table = 'orders'
    manager.execute(edit(state, 'ab', 'typing', [file]))
    manager.undo()
    expect(state.value).toBe('a')
    expect(manager.canUndo).toBe(true)
  })

  it('discards the redo branch on a new edit after undo and does not coalesce with the remaining stack top', () => {
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

  it('new input after undoing a whole coalesced record also discards the old branch', () => {
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

  it('redo breaks coalescing of subsequent same-key input', () => {
    manager.execute(edit(state, 'a', 'typing'))
    manager.undo()
    manager.redo()
    manager.execute(edit(state, 'ab', 'typing'))
    manager.undo()
    expect(state.value).toBe('a')
    manager.undo()
    expect(state.value).toBe('')
  })

  it('calling redo with nothing to redo also breaks coalescing', () => {
    manager.execute(edit(state, 'a', 'typing'))
    manager.redo()
    expect(persist).toHaveBeenCalledTimes(1)
    manager.execute(edit(state, 'ab', 'typing'))
    manager.undo()
    expect(state.value).toBe('a')
  })

  it('explicit breakCoalescing keeps history and the hook, and input after the boundary can coalesce again', () => {
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

  it('clear empties both stacks without reverting or writing; coalescing then starts from a new snapshot', () => {
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

  it('execute hook gets only the files of this call; coalesced undo/redo hooks get all old paths and fire after the in-memory update', () => {
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

  it('uncoalesced commands still compute affectedFiles dynamically after undo/redo, preserving method this binding', () => {
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

  it('execution and history operations work without a registered persist hook', () => {
    const withoutHook = new CommandManager()
    withoutHook.execute(edit(state, 'a', 'typing'))
    withoutHook.execute(edit(state, 'ab', 'typing'))
    withoutHook.undo()
    expect(state.value).toBe('')
    withoutHook.redo()
    expect(state.value).toBe('ab')
    expect(persist).not.toHaveBeenCalled()
  })

  it('heavy consecutive input only invokes the first/last closures, without recursively replaying intermediate commands', () => {
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
  it('returns an empty array for an empty set', () => {
    expect(mergeAffectedFiles([])).toEqual([])
  })

  it('deduplicates all file kinds, keeping first-item references and order without mutating the input', () => {
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

  it('tuple identity distinguishes colons, quotes, backslashes, newlines, empty strings, and defaults', () => {
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

  it.each(['table', 'initial-data', 'schema'] as const)('%s keeps distinct oldSchema/oldTable and deduplicates only on full identity', kind => {
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
