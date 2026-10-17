import type { FileChange, SaveResult, StagedChange } from '../save-coordinator'
import type { SessionWriter } from '../workspace-session'
import { GitRepoError, type GitFileChange, type GitRepoInfo, type GitRepoTarget } from './types'
import { createGitRemote, type GitFetch, type GitRemote } from './providers'
import { repoWebUrl } from './url'

const FALLBACK_COMMIT_MESSAGE = 'Update schema project'

/**
 * 以 Git 仓库分支为数据源的写入器。
 * 不支持实时保存（supportsAutoSave=false，协调器会强制关闭两个自动保存开关），
 * 每次手动保存都是「一次提交」：只提交与载入快照存在差异的文件。
 */
export class GitWorkspaceWriter implements SessionWriter {
  readonly supportsAutoSave = false
  private headSha: string
  private snapshot: Map<string, string>
  private readonly contents = new Map<string, string>()
  private message: string | null = null

  constructor(
    readonly remote: GitRemote,
    readonly info: GitRepoInfo,
    headSha: string,
    snapshot: Map<string, string>,
  ) {
    this.headSha = headSha
    this.snapshot = snapshot
  }

  setCommitMessage(message: string) {
    this.message = message
  }

  async load(paths: readonly string[]): Promise<Map<string, string>> {
    const files = new Map<string, string>()
    await Promise.all(paths.map(async path => {
      const sha = this.snapshot.get(path)
      if (sha === undefined) return
      const content = await this.remote.readText(sha)
      this.contents.set(path, content)
      files.set(path, content)
    }))
    return files
  }

  async listFiles(directory: string): Promise<string[]> {
    const prefix = `${directory}/`
    return [...this.snapshot.keys()].filter(path => path.startsWith(prefix))
  }

  /** 快照校验只认分支头：任何他人推送都会使整个快照失效 */
  async hasExternalChanges(_paths: readonly string[]): Promise<boolean> {
    return await this.remote.headSha(this.info.branch) !== this.headSha
  }

  /** 提交预览：把保存口径的文件集合换算为相对远端快照的真实差异 */
  previewCommit(changes: readonly FileChange[]): StagedChange[] {
    return this.plan(changes).map(({ path, kind }) => ({ path, kind }))
  }

  async save(changes: readonly FileChange[]): Promise<SaveResult> {
    try {
      const plan = this.plan(changes)
      if (plan.length > 0) {
        const head = await this.remote.headSha(this.info.branch)
        if (head !== this.headSha) {
          throw new GitRepoError('conflict', 'Branch head moved away from the loaded snapshot')
        }
        await this.remote.commit({
          branch: this.info.branch,
          headSha: this.headSha,
          message: this.message ?? FALLBACK_COMMIT_MESSAGE,
          changes: plan,
        })
        for (const change of plan) {
          if (change.content === null) this.contents.delete(change.path)
          else this.contents.set(change.path, change.content)
        }
        await this.refresh()
      }
      return { savedPaths: changes.map(change => change.path) }
    } catch (error) {
      return { savedPaths: [], error }
    }
  }

  private async refresh() {
    this.headSha = await this.remote.headSha(this.info.branch)
    this.snapshot = await this.remote.listWorkspaceFiles(this.headSha)
  }

  private plan(changes: readonly FileChange[]): GitFileChange[] {
    const plan: GitFileChange[] = []
    for (const change of changes) {
      const sha = this.snapshot.get(change.path)
      if (change.content === null) {
        if (sha !== undefined) plan.push({ path: change.path, kind: 'delete', content: null, sha })
        continue
      }
      if (sha === undefined) plan.push({ path: change.path, kind: 'add', content: change.content })
      else if (this.contents.get(change.path) !== change.content) plan.push({ path: change.path, kind: 'update', content: change.content, sha })
    }
    return plan
  }
}

/** 连接仓库：解析默认分支 → 取分支头提交 → 建立子目录文件快照 */
export async function connectGitWorkspace(
  target: GitRepoTarget,
  token: string,
  fetchImpl?: GitFetch,
): Promise<{ writer: GitWorkspaceWriter; info: GitRepoInfo }> {
  const remote = createGitRemote(target, token, fetchImpl)
  const branch = target.branch || await remote.defaultBranch()
  const headSha = await remote.headSha(branch)
  const snapshot = await remote.listWorkspaceFiles(headSha)
  const info: GitRepoInfo = { ...target, branch, webUrl: repoWebUrl(target) }
  return { writer: new GitWorkspaceWriter(remote, info, headSha, snapshot), info }
}
