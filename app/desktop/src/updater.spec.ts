import { describe, expect, it } from 'vitest'
import type { DesktopUpdateStatus } from 'schema-editor-bridge'
import { createUpdater, type UpdaterHost } from './updater'

interface FakeHost extends UpdaterHost {
  checkCalls: number
  installCalls: number
  resolveCheck(): void
  rejectCheck(): void
  emitAvailable(version: string): void
  emitProgress(percent: number): void
  emitDownloaded(version: string): void
  emitError(): void
}

function createFakeHost(updateSupported = true): FakeHost {
  const listeners: {
    available: ((version: string) => void)[]
    notAvailable: (() => void)[]
    progress: ((percent: number) => void)[]
    downloaded: ((version: string) => void)[]
    error: ((error: unknown) => void)[]
  } = { available: [], notAvailable: [], progress: [], downloaded: [], error: [] }

  let resolveCheck: () => void = () => {}
  let rejectCheck: (error: Error) => void = () => {}
  const pending = new Promise<void>((resolve, reject) => {
    resolveCheck = resolve
    rejectCheck = reject
  })

  const host: FakeHost = {
    updateSupported,
    currentVersion: '0.8.0',
    checkCalls: 0,
    installCalls: 0,
    checkForUpdates() {
      host.checkCalls++
      return pending
    },
    quitAndInstall() {
      host.installCalls++
    },
    onUpdateAvailable: listener => listeners.available.push(listener),
    onUpdateNotAvailable: listener => listeners.notAvailable.push(listener),
    onDownloadProgress: listener => listeners.progress.push(listener),
    onDownloaded: listener => listeners.downloaded.push(listener),
    onError: listener => listeners.error.push(listener),
    resolveCheck: () => resolveCheck(),
    rejectCheck: () => rejectCheck(new Error('offline')),
    emitAvailable: version => listeners.available.forEach(fn => fn(version)),
    emitProgress: percent => listeners.progress.forEach(fn => fn(percent)),
    emitDownloaded: version => listeners.downloaded.forEach(fn => fn(version)),
    emitError: () => listeners.error.forEach(fn => fn(new Error('offline'))),
  }
  return host
}

function setUpdater(updateSupported = true) {
  const host = createFakeHost(updateSupported)
  const published: DesktopUpdateStatus[] = []
  const updater = createUpdater(host, status => published.push(status))
  return { host, updater, published }
}

describe('createUpdater', () => {
  it('未打包运行时不发起检查', async () => {
    const { host, updater } = setUpdater(false)
    expect(updater.status()).toEqual({ state: 'unsupported', currentVersion: '0.8.0' })
    expect(await updater.check()).toEqual({ state: 'unsupported', currentVersion: '0.8.0' })
    expect(host.checkCalls).toBe(0)
  })

  it('检查中的重复请求复用同一次网络检查', async () => {
    const { host, updater } = setUpdater()
    const first = updater.check()
    const second = updater.check()
    expect(updater.status().state).toBe('checking')
    host.resolveCheck()
    await Promise.all([first, second])
    expect(host.checkCalls).toBe(1)
    expect(updater.status().state).toBe('up-to-date')
  })

  it('有新版时依次进入下载中与待安装', async () => {
    const { host, updater, published } = setUpdater()
    const check = updater.check()
    host.emitAvailable('0.9.0')
    host.emitProgress(45.6)
    host.resolveCheck()
    expect(await check).toEqual({
      state: 'downloading',
      currentVersion: '0.8.0',
      availableVersion: '0.9.0',
      percent: 45,
    })
    host.emitDownloaded('0.9.0')
    expect(updater.status().state).toBe('ready')
    expect(published.map(item => [item.state, item.percent])).toEqual([
      ['checking', undefined],
      ['downloading', 0],
      ['downloading', 45],
      ['ready', undefined],
    ])
  })

  it('无事件时按检查完成收尾，界面不会停在检查中', async () => {
    const { host, updater } = setUpdater()
    const check = updater.check()
    host.emitProgress(80)
    host.resolveCheck()
    await check
    expect(updater.status().state).toBe('up-to-date')
  })

  it('检查失败标记为可重试且只推送一次', async () => {
    const { host, updater, published } = setUpdater()
    const check = updater.check()
    host.emitError()
    host.rejectCheck()
    expect(await check).toEqual({ state: 'failed', currentVersion: '0.8.0' })
    expect(published.filter(item => item.state === 'failed')).toHaveLength(1)
  })

  it('待安装前忽略安装请求，之后只退出一次', async () => {
    const { host, updater } = setUpdater()
    await updater.install()
    expect(host.installCalls).toBe(0)
    expect(updater.isInstalling()).toBe(false)

    const check = updater.check()
    host.emitAvailable('0.9.0')
    host.emitDownloaded('0.9.0')
    host.resolveCheck()
    await check

    await updater.install()
    await updater.install()
    expect(host.installCalls).toBe(1)
    expect(updater.isInstalling()).toBe(true)
  })
})
