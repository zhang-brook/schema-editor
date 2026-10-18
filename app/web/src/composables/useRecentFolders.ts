import { ref } from 'vue'
import type { DesktopBridge } from 'schema-editor-bridge'
import { i18n } from '@/i18n'
import { DesktopDirectoryHandle } from '@/platform/desktop-fsa'
import { useEditorStore } from '@/stores/editor'

/** Recently opened project folders on desktop, newest first */
const recentFolders = ref<string[]>([])
let loaded = false

function getBridge(): DesktopBridge | null {
  return window.schemaEditorDesktop ?? null
}

/** Use the folder name as the menu title and the full path as the subtitle */
export function folderLabel(folder: string): string {
  return folder.split(/[\\/]/).filter(Boolean).pop() ?? folder
}

export function useRecentFolders() {
  const store = useEditorStore()
  const supported = typeof getBridge()?.listRecentFolders === 'function'

  async function refresh(): Promise<void> {
    const bridge = getBridge()
    if (!bridge) return
    recentFolders.value = await bridge.listRecentFolders()
    loaded = true
  }

  async function open(folder: string): Promise<void> {
    const bridge = getBridge()
    if (!bridge) return
    const opened = await bridge.openRecentFolder(folder)
    if (!opened) {
      recentFolders.value = await bridge.removeRecentFolder(folder)
      store.showToast(i18n.global.t('toast.recentFolderMissing'))
      return
    }
    await store.openProjectFromHandle(new DesktopDirectoryHandle(bridge, opened) as unknown as FileSystemDirectoryHandle)
    await refresh()
  }

  async function remove(folder: string): Promise<void> {
    const bridge = getBridge()
    if (!bridge) return
    recentFolders.value = await bridge.removeRecentFolder(folder)
  }

  if (supported && !loaded) void refresh()

  return { supported, recentFolders, refresh, open, remove }
}
