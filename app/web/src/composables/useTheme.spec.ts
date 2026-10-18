import { describe, it, expect } from 'vitest'
import { normalizePreference, resolveTheme } from './useTheme'

describe('theme preference', () => {
  it('system follows the system light/dark mode', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('light / dark are fixed and unaffected by the system', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('invalid preference values fall back to system', () => {
    expect(normalizePreference('sepia')).toBe('system')
    expect(normalizePreference(undefined)).toBe('system')
    expect(normalizePreference(null)).toBe('system')
    expect(normalizePreference('dark')).toBe('dark')
    expect(normalizePreference('light')).toBe('light')
  })
})
