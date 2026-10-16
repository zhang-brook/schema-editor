import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFsService } from './fs-service'

async function waitFor(predicate: () => boolean, timeout = 5000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for file watch event')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

let workDir: string

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(tmpdir(), 'schema-editor-root-'))
})

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true })
})

describe('createFsService', () => {
  it('拒绝未授权根目录及越出根目录的路径', async () => {
    const service = createFsService()
    await fs.writeFile(path.join(workDir, 'a.json'), '{}')

    expect(await service.readText(path.join(workDir, 'a.json'))).toEqual({ ok: false, code: 'EACCES' })

    service.allowRoot(workDir)
    expect(await service.readText(path.join(workDir, 'a.json'))).toEqual({ ok: true, value: '{}' })
    expect(await service.readText(path.join(workDir, '..', 'escape.json'))).toEqual({ ok: false, code: 'EACCES' })
  })

  it('readDir / statKind 描述文件、目录与缺失路径', async () => {
    const service = createFsService()
    service.allowRoot(workDir)
    await fs.mkdir(path.join(workDir, 'sub'))
    await fs.writeFile(path.join(workDir, 'a.json'), 'a')

    expect(await service.statKind(workDir)).toEqual({ ok: true, value: 'directory' })
    expect(await service.statKind(path.join(workDir, 'a.json'))).toEqual({ ok: true, value: 'file' })
    expect(await service.statKind(path.join(workDir, 'missing'))).toEqual({ ok: true, value: null })

    const entries = await service.readDir(workDir)
    expect(entries.ok).toBe(true)
    if (entries.ok) {
      expect(entries.value.sort((a, b) => (a.name < b.name ? -1 : 1))).toEqual([
        { name: 'a.json', kind: 'file' },
        { name: 'sub', kind: 'directory' },
      ])
    }
    expect(await service.readDir(path.join(workDir, 'missing'))).toEqual({ ok: false, code: 'ENOENT' })
  })

  it('writeText / ensureDir 往返一致，remove 区分递归与非递归', async () => {
    const service = createFsService()
    service.allowRoot(workDir)

    expect(await service.ensureDir(path.join(workDir, 'x', 'y'))).toEqual({ ok: true, value: null })
    expect(await service.writeText(path.join(workDir, 'x', 'y', 'f.json'), 'content')).toEqual({ ok: true, value: null })
    expect(await service.readText(path.join(workDir, 'x', 'y', 'f.json'))).toEqual({ ok: true, value: 'content' })
    expect(await service.readText(path.join(workDir, 'x', 'missing.json'))).toEqual({ ok: false, code: 'ENOENT' })

    const nonRecursive = await service.remove(path.join(workDir, 'x'), false)
    expect(nonRecursive.ok).toBe(false)
    if (!nonRecursive.ok) expect(['EISDIR', 'ENOTEMPTY', 'EPERM']).toContain(nonRecursive.code)

    expect(await service.remove(path.join(workDir, 'x'), true)).toEqual({ ok: true, value: null })
    expect(await service.statKind(path.join(workDir, 'x'))).toEqual({ ok: true, value: null })
    expect(await service.remove(path.join(workDir, 'x'), false)).toEqual({ ok: false, code: 'ENOENT' })
  })

  it('递归监听子目录变更并携带相对路径，watchStop 后不再上报', async () => {
    const service = createFsService()
    service.allowRoot(workDir)
    const events: Array<{ id: number; relativePath: string }> = []
    const started = await service.watchStart(workDir, event => {
      events.push(event)
    })
    expect(started.ok).toBe(true)
    const id = started.ok ? started.value : 0

    await fs.mkdir(path.join(workDir, 'sub'))
    await fs.writeFile(path.join(workDir, 'sub', 'x.json'), '{}')
    await waitFor(() => events.some(event => event.relativePath === 'sub/x.json'))
    expect(events.every(event => event.id === id)).toBe(true)

    expect(await service.watchStop(id)).toEqual({ ok: true, value: null })
    const settled = events.length
    await fs.writeFile(path.join(workDir, 'sub', 'y.json'), '{}')
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(events.length).toBe(settled)
  })
})
