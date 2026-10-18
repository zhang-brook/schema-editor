import type { DesktopUpdateStatus } from 'schema-editor-bridge'
import { initialStatus, reduceUpdateStatus, type UpdateEvent } from './update-state'

/**
 * 更新器依赖的外部能力：由主进程用 electron-updater 适配，
 * 状态推进逻辑与之解耦以便单独测试。
 */
export interface UpdaterHost {
  /** 打包运行才有更新源，开发模式为 false */
  readonly updateSupported: boolean
  readonly currentVersion: string
  checkForUpdates(): Promise<unknown>
  quitAndInstall(): void
  onUpdateAvailable(listener: (version: string) => void): void
  onUpdateNotAvailable(listener: () => void): void
  onDownloadProgress(listener: (percent: number) => void): void
  onDownloaded(listener: (version: string) => void): void
  onError(listener: (error: unknown) => void): void
}

export interface DesktopUpdater {
  status(): DesktopUpdateStatus
  check(): Promise<DesktopUpdateStatus>
  install(): Promise<void>
  /** 已请求退出安装，渲染进程的离开保护需要放行 */
  isInstalling(): boolean
}

/** 创建更新状态机；状态变化通过 publish 推给渲染端 */
export function createUpdater(
  host: UpdaterHost,
  publish: (status: DesktopUpdateStatus) => void,
): DesktopUpdater {
  let status = initialStatus(host.currentVersion, host.updateSupported)
  let installing = false

  const currentState = () => status.state

  function apply(event: UpdateEvent): void {
    const next = reduceUpdateStatus(status, event)
    if (next === status) return
    status = next
    publish(status)
  }

  host.onUpdateAvailable(version => apply({ type: 'available', version }))
  host.onUpdateNotAvailable(() => apply({ type: 'up-to-date' }))
  host.onDownloadProgress(percent => apply({ type: 'progress', percent }))
  host.onDownloaded(version => apply({ type: 'downloaded', version }))
  host.onError(() => apply({ type: 'failed' }))

  async function check(): Promise<DesktopUpdateStatus> {
    if (!host.updateSupported || currentState() === 'checking') return status
    apply({ type: 'checking' })
    try {
      await host.checkForUpdates()
      // 事件缺失时按「已检查完」收尾，避免界面停在检查中
      if (currentState() === 'checking') apply({ type: 'up-to-date' })
    } catch {
      apply({ type: 'failed' })
    }
    return status
  }

  async function install(): Promise<void> {
    if (currentState() !== 'ready' || installing) return
    installing = true
    host.quitAndInstall()
  }

  return {
    status: () => status,
    check,
    install,
    isInstalling: () => installing,
  }
}
