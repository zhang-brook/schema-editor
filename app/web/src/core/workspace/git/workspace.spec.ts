import { describe, expect, it } from 'vitest'
import type { GitCommitInput, GitFetch, GitRemote } from './providers'
import { GitRepoError, type GitRepoInfo, type GitRepoTarget } from './types'
import { repoWebUrl } from './url'
import { connectGitWorkspace, GitWorkspaceWriter } from './workspace'

class FakeRemote implements GitRemote {
  readonly commits: GitCommitInput[] = []
  readonly reads: string[] = []
  head: string
  failCommit: Error | null = null
  private readonly files = new Map<string, { content: string; sha: string }>()
  private readonly blobs = new Map<string, string>()
  private seq = 0

  constructor(files: Record<string, string>, head = 'head-1') {
    this.head = head
    for (const [path, content] of Object.entries(files)) this.write(path, content)
  }

  has(path: string) {
    return this.files.has(path)
  }

  content(path: string) {
    return this.files.get(path)?.content
  }

  shaOf(path: string) {
    return this.files.get(path)!.sha
  }

  async defaultBranch() {
    return 'main'
  }

  async headSha() {
    return this.head
  }

  async listWorkspaceFiles() {
    return new Map([...this.files].map(([path, file]) => [path, file.sha]))
  }

  async readText(blobSha: string) {
    this.reads.push(blobSha)
    const content = this.blobs.get(blobSha)
    if (content === undefined) throw new Error(`Unknown blob: ${blobSha}`)
    return content
  }

  async commit(input: GitCommitInput) {
    if (this.failCommit) throw this.failCommit
    this.commits.push(input)
    for (const change of input.changes) {
      if (change.content === null) this.files.delete(change.path)
      else this.write(change.path, change.content)
    }
    this.head = `head-${this.commits.length + 1}`
  }

  private write(path: string, content: string) {
    const sha = `s${++this.seq}`
    this.files.set(path, { content, sha })
    this.blobs.set(sha, content)
  }
}

const target = (overrides: Partial<GitRepoTarget> = {}): GitRepoTarget => ({
  provider: 'github',
  origin: 'https://github.com',
  host: 'github.com',
  owner: 'acme',
  repo: 'design',
  branch: 'main',
  subdir: 'sql/db',
  prefix: '',
  ...overrides,
})

async function makeWriter(remote: FakeRemote, overrides: Partial<GitRepoTarget> = {}) {
  const repo = target(overrides)
  const info: GitRepoInfo = { ...repo, webUrl: repoWebUrl(repo) }
  const snapshot = await remote.listWorkspaceFiles()
  return { writer: new GitWorkspaceWriter(remote, info, remote.head, snapshot), info }
}

describe('GitWorkspaceWriter', () => {
  it('reads only the files present in the snapshot and caches their contents', async () => {
    const remote = new FakeRemote({ 'common.json': '{"a":1}', 'table.json': '{}' })
    const { writer } = await makeWriter(remote)
    const files = await writer.load(['common.json', 'table.json', 'missing.json'])
    expect(files.size).toBe(2)
    expect(files.get('common.json')).toBe('{"a":1}')
    expect(files.get('table.json')).toBe('{}')
    expect(files.has('missing.json')).toBe(false)
    expect(remote.reads).toHaveLength(2)
  })

  it('lists snapshot entries by directory prefix', async () => {
    const remote = new FakeRemote({
      'common.json': '{}',
      'current/schemas/app/schema.json': '{}',
      'versions/v1.json': '{}',
    })
    const { writer } = await makeWriter(remote)
    expect(await writer.listFiles('current/schemas')).toEqual(['current/schemas/app/schema.json'])
    expect(await writer.listFiles('versions')).toEqual(['versions/v1.json'])
    expect(await writer.listFiles('missing')).toEqual([])
  })

  it('commits only the real differences and then treats the same content as clean', async () => {
    const remote = new FakeRemote({ 'a.json': 'A', 'b.json': 'B' })
    const { writer } = await makeWriter(remote)
    await writer.load(['a.json', 'b.json'])
    const changes = [
      { path: 'a.json', content: 'A' },
      { path: 'b.json', content: 'B2' },
      { path: 'c.json', content: 'C' },
      { path: 'gone.json', content: null },
    ]

    expect(writer.previewCommit(changes)).toEqual([{ path: 'b.json', kind: 'update' }, { path: 'c.json', kind: 'add' }])
    expect(remote.commits).toHaveLength(0)

    const oldSha = remote.shaOf('b.json')
    writer.setCommitMessage('保存 schema 调整')
    const result = await writer.save(changes)

    expect(result.error).toBeUndefined()
    expect(result.savedPaths).toEqual(['a.json', 'b.json', 'c.json', 'gone.json'])
    expect(remote.commits).toHaveLength(1)
    const commit = remote.commits[0]!
    expect(commit.message).toBe('保存 schema 调整')
    expect(commit.branch).toBe('main')
    expect(commit.headSha).toBe('head-1')
    expect(commit.changes).toEqual([
      { path: 'b.json', kind: 'update', content: 'B2', sha: oldSha },
      { path: 'c.json', kind: 'add', content: 'C' },
    ])
    // 提交走的路径始终是工作区相对路径，子目录前缀由远端适配层补
    expect(commit.changes.every(change => !change.path.startsWith('sql/db/'))).toBe(true)
    expect(remote.content('b.json')).toBe('B2')
    expect(remote.has('c.json')).toBe(true)
    expect(remote.head).toBe('head-2')

    const second = await writer.save([{ path: 'b.json', content: 'B2' }, { path: 'c.json', content: 'C' }])
    expect(second.savedPaths).toEqual(['b.json', 'c.json'])
    expect(remote.commits).toHaveLength(1)
  })

  it('deletes files through the snapshot and falls back to the default commit message', async () => {
    const remote = new FakeRemote({ 'a.json': 'A' })
    const { writer } = await makeWriter(remote)
    await writer.load(['a.json'])

    const result = await writer.save([{ path: 'a.json', content: null }])

    expect(result.savedPaths).toEqual(['a.json'])
    expect(remote.commits[0]!.changes).toEqual([{ path: 'a.json', kind: 'delete', content: null, sha: 's1' }])
    expect(remote.commits[0]!.message).toBe('Update schema project')
    expect(remote.has('a.json')).toBe(false)

    const again = await writer.save([{ path: 'a.json', content: null }])
    expect(again.error).toBeUndefined()
    expect(remote.commits).toHaveLength(1)
  })

  it('treats unchanged content as clean even after the branch moved', async () => {
    const remote = new FakeRemote({ 'a.json': 'A' })
    const { writer } = await makeWriter(remote)
    await writer.load(['a.json'])
    remote.head = 'moved'

    const result = await writer.save([{ path: 'a.json', content: 'A' }])

    expect(result.savedPaths).toEqual(['a.json'])
    expect(remote.commits).toHaveLength(0)
  })

  it('refuses to commit when the branch moved past the loaded snapshot', async () => {
    const remote = new FakeRemote({ 'a.json': 'A' })
    const { writer } = await makeWriter(remote)
    await writer.load(['a.json'])
    expect(await writer.hasExternalChanges([])).toBe(false)

    remote.head = 'moved'
    expect(await writer.hasExternalChanges([])).toBe(true)
    const result = await writer.save([{ path: 'a.json', content: 'A2' }])

    expect(result.savedPaths).toEqual([])
    expect(result.error).toBeInstanceOf(GitRepoError)
    expect((result.error as GitRepoError).code).toBe('conflict')
    expect(remote.commits).toHaveLength(0)
    expect(remote.content('a.json')).toBe('A')
  })

  it('surfaces a rejected commit and stays retryable', async () => {
    const remote = new FakeRemote({ 'a.json': 'A' })
    const { writer } = await makeWriter(remote)
    await writer.load(['a.json'])
    remote.failCommit = new GitRepoError('conflict', 'rejected by server')

    const failed = await writer.save([{ path: 'a.json', content: 'A2' }])
    expect(failed.error).toBe(remote.failCommit)
    expect(remote.commits).toHaveLength(0)

    remote.failCommit = null
    const retry = await writer.save([{ path: 'a.json', content: 'A2' }])
    expect(retry.error).toBeUndefined()
    expect(remote.commits).toHaveLength(1)
    expect(remote.content('a.json')).toBe('A2')
  })
})

describe('connectGitWorkspace', () => {
  it('resolves the default branch, head and subdirectory snapshot', async () => {
    const calls: string[] = []
    const impl: GitFetch = async input => {
      calls.push(input)
      if (input === 'https://api.github.com/repos/acme/design') {
        return new Response(JSON.stringify({ default_branch: 'trunk' }), { status: 200 })
      }
      if (input.endsWith('/git/ref/heads/trunk')) {
        return new Response(JSON.stringify({ object: { sha: 'head-9' } }), { status: 200 })
      }
      if (input.endsWith('/git/trees/head-9?recursive=1')) {
        return new Response(JSON.stringify({
          tree: [
            { path: 'sql/db/common.json', type: 'blob', sha: 'b1' },
            { path: 'sql/db/current', type: 'tree', sha: 't1' },
          ],
        }), { status: 200 })
      }
      if (input.endsWith('/git/blobs/b1')) {
        return new Response(JSON.stringify({ content: '5Lit5paH' }), { status: 200 })
      }
      throw new Error(`Unexpected request: ${input}`)
    }

    const { writer, info } = await connectGitWorkspace(target({ branch: '' }), 'tok', impl)

    expect(info.branch).toBe('trunk')
    expect(info.webUrl).toBe('https://github.com/acme/design')
    expect(info.subdir).toBe('sql/db')
    expect(writer.supportsAutoSave).toBe(false)
    expect(await writer.listFiles('nowhere')).toEqual([])
    expect((await writer.load(['common.json'])).get('common.json')).toBe('中文')
    expect(calls[0]).toBe('https://api.github.com/repos/acme/design')
  })
})
