import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SaveCoordinator, type AutoSaveOptions, type SaveGroup, type SaveResult, type WorkspaceWriter } from './save-coordinator'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

const allAuto = { docs: true, outputs: true }
const manual = { docs: false, outputs: false }
const isDerived = (path: string): SaveGroup => path.startsWith('output/') ? 'outputs' : 'docs'

function fixture(options: { autoSave?: Partial<AutoSaveOptions>; classify?: (path: string) => SaveGroup; initialFiles?: Map<string, string> } = {}) {
  const initialFiles = options.initialFiles ?? new Map([['table.json', 'original'], ['other.json', 'untouched']])
  const disk = new Map(initialFiles)
  const save = vi.fn<WorkspaceWriter['save']>(async changes => {
    for (const { path, content } of changes) {
      if (content === null) disk.delete(path)
      else disk.set(path, content)
    }
    return { savedPaths: changes.map(change => change.path) }
  })
  const coordinator = new SaveCoordinator({
    writer: { supportsAutoSave: true, save },
    initialFiles,
    autoSave: options.autoSave,
    classify: options.classify,
  })
  return { coordinator, disk, save }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('SaveCoordinator', () => {
  it('starts clean and performs no background I/O', async () => {
    const { coordinator, save } = fixture()
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).not.toHaveBeenCalled()
    expect(coordinator.state).toEqual({ dirty: false, saving: false, error: null, pendingFiles: 0 })
  })

  it('coalesces typing and writes only the changed document', async () => {
    const { coordinator, save, disk } = fixture()
    for (const content of ['a', 'ab', 'abc']) {
      coordinator.update([{ path: 'table.json', content }])
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300)
    expect(save).toHaveBeenCalledExactlyOnceWith([{ path: 'table.json', content: 'abc' }], 'auto')
    expect(disk.get('other.json')).toBe('untouched')
    expect(coordinator.state.dirty).toBe(false)
  })

  it('flushes sustained typing at the maximum wait', async () => {
    const { coordinator, save } = fixture()
    for (let i = 0; i < 20; i++) {
      coordinator.update([{ path: 'table.json', content: String(i) }])
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]![0]).toEqual([{ path: 'table.json', content: '19' }])
  })

  it('does not write in manual mode and full save writes all documents', async () => {
    const { coordinator, save } = fixture({ autoSave: manual })
    coordinator.update([{ path: 'table.json', content: 'edited' }])
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).not.toHaveBeenCalled()
    expect(coordinator.state.dirty).toBe(true)
    await coordinator.saveAll()
    expect(save).toHaveBeenCalledExactlyOnceWith([
      { path: 'table.json', content: 'edited' },
      { path: 'other.json', content: 'untouched' },
    ], 'manual')
    expect(coordinator.state.dirty).toBe(false)
  })

  it('full save can rewrite a clean workspace', async () => {
    const { coordinator, save } = fixture({ autoSave: manual })
    await coordinator.saveAll()
    expect(save.mock.calls[0]![0]).toHaveLength(2)
  })

  it('cancels scheduled writes when auto save is disabled and flushes when reenabled', async () => {
    const { coordinator, save } = fixture()
    coordinator.update([{ path: 'table.json', content: 'edited' }])
    coordinator.setAutoSave(manual)
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).not.toHaveBeenCalled()
    coordinator.setAutoSave(allAuto)
    await vi.advanceTimersByTimeAsync(400)
    expect(save).toHaveBeenCalledOnce()
  })

  it('writes only project documents while SQL sync is off, leaving derived files pending', async () => {
    const { coordinator, save, disk } = fixture({
      autoSave: { docs: true, outputs: false },
      classify: isDerived,
      initialFiles: new Map([['table.json', 'original'], ['output/app.sql', 'old sql']]),
    })
    coordinator.update([{ path: 'table.json', content: 'edited' }])
    coordinator.update([{ path: 'output/app.sql', content: 'new sql' }])
    await vi.advanceTimersByTimeAsync(400)
    expect(save).toHaveBeenCalledExactlyOnceWith([{ path: 'table.json', content: 'edited' }], 'auto')
    expect(coordinator.state).toMatchObject({ dirty: true, pendingFiles: 1 })
    expect(disk.get('output/app.sql')).toBe('old sql')

    await coordinator.saveAll()
    expect(disk.get('output/app.sql')).toBe('new sql')
    expect(coordinator.state.dirty).toBe(false)
  })

  it('writes only derived files while project auto save is off', async () => {
    const { coordinator, save, disk } = fixture({
      autoSave: { docs: false, outputs: true },
      classify: isDerived,
      initialFiles: new Map([['table.json', 'original'], ['output/app.sql', 'old sql']]),
    })
    coordinator.update([
      { path: 'table.json', content: 'edited' },
      { path: 'output/app.sql', content: 'new sql' },
    ])
    await vi.advanceTimersByTimeAsync(400)
    expect(save).toHaveBeenCalledExactlyOnceWith([{ path: 'output/app.sql', content: 'new sql' }], 'auto')
    expect(coordinator.state).toMatchObject({ dirty: true, pendingFiles: 1 })
    expect(disk.get('table.json')).toBe('original')
  })

  it('schedules nothing when both groups are manual and still writes everything on demand', async () => {
    const { coordinator, save, disk } = fixture({ autoSave: manual, classify: isDerived })
    coordinator.update([{ path: 'table.json', content: 'edited' }, { path: 'output/app.sql', content: 'new sql' }])
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).not.toHaveBeenCalled()
    expect(coordinator.state.pendingFiles).toBe(2)
    await coordinator.saveAll()
    expect(disk.get('table.json')).toBe('edited')
    expect(disk.get('output/app.sql')).toBe('new sql')
  })

  it('reports the effective switches and honors a provider without auto save', () => {
    const { coordinator } = fixture({ autoSave: { docs: true, outputs: false } })
    expect(coordinator.autoSaveOptions).toEqual({ docs: true, outputs: false })
    coordinator.setAutoSave({ outputs: true })
    expect(coordinator.autoSaveOptions).toEqual(allAuto)

    const manualOnly = new SaveCoordinator({ writer: { supportsAutoSave: false, save: vi.fn() }, initialFiles: new Map() })
    manualOnly.setAutoSave(allAuto)
    expect(manualOnly.autoSaveOptions).toEqual(manual)
  })

  it('honors a provider that only supports explicit saves', async () => {
    const save = vi.fn<WorkspaceWriter['save']>(async changes => ({ savedPaths: changes.map(c => c.path) }))
    const coordinator = new SaveCoordinator({ writer: { supportsAutoSave: false, save }, initialFiles: new Map() })
    coordinator.setAutoSave(allAuto)
    coordinator.update([{ path: 'new.json', content: '{}' }])
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).not.toHaveBeenCalled()
    await coordinator.saveAll()
    expect(save).toHaveBeenCalledOnce()
  })

  it('clears dirty state when undo returns to the saved content', async () => {
    const { coordinator, save } = fixture()
    coordinator.update([{ path: 'table.json', content: 'edited' }])
    coordinator.update([{ path: 'table.json', content: 'original' }])
    expect(coordinator.state.dirty).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).not.toHaveBeenCalled()
  })

  it('cancels a newly created document that is deleted before saving', async () => {
    const { coordinator, save } = fixture()
    coordinator.update([{ path: 'new.json', content: '{}' }])
    coordinator.update([{ path: 'new.json', content: null }])
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).not.toHaveBeenCalled()
    expect(coordinator.state.dirty).toBe(false)
  })

  it('persists deletion and can restore the same path later', async () => {
    const { coordinator, disk } = fixture({ autoSave: manual })
    coordinator.update([{ path: 'table.json', content: null }])
    await coordinator.saveAll()
    expect(disk.has('table.json')).toBe(false)
    coordinator.update([{ path: 'table.json', content: 'original' }])
    expect(coordinator.state.dirty).toBe(true)
    await coordinator.saveAll()
    expect(disk.get('table.json')).toBe('original')
  })

  it('retains new edits made during an in-flight save', async () => {
    const { coordinator, save } = fixture()
    const pending = deferred<SaveResult>()
    save.mockImplementationOnce(() => pending.promise)
    coordinator.update([{ path: 'table.json', content: 'first' }])
    await vi.advanceTimersByTimeAsync(400)
    expect(coordinator.state.saving).toBe(true)
    coordinator.update([{ path: 'table.json', content: 'second' }])
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
    pending.resolve({ savedPaths: ['table.json'] })
    await coordinator.waitForIdle()
    expect(coordinator.state.dirty).toBe(true)
    await vi.advanceTimersByTimeAsync(400)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]![0]).toEqual([{ path: 'table.json', content: 'second' }])
    expect(coordinator.state.dirty).toBe(false)
  })

  it('resaves an undo to the old baseline if the pending edit finishes afterwards', async () => {
    const { coordinator, save } = fixture()
    const pending = deferred<SaveResult>()
    save.mockImplementationOnce(() => pending.promise)
    coordinator.update([{ path: 'table.json', content: 'first' }])
    await vi.advanceTimersByTimeAsync(400)
    coordinator.update([{ path: 'table.json', content: 'original' }])
    pending.resolve({ savedPaths: ['table.json'] })
    await coordinator.waitForIdle()
    expect(coordinator.state.dirty).toBe(true)
    await vi.advanceTimersByTimeAsync(400)
    expect(save.mock.calls[1]![0]).toEqual([{ path: 'table.json', content: 'original' }])
  })

  it('queues explicit saves behind the current immutable batch', async () => {
    const { coordinator, save } = fixture({ autoSave: manual })
    const pending = deferred<SaveResult>()
    save.mockImplementationOnce(() => pending.promise)
    coordinator.update([{ path: 'table.json', content: 'first' }])
    const first = coordinator.saveAll()
    await Promise.resolve()
    coordinator.update([{ path: 'table.json', content: 'second' }])
    const second = coordinator.saveAll()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]![0][0]!.content).toBe('first')
    pending.resolve({ savedPaths: ['table.json', 'other.json'] })
    await Promise.all([first, second])
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]![0][0]!.content).toBe('second')
  })

  it('keeps failed files dirty without continuously retrying', async () => {
    const { coordinator, save } = fixture()
    const error = new Error('permission denied')
    save.mockResolvedValueOnce({ savedPaths: [], error })
    coordinator.update([{ path: 'table.json', content: 'edited' }])
    await vi.advanceTimersByTimeAsync(400)
    expect(coordinator.state.error).toBe(error)
    expect(coordinator.state.dirty).toBe(true)
    await vi.advanceTimersByTimeAsync(10000)
    expect(save).toHaveBeenCalledOnce()
    await coordinator.saveAll()
    expect(coordinator.state.error).toBeNull()
    expect(coordinator.state.dirty).toBe(false)
  })

  it('acknowledges only successful files in a partially completed batch', async () => {
    const { coordinator, save } = fixture()
    save.mockResolvedValueOnce({ savedPaths: ['table.json'], error: new Error('disk full') })
    coordinator.update([
      { path: 'table.json', content: 'edited' },
      { path: 'other.json', content: 'also edited' },
    ])
    await vi.advanceTimersByTimeAsync(400)
    expect(coordinator.state.pendingFiles).toBe(1)
    await coordinator.saveChanges()
    expect(save.mock.calls[1]![0]).toEqual([{ path: 'other.json', content: 'also edited' }])
    expect(coordinator.state.dirty).toBe(false)
  })

  it('treats incomplete receipts and rejected writes as failures', async () => {
    const { coordinator, save } = fixture({ autoSave: manual })
    coordinator.update([{ path: 'table.json', content: 'edited' }])
    save.mockResolvedValueOnce({ savedPaths: [] })
    await expect(coordinator.saveAll()).rejects.toThrow('Incomplete workspace save')
    save.mockRejectedValueOnce(new Error('connection lost'))
    await expect(coordinator.saveAll()).rejects.toThrow('connection lost')
    expect(coordinator.state.dirty).toBe(true)
    await coordinator.saveAll()
    expect(coordinator.state.dirty).toBe(false)
  })

  it('prepares generated files only when flushing and skips unchanged output', async () => {
    const save = vi.fn<WorkspaceWriter['save']>(async changes => ({ savedPaths: changes.map(c => c.path) }))
    const prepare = vi.fn<NonNullable<ConstructorParameters<typeof SaveCoordinator>[0]['prepare']>>(() => [
      { path: 'output.sql', content: 'unchanged sql' },
    ])
    const coordinator = new SaveCoordinator({
      writer: { supportsAutoSave: true, save },
      initialFiles: new Map([['table.json', 'original'], ['output.sql', 'unchanged sql']]),
      prepare,
    })
    coordinator.update([{ path: 'table.json', content: 'a' }])
    coordinator.update([{ path: 'table.json', content: 'ab' }])
    expect(prepare).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(400)
    expect(prepare).toHaveBeenCalledExactlyOnceWith(['table.json'], 'auto')
    expect(save.mock.calls[0]![0]).toEqual([{ path: 'table.json', content: 'ab' }])
  })

  it('retains dirty state if preparation fails', async () => {
    const save = vi.fn<WorkspaceWriter['save']>()
    const coordinator = new SaveCoordinator({
      writer: { supportsAutoSave: true, save }, initialFiles: new Map(), autoSave: manual,
      prepare: () => { throw new Error('generation failed') },
    })
    coordinator.update([{ path: 'table.json', content: '{}' }])
    await expect(coordinator.saveAll()).rejects.toThrow('generation failed')
    expect(coordinator.state.dirty).toBe(true)
    expect(save).not.toHaveBeenCalled()
  })

  it('disposes timers and waits for the captured writer without notifying a new session', async () => {
    const pending = deferred<SaveResult>()
    const save = vi.fn<WorkspaceWriter['save']>(() => pending.promise)
    const onStateChange = vi.fn()
    const coordinator = new SaveCoordinator({ writer: { supportsAutoSave: true, save }, initialFiles: new Map(), onStateChange })
    coordinator.update([{ path: 'table.json', content: '{}' }])
    await vi.advanceTimersByTimeAsync(400)
    const dispose = coordinator.dispose()
    const count = onStateChange.mock.calls.length
    coordinator.update([{ path: 'other.json', content: '{}' }])
    pending.resolve({ savedPaths: ['table.json'] })
    await dispose
    await vi.advanceTimersByTimeAsync(5000)
    expect(onStateChange).toHaveBeenCalledTimes(count)
    expect(save).toHaveBeenCalledOnce()
    await expect(coordinator.saveAll()).rejects.toThrow('Workspace is closed')
  })

  it('writes one document in a workspace containing ten thousand documents', async () => {
    const files = new Map(Array.from({ length: 10000 }, (_, i) => [`table-${i}.json`, '{}']))
    const { coordinator, save } = fixture({ initialFiles: files })
    coordinator.update([{ path: 'table-5000.json', content: '{"edited":true}' }])
    await vi.advanceTimersByTimeAsync(400)
    expect(save.mock.calls[0]![0]).toEqual([{ path: 'table-5000.json', content: '{"edited":true}' }])
  })
})
