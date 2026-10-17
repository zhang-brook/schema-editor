import type { StagedChange } from '../save-coordinator'

export type GitProviderKind = 'github' | 'gitee' | 'gitea'

export interface GitRepoTarget {
  provider: GitProviderKind
  /** 站点源（含协议与端口），如 https://gitee.com / http://git.internal:3000 */
  origin: string
  /** 站点主机（含端口），作为凭据键 */
  host: string
  owner: string
  repo: string
  /** 空串表示使用默认分支 */
  branch: string
  /** 工作区在仓库中的子目录；空串表示仓库根目录 */
  subdir: string
  /** 自建 Gitea 的站点子路径（https://example.com/gitea/owner/repo 中的 gitea） */
  prefix: string
}

export interface GitRepoInfo extends GitRepoTarget {
  /** 连接后已解析为实际分支名 */
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

/** 待提交的文件差异（含内容与远端当前 blob sha） */
export interface GitFileChange extends StagedChange {
  content: string | null
  sha?: string
}
