import { describe, expect, it } from 'vitest'
import { createGitRemote, decodeBase64, encodeBase64, type GitFetch, type GitTreeEntry } from './providers'
import { GitRepoError } from './types'
import { parseRepoUrl } from './url'

interface FakeRequest {
  method: string
  url: string
  body: any
  headers: Record<string, string>
}

function fakeFetch(route: (request: FakeRequest) => { status?: number; data?: unknown } | Error) {
  const calls: FakeRequest[] = []
  const impl: GitFetch = async (input, init) => {
    const request: FakeRequest = {
      method: init?.method ?? 'GET',
      url: input,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      headers: (init?.headers ?? {}) as Record<string, string>,
    }
    calls.push(request)
    const result = route(request)
    if (result instanceof Error) throw result
    return new Response(JSON.stringify(result.data ?? {}), { status: result.status ?? 200 })
  }
  return { impl, calls }
}

function callOf(calls: FakeRequest[], method: string, fragment: string): FakeRequest {
  const call = calls.find(item => item.method === method && item.url.includes(fragment))
  if (!call) throw new Error(`No ${method} request matching ${fragment}`)
  return call
}

const githubTarget = () => parseRepoUrl('https://github.com/acme/design/tree/main/sql/db')
const giteeTarget = () => parseRepoUrl('https://gitee.com/acme/design/tree/master/sql')
const giteaTarget = () => parseRepoUrl('http://git.internal:3000/gitea/acme/design/src/branch/main/data')

describe('encodeBase64 / decodeBase64', () => {
  it('round-trips UTF-8 text and tolerates the GitHub line folding', () => {
    expect(encodeBase64('Hello')).toBe('SGVsbG8=')
    expect(decodeBase64('SGVsbG8=')).toBe('Hello')
    expect(encodeBase64('中文')).toBe('5Lit5paH')
    expect(decodeBase64('5Lit\n5paH')).toBe('中文')

    const large = 'x'.repeat(100_000)
    expect(decodeBase64(encodeBase64(large))).toBe(large)
  })
})

describe('GithubRemote', () => {
  it('commits through the Git Data API chain', async () => {
    let blobCount = 0
    const { impl, calls } = fakeFetch(({ method, url }) => {
      if (method === 'GET' && url.endsWith('/git/commits/head1')) return { data: { tree: { sha: 'basetree' } } }
      if (method === 'POST' && url.endsWith('/git/blobs')) return { data: { sha: `newblob-${++blobCount}` } }
      if (method === 'POST' && url.endsWith('/git/trees')) return { data: { sha: 'newtree' } }
      if (method === 'POST' && url.endsWith('/git/commits')) return { data: { sha: 'newcommit' } }
      if (method === 'PATCH' && url.endsWith('/git/refs/heads/main')) return { data: { object: { sha: 'newcommit' } } }
      throw new Error(`Unexpected request: ${method} ${url}`)
    })
    const remote = createGitRemote(githubTarget(), 'tok', impl)
    await remote.commit({
      branch: 'main',
      headSha: 'head1',
      message: '更新 schema',
      changes: [
        { path: 'a.json', kind: 'add', content: '{"a":1}' },
        { path: 'b.json', kind: 'update', content: '{"b":2}', sha: 'old-b' },
        { path: 'c.json', kind: 'delete', content: null, sha: 'old-c' },
      ],
    })

    expect(calls.map(call => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      'GET /repos/acme/design/git/commits/head1',
      'POST /repos/acme/design/git/blobs',
      'POST /repos/acme/design/git/blobs',
      'POST /repos/acme/design/git/trees',
      'POST /repos/acme/design/git/commits',
      'PATCH /repos/acme/design/git/refs/heads/main',
    ])
    const blobCalls = calls.filter(call => call.url.endsWith('/git/blobs'))
    expect(blobCalls.map(call => call.body)).toEqual([
      { content: '{"a":1}', encoding: 'utf-8' },
      { content: '{"b":2}', encoding: 'utf-8' },
    ])
    expect(blobCalls[0]!.headers.Authorization).toBe('Bearer tok')
    expect(blobCalls[0]!.headers.Accept).toBe('application/vnd.github+json')
    expect(callOf(calls, 'GET', '/git/commits/head1').headers['Content-Type']).toBeUndefined()

    const tree = callOf(calls, 'POST', '/git/trees')
    expect(tree.headers['Content-Type']).toBe('application/json')
    expect(tree.body).toEqual({
      base_tree: 'basetree',
      tree: [
        { path: 'sql/db/a.json', mode: '100644', type: 'blob', sha: 'newblob-1' },
        { path: 'sql/db/b.json', mode: '100644', type: 'blob', sha: 'newblob-2' },
        { path: 'sql/db/c.json', mode: '100644', type: 'blob', sha: null },
      ],
    })
    expect(callOf(calls, 'POST', '/git/commits').body).toEqual({
      message: '更新 schema',
      tree: 'newtree',
      parents: ['head1'],
    })
    const ref = callOf(calls, 'PATCH', '/git/refs/heads/main')
    expect(ref.body).toEqual({ sha: 'newcommit', force: false })
  })

  it('maps a rejected non-fast-forward ref update to a conflict', async () => {
    const { impl } = fakeFetch(({ method, url }) => {
      if (method === 'GET' && url.endsWith('/git/commits/head1')) return { data: { tree: { sha: 'basetree' } } }
      if (method === 'POST' && url.endsWith('/git/blobs')) return { data: { sha: 'blob-1' } }
      if (method === 'POST' && url.endsWith('/git/trees')) return { data: { sha: 'newtree' } }
      if (method === 'POST' && url.endsWith('/git/commits')) return { data: { sha: 'newcommit' } }
      if (method === 'PATCH') return { status: 422, data: { message: 'Update is not a fast forward' } }
      throw new Error(`Unexpected request: ${method} ${url}`)
    })
    const remote = createGitRemote(githubTarget(), 'tok', impl)
    await expect(remote.commit({
      branch: 'main',
      headSha: 'head1',
      message: 'm',
      changes: [{ path: 'a.json', kind: 'add', content: '{}' }],
    })).rejects.toMatchObject({ name: 'GitRepoError', code: 'conflict' })
  })

  it('indexes only the target subdirectory from the recursive tree', async () => {
    const { impl } = fakeFetch(({ url }) => {
      if (url.endsWith('/git/trees/head1?recursive=1')) {
        return {
          data: {
            tree: [
              { path: 'README.md', type: 'blob', sha: 'b0' },
              { path: 'sql', type: 'tree', sha: 't1' },
              { path: 'sql/other.json', type: 'blob', sha: 'b1' },
              { path: 'sql/db', type: 'tree', sha: 't2' },
              { path: 'sql/db/table.json', type: 'blob', sha: 'b2' },
              { path: 'sql/db/nested/x.json', type: 'blob', sha: 'b3' },
            ],
          },
        }
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const files = await createGitRemote(githubTarget(), 'tok', impl).listWorkspaceFiles('head1')
    expect([...files.entries()]).toEqual([['table.json', 'b2'], ['nested/x.json', 'b3']])
  })

  it('maps a repository-root workspace to repository paths', async () => {
    const { impl } = fakeFetch(({ url }) => {
      if (url.endsWith('/git/trees/head1?recursive=1')) {
        return { data: { tree: [{ path: 'common.json', type: 'blob', sha: 'b0' }, { path: 'src', type: 'tree', sha: 't1' }] } }
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const files = await createGitRemote(parseRepoUrl('https://github.com/acme/design'), 'tok', impl).listWorkspaceFiles('head1')
    expect([...files.entries()]).toEqual([['common.json', 'b0']])
  })

  it('walks the target directory when the recursive tree is truncated', async () => {
    const trees: Record<string, GitTreeEntry[]> = {
      head1: [
        { path: 'docs', type: 'tree', sha: 't-docs' },
        { path: 'sql', type: 'tree', sha: 't-sql' },
        { path: 'root.json', type: 'blob', sha: 'b-root' },
      ],
      't-sql': [
        { path: 'db', type: 'tree', sha: 't-db' },
        { path: 'other.json', type: 'blob', sha: 'b-other' },
      ],
      't-db': [
        { path: 'table.json', type: 'blob', sha: 'b-table' },
        // 非递归列表在部分平台返回仓库相对路径
        { path: 'sql/db/deep.json', type: 'blob', sha: 'b-deep' },
      ],
    }
    const { impl, calls } = fakeFetch(({ url }) => {
      if (url.endsWith('/git/trees/head1?recursive=1')) return { data: { tree: [], truncated: true } }
      const sha = url.slice(url.lastIndexOf('/') + 1)
      if (trees[sha]) return { data: { tree: trees[sha] } }
      throw new Error(`Unexpected request: ${url}`)
    })
    const files = await createGitRemote(githubTarget(), 'tok', impl).listWorkspaceFiles('head1')
    expect([...files.entries()]).toEqual([['table.json', 'b-table'], ['deep.json', 'b-deep']])
    const visited = calls.map(call => call.url.slice(call.url.lastIndexOf('/') + 1))
    expect(visited).toEqual(['head1?recursive=1', 'head1', 't-sql', 't-db'])
  })

  it('reads blob text even when the base64 content is folded', async () => {
    const { impl, calls } = fakeFetch(({ url }) => {
      if (url.includes('/git/blobs/')) return { data: { content: '5Lit\n5paH' } }
      throw new Error(`Unexpected request: ${url}`)
    })
    const remote = createGitRemote(giteaTarget(), 'tok', impl)
    expect(await remote.readText('sha-1')).toBe('中文')
    expect(new URL(calls[0]!.url).pathname).toBe('/gitea/api/v1/repos/acme/design/git/blobs/sha-1')
  })
})

describe('GiteeRemote', () => {
  it('commits the whole change set through one endpoint call', async () => {
    const { impl, calls } = fakeFetch(() => ({ data: { sha: 'newcommit' } }))
    const remote = createGitRemote(giteeTarget(), 'tok', impl)
    await remote.commit({
      branch: 'master',
      headSha: 'head1',
      message: '更新 schema',
      changes: [
        { path: 'a.json', kind: 'add', content: '中文' },
        { path: 'b.json', kind: 'update', content: '{}', sha: 'old-b' },
        { path: 'c.json', kind: 'delete', content: null, sha: 'old-c' },
      ],
    })

    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.method).toBe('POST')
    expect(call.url).toBe('https://gitee.com/api/v5/repos/acme/design/commits')
    expect(call.headers.Authorization).toBe('token tok')
    expect(call.body).toEqual({
      branch: 'master',
      message: '更新 schema',
      actions: [
        { action: 'create', path: 'sql/a.json', content: '5Lit5paH', encoding: 'base64' },
        { action: 'update', path: 'sql/b.json', content: 'e30=', encoding: 'base64' },
        { action: 'delete', path: 'sql/c.json' },
      ],
    })
  })

  it('maps the write rejection statuses to a conflict', async () => {
    const { impl } = fakeFetch(() => ({ status: 409, data: {} }))
    const remote = createGitRemote(giteeTarget(), '', impl)
    await expect(remote.commit({
      branch: 'master',
      headSha: 'head1',
      message: 'm',
      changes: [{ path: 'a.json', kind: 'add', content: '{}' }],
    })).rejects.toMatchObject({ code: 'conflict' })
  })

  it('resolves the branch head and rejects a branch without a commit', async () => {
    const { impl, calls } = fakeFetch(() => ({ data: { commit: { sha: 'h1' } } }))
    const remote = createGitRemote(giteeTarget(), 'tok', impl)
    expect(await remote.headSha('feature/x')).toBe('h1')
    expect(new URL(calls[0]!.url).pathname).toBe('/api/v5/repos/acme/design/branches/feature%2Fx')

    const empty = fakeFetch(() => ({ data: {} }))
    await expect(createGitRemote(giteeTarget(), 'tok', empty.impl).headSha('main')).rejects.toMatchObject({ code: 'branchNotFound' })
  })

  it('resolves the default branch', async () => {
    const { impl, calls } = fakeFetch(() => ({ data: { default_branch: 'main' } }))
    expect(await createGitRemote(giteeTarget(), 'tok', impl).defaultBranch()).toBe('main')
    expect(calls[0]!.url).toBe('https://gitee.com/api/v5/repos/acme/design')
  })
})

describe('GiteaRemote', () => {
  it('commits through the contents endpoint with per-file blob shas', async () => {
    const { impl, calls } = fakeFetch(({ method, url }) => {
      if (method === 'GET' && url.endsWith('/branches/main')) return { data: { commit: { id: 'cid' } } }
      if (method === 'POST' && url.endsWith('/contents')) return { data: { commit: { id: 'newcid' } } }
      throw new Error(`Unexpected request: ${method} ${url}`)
    })
    const remote = createGitRemote(giteaTarget(), 'tok', impl)
    expect(await remote.headSha('main')).toBe('cid')
    await remote.commit({
      branch: 'main',
      headSha: 'cid',
      message: 'm',
      changes: [
        { path: 'a.json', kind: 'add', content: '{}' },
        { path: 'b.json', kind: 'update', content: '{}', sha: 'old-b' },
        { path: 'c.json', kind: 'delete', content: null, sha: 'old-c' },
      ],
    })

    const call = callOf(calls, 'POST', '/contents')
    expect(call.url).toBe('http://git.internal:3000/gitea/api/v1/repos/acme/design/contents')
    expect(call.headers.Authorization).toBe('token tok')
    expect(call.body).toEqual({
      branch: 'main',
      message: 'm',
      files: [
        { operation: 'create', path: 'data/a.json', content: 'e30=' },
        { operation: 'update', path: 'data/b.json', content: 'e30=', sha: 'old-b' },
        { operation: 'delete', path: 'data/c.json', content: '', sha: 'old-c' },
      ],
    })
    expect('sha' in call.body.files[0]).toBe(false)
  })

  it('uses the Gitea recursive query spelling', async () => {
    const { impl, calls } = fakeFetch(({ url }) => {
      if (url.endsWith('/git/trees/head1?recursive=true')) return { data: { tree: [] } }
      throw new Error(`Unexpected request: ${url}`)
    })
    expect(await createGitRemote(giteaTarget(), 'tok', impl).listWorkspaceFiles('head1')).toEqual(new Map())
    expect(calls[0]!.url).toBe('http://git.internal:3000/gitea/api/v1/repos/acme/design/git/trees/head1?recursive=true')
  })
})

describe('error mapping', () => {
  it('maps HTTP statuses to error codes', async () => {
    const unauthorized = fakeFetch(() => ({ status: 401, data: {} }))
    await expect(createGitRemote(githubTarget(), '', unauthorized.impl).defaultBranch()).rejects.toMatchObject({ code: 'auth' })

    const missingRepo = fakeFetch(() => ({ status: 404, data: {} }))
    await expect(createGitRemote(githubTarget(), 'tok', missingRepo.impl).defaultBranch()).rejects.toMatchObject({ code: 'notFound' })

    const missingBranch = fakeFetch(() => ({ status: 404, data: {} }))
    await expect(createGitRemote(githubTarget(), 'tok', missingBranch.impl).headSha('main')).rejects.toMatchObject({ code: 'branchNotFound' })
  })

  it('reports fetch failures as network errors', async () => {
    const offline = fakeFetch(() => new Error('offline'))
    await expect(createGitRemote(giteeTarget(), 'tok', offline.impl).headSha('main')).rejects.toBeInstanceOf(GitRepoError)
    await expect(createGitRemote(giteeTarget(), 'tok', offline.impl).headSha('main')).rejects.toMatchObject({ code: 'network' })
  })
})
