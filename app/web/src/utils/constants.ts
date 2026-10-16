/** GitHub 仓库地址 */
export const GITHUB_REPO_URL = 'https://github.com/zhang-brook/schema-editor'

/** 报告问题的 GitHub Issue 新建页 */
export const GITHUB_ISSUE_URL = `${GITHUB_REPO_URL}/issues/new`

/** 更新日志地址，带版本锚点定位到对应小节（GitHub 锚点会去掉点号，如 v0.3.3 → #v033） */
export function changelogUrl(version: string): string {
  return `${GITHUB_REPO_URL}/blob/main/CHANGELOG.md#v${version.replace(/\./g, '').toLowerCase()}`
}
