/**
 * Git access tokens: kept in current-session memory by default; only written to localStorage per site when the user opts into "remember token".
 * Plaintext storage is a deliberate trade-off of this project (browsers have no secure keychain), so tokens are not remembered by default.
 */
const memory = new Map<string, string>()
const STORAGE_PREFIX = 'schema-editor.git-token.'

export function storeGitToken(host: string, token: string, remember: boolean) {
  memory.set(host, token)
  if (typeof localStorage === 'undefined') return
  if (remember) localStorage.setItem(STORAGE_PREFIX + host, token)
  else localStorage.removeItem(STORAGE_PREFIX + host)
}

/** Falls back from session memory to localStorage in order; returns an empty string when the site was never signed in */
export function readGitToken(host: string): string {
  const cached = memory.get(host)
  if (cached !== undefined) return cached
  return readStoredGitToken(host) ?? ''
}

/** Only for pre-filling the "Open Git repository" dialog: reads only tokens the user chose to remember */
export function readStoredGitToken(host: string): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(STORAGE_PREFIX + host)
}
