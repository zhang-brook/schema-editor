import { describe, expect, it } from 'vitest'
import type { DesktopUpdateStatus } from 'schema-editor-bridge'
import { initialStatus, reduceUpdateStatus } from './update-state'

const base: DesktopUpdateStatus = { state: 'checking', currentVersion: '0.8.0' }

describe('initialStatus', () => {
  it('打包运行等待手动检查，未打包直接标记不支持', () => {
    expect(initialStatus('0.8.0', true)).toEqual({ state: 'idle', currentVersion: '0.8.0' })
    expect(initialStatus('0.8.0', false)).toEqual({ state: 'unsupported', currentVersion: '0.8.0' })
  })
})

describe('reduceUpdateStatus', () => {
  it('重复的终态事件不再产生新状态', () => {
    const upToDate = reduceUpdateStatus(base, { type: 'up-to-date' })
    expect(reduceUpdateStatus(upToDate, { type: 'up-to-date' })).toBe(upToDate)
    const failed = reduceUpdateStatus(base, { type: 'failed' })
    expect(reduceUpdateStatus(failed, { type: 'failed' })).toBe(failed)
  })

  it('重新检查时清掉上一轮的版本与进度', () => {
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

  it('没有新版本时只保留当前版本', () => {
    expect(reduceUpdateStatus(base, { type: 'up-to-date' })).toEqual({
      state: 'up-to-date',
      currentVersion: '0.8.0',
    })
  })

  it('发现新版本直接进入下载中并置 0% 起点', () => {
    expect(reduceUpdateStatus(base, { type: 'available', version: '0.9.0' })).toEqual({
      state: 'downloading',
      currentVersion: '0.8.0',
      availableVersion: '0.9.0',
      percent: 0,
    })
  })

  it('进度向下取整并夹在 0-100', () => {
    const downloading = reduceUpdateStatus(base, { type: 'available', version: '0.9.0' })
    expect(reduceUpdateStatus(downloading, { type: 'progress', percent: 33.9 }).percent).toBe(33)
    expect(reduceUpdateStatus(downloading, { type: 'progress', percent: -5 }).percent).toBe(0)
    expect(reduceUpdateStatus(downloading, { type: 'progress', percent: 128 }).percent).toBe(100)
  })

  it('进度未变化时返回原对象，避免重复推送', () => {
    const downloading = reduceUpdateStatus(base, { type: 'available', version: '0.9.0' })
    const half = reduceUpdateStatus(downloading, { type: 'progress', percent: 50 })
    expect(reduceUpdateStatus(half, { type: 'progress', percent: 50.4 })).toBe(half)
  })

  it('非下载中的进度事件被忽略', () => {
    expect(reduceUpdateStatus(base, { type: 'progress', percent: 60 })).toBe(base)
    const ready = reduceUpdateStatus(base, { type: 'downloaded', version: '0.9.0' })
    expect(reduceUpdateStatus(ready, { type: 'progress', percent: 10 })).toBe(ready)
  })

  it('下载完成进入待安装状态并记住新版本', () => {
    expect(reduceUpdateStatus(base, { type: 'downloaded', version: '0.9.0' })).toEqual({
      state: 'ready',
      currentVersion: '0.8.0',
      availableVersion: '0.9.0',
    })
  })

  it('失败回到可重试状态且不带远端信息', () => {
    const downloading = reduceUpdateStatus(base, { type: 'available', version: '0.9.0' })
    for (const prev of [base, downloading]) {
      expect(reduceUpdateStatus(prev, { type: 'failed' })).toEqual({
        state: 'failed',
        currentVersion: '0.8.0',
      })
    }
  })
})
