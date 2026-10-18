import type { DesktopUpdateStatus } from 'schema-editor-bridge'

/** 更新流程事件：由 electron-updater 的回调归一化后喂入 */
export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'up-to-date' }
  | { type: 'available'; version: string }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'failed' }

export function initialStatus(currentVersion: string, supported: boolean): DesktopUpdateStatus {
  return { state: supported ? 'idle' : 'unsupported', currentVersion }
}

/**
 * 按事件推进更新状态。
 *
 * 进度事件只在下发过程中生效并夹到 0-100 的整数，数值未变时返回原对象，
 * 便于调用方按引用跳过重复推送。
 */
export function reduceUpdateStatus(prev: DesktopUpdateStatus, event: UpdateEvent): DesktopUpdateStatus {
  switch (event.type) {
    case 'checking':
      return { state: 'checking', currentVersion: prev.currentVersion }
    case 'up-to-date':
      return prev.state === 'up-to-date'
        ? prev
        : { state: 'up-to-date', currentVersion: prev.currentVersion }
    case 'available':
      return {
        state: 'downloading',
        currentVersion: prev.currentVersion,
        availableVersion: event.version,
        percent: 0,
      }
    case 'progress': {
      if (prev.state !== 'downloading') return prev
      const percent = Math.min(100, Math.max(0, Math.floor(event.percent)))
      return percent === prev.percent ? prev : { ...prev, percent }
    }
    case 'downloaded':
      return {
        state: 'ready',
        currentVersion: prev.currentVersion,
        availableVersion: event.version,
      }
    case 'failed':
      return prev.state === 'failed'
        ? prev
        : { state: 'failed', currentVersion: prev.currentVersion }
  }
}
