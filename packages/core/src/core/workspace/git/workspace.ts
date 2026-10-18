import type { FileChange, SaveResult, StagedChange } from '../save-coordinator'
import type { SessionWriter } from '../workspace-session'
import { GitRepoError, type GitFileChange, type GitRepoInfo, type GitRepoTarget } from './types'
import { createGitRemote, type GitFetch, type GitRemote } from './providers'
import { repoWebUrl } from './url'

const FALLBACK_COMMIT_MESSAGE = 'Update schema project'

/**
 * Writer that uses a Git repository branch as its data source.
 * Real-time saving is not supported (supportsAutoSave=false; the coordinator force-disables both auto-save toggles),
 * so every manual save is "one commit": only files that differ from the loaded snapshot are committed.
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

  /** Snapshot validation only trusts the branch head: any push by someone else invalidates the whole snapshot */
  async hasExternalChanges(_paths: readonly string[]): Promise<boolean> {
    return await this.remote.headSha(this.info.branch) !== this.headSha
  }

  /** Commit preview: converts the file set produced by saving into the real diff against the remote snapshot */
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

/** Connects to the repository: resolve the default branch -> read the branch head commit -> build the subdirectory file snapshot */
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
