import type { DesktopUpdateStatus } from 'schema-editor-bridge'
import { initialStatus, reduceUpdateStatus, type UpdateEvent } from './update-state'

/**
 * External capabilities the updater depends on: adapted by the main process with electron-updater.
 * The state advancing logic is decoupled from them so it can be tested on its own.
 */
export interface UpdaterHost {
  /** Only packaged builds have an update source; false in dev mode */
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
  /** Quit-and-install has been requested; the renderer leave guard must allow unload */
  isInstalling(): boolean
}

/** Create the update state machine; state changes are pushed to the renderer via publish */
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
      // If events are missing, finish as up-to-date so the UI does not stay in checking
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
