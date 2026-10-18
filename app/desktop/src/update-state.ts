import type { DesktopUpdateStatus } from 'schema-editor-bridge'

/** Update flow events: fed in after normalization by electron-updater callbacks */
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
 * Advance the update status according to events.
 *
 * Progress events only apply while downloading and are clamped to an integer in 0-100; unchanged values
 * return the previous object so callers can skip duplicate pushes by reference.
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
