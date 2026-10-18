import { describe, it, expect, afterEach, vi } from 'vitest'
import { useColumnResize } from './useColumnResize'

const COLUMNS = [
  { key: 'name', min: 100, defaultWidth: 140 },
  { key: 'comment', min: 120, defaultWidth: 180 },
]

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  })
  return store
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('column width persistence', () => {
  it('uses default widths when no storage record exists', () => {
    stubStorage()
    const { widthStyle } = useColumnResize('test.cols', COLUMNS)
    expect(widthStyle('name')).toEqual({ width: '140px' })
    expect(widthStyle('comment')).toEqual({ width: '180px' })
    expect(widthStyle('unknown')).toBeUndefined()
  })

  it('valid stored widths override defaults (rounded)', () => {
    stubStorage({ 'test.cols': JSON.stringify({ name: 200.4 }) })
    const { widthStyle } = useColumnResize('test.cols', COLUMNS)
    expect(widthStyle('name')).toEqual({ width: '200px' })
    expect(widthStyle('comment')).toEqual({ width: '180px' })
  })

  it('invalid values fall back to defaults and values below the minimum are clamped', () => {
    stubStorage({ 'test.cols': JSON.stringify({ name: 'abc', comment: -50 }) })
    const { widthStyle } = useColumnResize('test.cols', COLUMNS)
    expect(widthStyle('name')).toEqual({ width: '140px' })
    expect(widthStyle('comment')).toEqual({ width: '120px' })
  })

  it('falls back to default widths when stored content is corrupt', () => {
    stubStorage({ 'test.cols': '{oops' })
    const { widthStyle } = useColumnResize('test.cols', COLUMNS)
    expect(widthStyle('name')).toEqual({ width: '140px' })
  })
})
