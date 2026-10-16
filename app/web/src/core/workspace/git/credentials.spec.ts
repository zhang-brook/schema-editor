import { afterEach, describe, expect, it, vi } from 'vitest'
import { readGitToken, readStoredGitToken, storeGitToken } from './credentials'

function fakeStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('git credentials', () => {
  it('keeps the token in session memory by default', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    storeGitToken('gitee.com', 'secret', false)
    expect(readGitToken('gitee.com')).toBe('secret')
    expect(readStoredGitToken('gitee.com')).toBeNull()
  })

  it('persists the token only while the user asks to remember it', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    storeGitToken('github.com', 'secret-1', true)
    expect(readStoredGitToken('github.com')).toBe('secret-1')

    storeGitToken('github.com', 'secret-2', false)
    expect(readStoredGitToken('github.com')).toBeNull()
    expect(readGitToken('github.com')).toBe('secret-2')
  })

  it('falls back to the stored token when the session has none', () => {
    const storage = fakeStorage()
    storage.setItem('schema-editor.git-token.git.internal', 'stored-token')
    vi.stubGlobal('localStorage', storage)
    expect(readGitToken('git.internal')).toBe('stored-token')
  })

  it('degrades gracefully when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined)
    storeGitToken('gitea.com', 'memory-only', true)
    expect(readGitToken('gitea.com')).toBe('memory-only')
    expect(readStoredGitToken('gitea.com')).toBeNull()
  })

  it('returns an empty token for unknown hosts', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    expect(readGitToken('never-seen.example')).toBe('')
    expect(readStoredGitToken('never-seen.example')).toBeNull()
  })
})
