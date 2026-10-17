/**
 * Git 访问令牌：默认只留在当前会话内存；用户勾选「记住令牌」时按站点写入 localStorage。
 * 明文存储是本项目的既定取舍（浏览器端无安全密钥环），因此默认不记住。
 */
const memory = new Map<string, string>()
const STORAGE_PREFIX = 'schema-editor.git-token.'

export function storeGitToken(host: string, token: string, remember: boolean) {
  memory.set(host, token)
  if (typeof localStorage === 'undefined') return
  if (remember) localStorage.setItem(STORAGE_PREFIX + host, token)
  else localStorage.removeItem(STORAGE_PREFIX + host)
}

/** 会话内存 → localStorage 依次回退；未登录过该站点时返回空串 */
export function readGitToken(host: string): string {
  const cached = memory.get(host)
  if (cached !== undefined) return cached
  return readStoredGitToken(host) ?? ''
}

/** 仅供「打开 Git 仓库」弹窗预填：只读已勾选记住的令牌 */
export function readStoredGitToken(host: string): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(STORAGE_PREFIX + host)
}
