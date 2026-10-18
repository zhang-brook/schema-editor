import { GitRepoError, type GitFileChange, type GitRepoTarget, type GitRepoErrorCode } from './types'
import { repoApiUrl } from './url'

export type GitFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface GitTreeEntry {
  path: string
  type: string
  sha: string
}

export interface GitCommitInput {
  branch: string
  headSha: string
  message: string
  changes: readonly GitFileChange[]
}

export interface GitRemote {
  defaultBranch(): Promise<string>
  headSha(branch: string): Promise<string>
  /** File index under the target subdirectory: workspace-relative path -> blob sha */
  listWorkspaceFiles(headSha: string): Promise<Map<string, string>>
  readText(blobSha: string): Promise<string>
  commit(input: GitCommitInput): Promise<void>
}

export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

export function decodeBase64(base64: string): string {
  // GitHub folds blob content every 60 characters, so strip all whitespace before decoding
  const binary = atob(base64.replace(/\s+/g, ''))
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

type StatusMap = Partial<Record<number, GitRepoErrorCode>>

const COMMON_STATUS: StatusMap = { 401: 'auth', 403: 'auth' }

abstract class GitRemoteBase implements GitRemote {
  protected readonly repoUrl: string

  constructor(
    protected readonly target: GitRepoTarget,
    protected readonly token: string,
    protected readonly fetchImpl: GitFetch,
  ) {
    this.repoUrl = repoApiUrl(target)
  }

  abstract defaultBranch(): Promise<string>
  abstract headSha(branch: string): Promise<string>
  abstract commit(input: GitCommitInput): Promise<void>
  protected abstract headers(withBody: boolean): Record<string, string>
  protected abstract tree(sha: string, recursive: boolean): Promise<{ entries: GitTreeEntry[]; truncated: boolean }>

  protected async request<T>(url: string, init?: RequestInit, statusMap: StatusMap = {}): Promise<T> {
    let response: Response
    try {
      response = await this.fetchImpl(url, { ...init, headers: this.headers(init?.body !== undefined) })
    } catch (error) {
      throw new GitRepoError('network', `Request failed: ${url}`, error)
    }
    if (!response.ok) {
      const code = statusMap[response.status] ?? COMMON_STATUS[response.status] ?? 'unknown'
      throw new GitRepoError(code, `Git API ${response.status}: ${init?.method ?? 'GET'} ${url}`)
    }
    return await response.json() as T
  }

  async readText(blobSha: string): Promise<string> {
    const blob = await this.request<{ content: string }>(`${this.repoUrl}/git/blobs/${blobSha}`, undefined, { 404: 'notFound' })
    return decodeBase64(blob.content)
  }

  async listWorkspaceFiles(headSha: string): Promise<Map<string, string>> {
    const recursive = await this.tree(headSha, true)
    const files = new Map<string, string>()
    if (!recursive.truncated) {
      for (const entry of recursive.entries) {
        if (entry.type !== 'blob' || !this.underSubdir(entry.path)) continue
        files.set(this.workspacePath(entry.path), entry.sha)
      }
      return files
    }
    // The recursive listing of very large repositories gets truncated: fall back to level-by-level requests that walk only the target subdirectory
    await this.walkTree(headSha, '', files)
    return files
  }

  protected repoPath(path: string): string {
    return this.target.subdir ? `${this.target.subdir}/${path}` : path
  }

  private underSubdir(path: string): boolean {
    const subdir = this.target.subdir
    return !subdir || path.startsWith(`${subdir}/`)
  }

  private workspacePath(path: string): string {
    const subdir = this.target.subdir
    return subdir ? path.slice(subdir.length + 1) : path
  }

  private async walkTree(sha: string, dir: string, files: Map<string, string>): Promise<void> {
    const { entries } = await this.tree(sha, false)
    for (const entry of entries) {
      // In non-recursive listings the path may be a name or a repository-relative path depending on the platform; normalize both forms to the latter
      const path = entry.path.includes('/') ? entry.path : (dir ? `${dir}/${entry.path}` : entry.path)
      if (entry.type === 'tree') {
        if (this.relevantDir(path)) await this.walkTree(entry.sha, path, files)
      } else if (entry.type === 'blob' && this.underSubdir(path)) {
        files.set(this.workspacePath(path), entry.sha)
      }
    }
  }

  private relevantDir(dir: string): boolean {
    const subdir = this.target.subdir
    if (!subdir) return true
    return dir === subdir || subdir.startsWith(`${dir}/`) || dir.startsWith(`${subdir}/`)
  }
}

class GithubRemote extends GitRemoteBase {
  protected headers(withBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.token}`,
    }
    if (withBody) headers['Content-Type'] = 'application/json'
    return headers
  }

  protected async tree(sha: string, recursive: boolean) {
    const data = await this.request<{ tree: GitTreeEntry[]; truncated?: boolean }>(
      `${this.repoUrl}/git/trees/${sha}${recursive ? '?recursive=1' : ''}`,
      undefined,
      { 404: 'notFound' },
    )
    return { entries: data.tree, truncated: data.truncated === true }
  }

  async defaultBranch(): Promise<string> {
    const repo = await this.request<{ default_branch: string }>(this.repoUrl, undefined, { 404: 'notFound' })
    return repo.default_branch
  }

  async headSha(branch: string): Promise<string> {
    const ref = await this.request<{ object: { sha: string } }>(`${this.repoUrl}/git/ref/heads/${branch}`, undefined, { 404: 'branchNotFound' })
    return ref.object.sha
  }

  async commit({ branch, headSha, message, changes }: GitCommitInput): Promise<void> {
    const head = await this.request<{ tree: { sha: string } }>(`${this.repoUrl}/git/commits/${headSha}`, undefined, { 404: 'branchNotFound' })
    const blobs = new Map<string, string>()
    for (const change of changes) {
      if (change.content === null) continue
      const blob = await this.request<{ sha: string }>(`${this.repoUrl}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: change.content, encoding: 'utf-8' }),
      })
      blobs.set(change.path, blob.sha)
    }
    const tree = await this.request<{ sha: string }>(`${this.repoUrl}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: head.tree.sha,
        tree: changes.map(change => ({
          path: this.repoPath(change.path),
          mode: '100644',
          type: 'blob',
          sha: change.content === null ? null : blobs.get(change.path),
        })),
      }),
    })
    const commit = await this.request<{ sha: string }>(`${this.repoUrl}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [headSha] }),
    })
    // force: false makes the server enforce fast-forward: it returns 422 when someone else advanced the branch, i.e. a commit conflict
    await this.request(`${this.repoUrl}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    }, { 422: 'conflict' })
  }
}

class GiteeRemote extends GitRemoteBase {
  protected headers(withBody: boolean): Record<string, string> {
    const headers: Record<string, string> = { Authorization: `token ${this.token}` }
    if (withBody) headers['Content-Type'] = 'application/json'
    return headers
  }

  protected async tree(sha: string, recursive: boolean) {
    const data = await this.request<{ tree: GitTreeEntry[]; truncated?: boolean }>(
      `${this.repoUrl}/git/trees/${sha}${recursive ? '?recursive=1' : ''}`,
      undefined,
      { 404: 'notFound' },
    )
    return { entries: data.tree, truncated: data.truncated === true }
  }

  async defaultBranch(): Promise<string> {
    const repo = await this.request<{ default_branch: string }>(this.repoUrl, undefined, { 404: 'notFound' })
    return repo.default_branch
  }

  async headSha(branch: string): Promise<string> {
    const data = await this.request<{ commit?: { sha?: string } }>(
      `${this.repoUrl}/branches/${encodeURIComponent(branch)}`,
      undefined,
      { 404: 'branchNotFound' },
    )
    const sha = data.commit?.sha
    if (!sha) throw new GitRepoError('branchNotFound', `Missing commit sha for branch: ${branch}`)
    return sha
  }

  async commit({ branch, message, changes }: GitCommitInput): Promise<void> {
    const actions = changes.map(change => change.content === null
      ? { action: 'delete', path: this.repoPath(change.path) }
      : {
          action: change.kind === 'add' ? 'create' : 'update',
          path: this.repoPath(change.path),
          content: encodeBase64(change.content),
          encoding: 'base64',
        })
    // This endpoint has no server-side conflict primitive; the writer already pre-checks the head upstream, so here we only map explicit server errors
    await this.request(`${this.repoUrl}/commits`, {
      method: 'POST',
      body: JSON.stringify({ branch, message, actions }),
    }, { 404: 'branchNotFound', 409: 'conflict', 422: 'conflict' })
  }
}

class GiteaRemote extends GitRemoteBase {
  protected headers(withBody: boolean): Record<string, string> {
    const headers: Record<string, string> = { Authorization: `token ${this.token}` }
    if (withBody) headers['Content-Type'] = 'application/json'
    return headers
  }

  protected async tree(sha: string, recursive: boolean) {
    const data = await this.request<{ tree: GitTreeEntry[]; truncated?: boolean }>(
      `${this.repoUrl}/git/trees/${sha}${recursive ? '?recursive=true' : ''}`,
      undefined,
      { 404: 'notFound' },
    )
    return { entries: data.tree, truncated: data.truncated === true }
  }

  async defaultBranch(): Promise<string> {
    const repo = await this.request<{ default_branch: string }>(this.repoUrl, undefined, { 404: 'notFound' })
    return repo.default_branch
  }

  async headSha(branch: string): Promise<string> {
    const data = await this.request<{ commit?: { id?: string; sha?: string } }>(
      `${this.repoUrl}/branches/${encodeURIComponent(branch)}`,
      undefined,
      { 404: 'branchNotFound' },
    )
    const sha = data.commit?.id ?? data.commit?.sha
    if (!sha) throw new GitRepoError('branchNotFound', `Missing commit id for branch: ${branch}`)
    return sha
  }

  async commit({ branch, message, changes }: GitCommitInput): Promise<void> {
    const files = changes.map(change => change.kind === 'delete'
      ? { operation: 'delete', path: this.repoPath(change.path), content: '', sha: change.sha }
      : {
          operation: change.kind === 'add' ? 'create' : 'update',
          path: this.repoPath(change.path),
          content: encodeBase64(change.content!),
          sha: change.sha,
        })
    // Updates/deletes carry the snapshot blob sha, so the server rejects them (409/422) once the file has been changed by someone else
    await this.request(`${this.repoUrl}/contents`, {
      method: 'POST',
      body: JSON.stringify({ branch, message, files }),
    }, { 404: 'branchNotFound', 409: 'conflict', 422: 'conflict' })
  }
}

export function createGitRemote(target: GitRepoTarget, token: string, fetchImpl?: GitFetch): GitRemote {
  const impl: GitFetch = fetchImpl ?? ((input, init) => fetch(input, init))
  switch (target.provider) {
    case 'github': return new GithubRemote(target, token, impl)
    case 'gitee': return new GiteeRemote(target, token, impl)
    case 'gitea': return new GiteaRemote(target, token, impl)
  }
}
