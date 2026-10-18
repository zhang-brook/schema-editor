/** GitHub repository URL */
export const GITHUB_REPO_URL = 'https://github.com/zhang-brook/schema-editor'

/** GitHub new-issue page for reporting problems */
export const GITHUB_ISSUE_URL = `${GITHUB_REPO_URL}/issues/new`

/** Changelog URL with a version anchor pointing at the matching section (GitHub anchors drop dots, e.g. v0.3.3 → #v033) */
export function changelogUrl(version: string): string {
  return `${GITHUB_REPO_URL}/blob/main/CHANGELOG.md#v${version.replace(/\./g, '').toLowerCase()}`
}
