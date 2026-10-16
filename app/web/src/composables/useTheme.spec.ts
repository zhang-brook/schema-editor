import { describe, it, expect } from 'vitest'
import { normalizePreference, resolveTheme } from './useTheme'

describe('主题偏好', () => {
  it('system 跟随系统深浅色', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('light / dark 固定，不受系统影响', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('非法偏好值回退 system', () => {
    expect(normalizePreference('sepia')).toBe('system')
    expect(normalizePreference(undefined)).toBe('system')
    expect(normalizePreference(null)).toBe('system')
    expect(normalizePreference('dark')).toBe('dark')
    expect(normalizePreference('light')).toBe('light')
  })
})
