import type { StagedChange } from '../save-coordinator'

export type GitProviderKind = 'github' | 'gitee' | 'gitea'

export interface GitRepoTarget {
  provider: GitProviderKind
  /** Site origin (including protocol and port), e.g. https://gitee.com / http://git.internal:3000 */
  origin: string
  /** Site host (including port), used as the credentials key */
  host: string
  owner: string
  repo: string
  /** An empty string means the default branch is used */
  branch: string
  /** Subdirectory of the repository used as the workspace; an empty string means the repository root */
  subdir: string
  /** Site sub-path of a self-hosted Gitea (the gitea in https://example.com/gitea/owner/repo) */
  prefix: string
}

export interface GitRepoInfo extends GitRepoTarget {
  /** Resolved to the actual branch name after connecting */
  branch: string
  webUrl: string
}

export type GitRepoErrorCode =
  | 'invalidUrl'
  | 'notFound'
  | 'branchNotFound'
  | 'auth'
  | 'notProject'
  | 'network'
  | 'conflict'
  | 'unknown'

export class GitRepoError extends Error {
  constructor(readonly code: GitRepoErrorCode, message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'GitRepoError'
  }
}

/** Pending file change to commit (content plus the current remote blob sha) */
export interface GitFileChange extends StagedChange {
  content: string | null
  sha?: string
}
