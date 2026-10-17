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

describe('列宽持久化', () => {
  it('无存储记录时使用默认宽度', () => {
    stubStorage()
    const { widthStyle } = useColumnResize('test.cols', COLUMNS)
    expect(widthStyle('name')).toEqual({ width: '140px' })
    expect(widthStyle('comment')).toEqual({ width: '180px' })
    expect(widthStyle('unknown')).toBeUndefined()
  })

  it('存储中的有效宽度覆盖默认值（取整）', () => {
    stubStorage({ 'test.cols': JSON.stringify({ name: 200.4 }) })
    const { widthStyle } = useColumnResize('test.cols', COLUMNS)
    expect(widthStyle('name')).toEqual({ width: '200px' })
    expect(widthStyle('comment')).toEqual({ width: '180px' })
  })

  it('非法值回退默认值，小于下限的值收敛到下限', () => {
    stubStorage({ 'test.cols': JSON.stringify({ name: 'abc', comment: -50 }) })
    const { widthStyle } = useColumnResize('test.cols', COLUMNS)
    expect(widthStyle('name')).toEqual({ width: '140px' })
    expect(widthStyle('comment')).toEqual({ width: '120px' })
  })

  it('存储内容损坏时回退默认宽度', () => {
    stubStorage({ 'test.cols': '{oops' })
    const { widthStyle } = useColumnResize('test.cols', COLUMNS)
    expect(widthStyle('name')).toEqual({ width: '140px' })
  })
})
