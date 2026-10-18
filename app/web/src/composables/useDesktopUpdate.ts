import { computed, ref } from 'vue'
import type { DesktopBridge, DesktopUpdateStatus } from 'schema-editor-bridge'

/**
 * Online update status of the desktop shell.
 *
 * Only available in the packaged desktop app; the web version and dev mode get unsupported from the main process,
 * which callers use to hide the entry point.
 */
const status = ref<DesktopUpdateStatus | null>(null)
let subscribed = false

function getBridge(): DesktopBridge | null {
  return window.schemaEditorDesktop ?? null
}

/** Subscribes to update status pushed by the main process and syncs the current value once */
function subscribe() {
  const api = getBridge()
  if (!api || subscribed) return
  subscribed = true
  api.setUpdateHandler(next => {
    status.value = next
  })
  void api.getUpdateStatus().then(current => {
    status.value = current
  })
}

export async function checkUpdate(): Promise<void> {
  const api = getBridge()
  if (!api) return
  status.value = await api.checkUpdate()
}

export async function installUpdate(): Promise<void> {
  await getBridge()?.installUpdate()
}

/** UI text for the update status; `idle` and `unsupported` show no text */
export function updateStatusLabel(
  status: DesktopUpdateStatus | null,
  translate: (key: string, params?: Record<string, string | number>) => string,
): string {
  switch (status?.state) {
    case 'checking':
      return translate('about.update.checking')
    case 'up-to-date':
      return translate('about.update.upToDate')
    case 'downloading':
      return translate('about.update.downloading', {
        version: status.availableVersion ?? '',
        percent: status.percent ?? 0,
      })
    case 'ready':
      return translate('about.update.ready', { version: status.availableVersion ?? '' })
    case 'failed':
      return translate('about.update.failed')
    default:
      return ''
  }
}

export function useDesktopUpdate() {
  subscribe()
  const supported = computed(() => status.value !== null && status.value.state !== 'unsupported')
  return { status, supported, checkUpdate, installUpdate }
}
