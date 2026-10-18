import { describe, expect, it } from 'vitest'
import type { DesktopUpdateStatus } from 'schema-editor-bridge'
import { updateStatusLabel } from './useDesktopUpdate'

function translate(key: string, params?: Record<string, string | number>) {
  return params ? `${key}|${JSON.stringify(params)}` : key
}

function label(state: DesktopUpdateStatus['state'], extra: Partial<DesktopUpdateStatus> = {}) {
  return updateStatusLabel({ state, currentVersion: '0.8.0', ...extra }, translate)
}

describe('updateStatusLabel', () => {
  it('未检查与不支持更新时不显示文字', () => {
    expect(updateStatusLabel(null, translate)).toBe('')
    expect(label('idle')).toBe('')
    expect(label('unsupported')).toBe('')
  })

  it('逐一对应检查中、已最新、失败三种状态', () => {
    expect(label('checking')).toBe('about.update.checking')
    expect(label('up-to-date')).toBe('about.update.upToDate')
    expect(label('failed')).toBe('about.update.failed')
  })

  it('下载中带出版本与百分比，缺失时回退为 0', () => {
    expect(label('downloading', { availableVersion: '0.9.0', percent: 45 })).toBe(
      'about.update.downloading|{"version":"0.9.0","percent":45}',
    )
    expect(label('downloading', { availableVersion: '0.9.0' })).toBe(
      'about.update.downloading|{"version":"0.9.0","percent":0}',
    )
  })

  it('待安装时带出版本号', () => {
    expect(label('ready', { availableVersion: '0.9.0' })).toBe('about.update.ready|{"version":"0.9.0"}')
  })
})
