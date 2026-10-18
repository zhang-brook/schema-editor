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
  it('shows no text when not checked or updates are unsupported', () => {
    expect(updateStatusLabel(null, translate)).toBe('')
    expect(label('idle')).toBe('')
    expect(label('unsupported')).toBe('')
  })

  it('maps checking, up-to-date and failed states respectively', () => {
    expect(label('checking')).toBe('about.update.checking')
    expect(label('up-to-date')).toBe('about.update.upToDate')
    expect(label('failed')).toBe('about.update.failed')
  })

  it('downloading includes version and percentage, falling back to 0 when missing', () => {
    expect(label('downloading', { availableVersion: '0.9.0', percent: 45 })).toBe(
      'about.update.downloading|{"version":"0.9.0","percent":45}',
    )
    expect(label('downloading', { availableVersion: '0.9.0' })).toBe(
      'about.update.downloading|{"version":"0.9.0","percent":0}',
    )
  })

  it('ready includes the version number', () => {
    expect(label('ready', { availableVersion: '0.9.0' })).toBe('about.update.ready|{"version":"0.9.0"}')
  })
})
