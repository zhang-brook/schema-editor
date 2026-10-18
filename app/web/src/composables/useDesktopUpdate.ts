import { computed, ref } from 'vue'
import type { DesktopBridge, DesktopUpdateStatus } from 'schema-editor-bridge'

/**
 * 桌面外壳的在线更新状态。
 *
 * 只在打包后的桌面端可用；网页版与开发模式下主进程返回 unsupported，
 * 由调用方据此隐藏入口。
 */
const status = ref<DesktopUpdateStatus | null>(null)
let subscribed = false

function getBridge(): DesktopBridge | null {
  return window.schemaEditorDesktop ?? null
}

/** 订阅主进程推送的更新状态，并同步一次当前值 */
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

/** 更新状态的界面文案；`idle` 与 `unsupported` 不显示文字 */
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
