import { describe, it, expect } from 'vitest'
import { normalizeDensity } from './useDensity'

describe('UI density preference', () => {
  it('keeps the three density levels unchanged', () => {
    expect(normalizeDensity('compact')).toBe('compact')
    expect(normalizeDensity('normal')).toBe('normal')
    expect(normalizeDensity('relaxed')).toBe('relaxed')
  })

  it('invalid preference values fall back to normal', () => {
    expect(normalizeDensity('dense')).toBe('normal')
    expect(normalizeDensity(undefined)).toBe('normal')
    expect(normalizeDensity(null)).toBe('normal')
    expect(normalizeDensity(2)).toBe('normal')
  })
})
