import { describe, it, expect } from 'vitest'
import { normalizeDensity } from './useDensity'

describe('界面密度偏好', () => {
  it('三档密度原样保留', () => {
    expect(normalizeDensity('compact')).toBe('compact')
    expect(normalizeDensity('normal')).toBe('normal')
    expect(normalizeDensity('relaxed')).toBe('relaxed')
  })

  it('非法偏好值回退 normal', () => {
    expect(normalizeDensity('dense')).toBe('normal')
    expect(normalizeDensity(undefined)).toBe('normal')
    expect(normalizeDensity(null)).toBe('normal')
    expect(normalizeDensity(2)).toBe('normal')
  })
})
