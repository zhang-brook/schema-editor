import { describe, expect, it } from 'vitest'
import type { DesktopUpdateStatus } from 'schema-editor-bridge'
import { initialStatus, reduceUpdateStatus } from './update-state'

const base: DesktopUpdateStatus = { state: 'checking', currentVersion: '0.8.0' }

describe('initialStatus', () => {
  it('packaged builds wait for a manual check; unpackaged builds are marked unsupported', () => {
    expect(initialStatus('0.8.0', true)).toEqual({ state: 'idle', currentVersion: '0.8.0' })
    expect(initialStatus('0.8.0', false)).toEqual({ state: 'unsupported', currentVersion: '0.8.0' })
  })
})

describe('reduceUpdateStatus', () => {
  it('repeated terminal events do not produce a new state', () => {
    const upToDate = reduceUpdateStatus(base, { type: 'up-to-date' })
    expect(reduceUpdateStatus(upToDate, { type: 'up-to-date' })).toBe(upToDate)
    const failed = reduceUpdateStatus(base, { type: 'failed' })
    expect(reduceUpdateStatus(failed, { type: 'failed' })).toBe(failed)
  })

  it('re-checking clears the previous version and progress', () => {
    const downloading: DesktopUpdateStatus = {
      state: 'downloading',
      currentVersion: '0.8.0',
      availableVersion: '0.9.0',
      percent: 42,
    }
    expect(reduceUpdateStatus(downloading, { type: 'checking' })).toEqual({
      state: 'checking',
      currentVersion: '0.8.0',
    })
  })

  it('keeps only the current version when no update is available', () => {
    expect(reduceUpdateStatus(base, { type: 'up-to-date' })).toEqual({
      state: 'up-to-date',
      currentVersion: '0.8.0',
    })
  })

  it('moves straight to downloading at 0% when an update is found', () => {
    expect(reduceUpdateStatus(base, { type: 'available', version: '0.9.0' })).toEqual({
      state: 'downloading',
      currentVersion: '0.8.0',
      availableVersion: '0.9.0',
      percent: 0,
    })
  })

  it('floors the progress and clamps it to 0-100', () => {
    const downloading = reduceUpdateStatus(base, { type: 'available', version: '0.9.0' })
    expect(reduceUpdateStatus(downloading, { type: 'progress', percent: 33.9 }).percent).toBe(33)
    expect(reduceUpdateStatus(downloading, { type: 'progress', percent: -5 }).percent).toBe(0)
    expect(reduceUpdateStatus(downloading, { type: 'progress', percent: 128 }).percent).toBe(100)
  })

  it('returns the previous object when progress is unchanged to avoid duplicate pushes', () => {
    const downloading = reduceUpdateStatus(base, { type: 'available', version: '0.9.0' })
    const half = reduceUpdateStatus(downloading, { type: 'progress', percent: 50 })
    expect(reduceUpdateStatus(half, { type: 'progress', percent: 50.4 })).toBe(half)
  })

  it('ignores progress events that are not in the downloading state', () => {
    expect(reduceUpdateStatus(base, { type: 'progress', percent: 60 })).toBe(base)
    const ready = reduceUpdateStatus(base, { type: 'downloaded', version: '0.9.0' })
    expect(reduceUpdateStatus(ready, { type: 'progress', percent: 10 })).toBe(ready)
  })

  it('moves to the ready state after download and remembers the new version', () => {
    expect(reduceUpdateStatus(base, { type: 'downloaded', version: '0.9.0' })).toEqual({
      state: 'ready',
      currentVersion: '0.8.0',
      availableVersion: '0.9.0',
    })
  })

  it('failure returns to a retryable state without remote info', () => {
    const downloading = reduceUpdateStatus(base, { type: 'available', version: '0.9.0' })
    for (const prev of [base, downloading]) {
      expect(reduceUpdateStatus(prev, { type: 'failed' })).toEqual({
        state: 'failed',
        currentVersion: '0.8.0',
      })
    }
  })
})
