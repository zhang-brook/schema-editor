import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRecentFolders } from './recent-folders'

let workDir: string
let file: string

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(tmpdir(), 'schema-editor-recent-'))
  file = path.join(workDir, 'recent-folders.json')
})

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true })
})

describe('createRecentFolders', () => {
  it('按打开顺序倒序保存，重复打开去重并置顶', async () => {
    const recent = createRecentFolders(file)
    await recent.add(path.join(workDir, 'a'))
    await recent.add(path.join(workDir, 'b'))
    expect(await recent.list()).toEqual([path.join(workDir, 'b'), path.join(workDir, 'a')])

    await recent.add(path.join(workDir, 'a'))
    expect(await recent.list()).toEqual([path.join(workDir, 'a'), path.join(workDir, 'b')])
    expect(await recent.mostRecent()).toBe(path.join(workDir, 'a'))
  })

  it('限制条目数量并可从列表移除', async () => {
    const recent = createRecentFolders(file, 2)
    await recent.add(path.join(workDir, 'a'))
    await recent.add(path.join(workDir, 'b'))
    await recent.add(path.join(workDir, 'c'))
    expect(await recent.list()).toEqual([path.join(workDir, 'c'), path.join(workDir, 'b')])

    expect(await recent.remove(path.join(workDir, 'c'))).toEqual([path.join(workDir, 'b')])
    expect(await recent.list()).toEqual([path.join(workDir, 'b')])
  })

  it('持久化到文件，新实例可读回', async () => {
    await createRecentFolders(file).add(path.join(workDir, 'folder'))
    expect(await createRecentFolders(file).list()).toEqual([path.join(workDir, 'folder')])
  })

  it('文件缺失或内容损坏时返回空列表', async () => {
    expect(await createRecentFolders(file).list()).toEqual([])
    await fs.writeFile(file, '{not json', 'utf8')
    expect(await createRecentFolders(file).list()).toEqual([])
    await fs.writeFile(file, JSON.stringify({ folders: [1, 'ok', null] }), 'utf8')
    expect(await createRecentFolders(file).list()).toEqual(['ok'])
  })
})
