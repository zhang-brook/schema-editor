import { ref } from 'vue'
import type { DesktopBridge } from 'schema-editor-bridge'
import { i18n } from '@/i18n'
import { DesktopDirectoryHandle } from '@/platform/desktop-fsa'
import { useEditorStore } from '@/stores/editor'

/** 桌面端最近打开的项目文件夹，最新在前 */
const recentFolders = ref<string[]>([])
let loaded = false

function getBridge(): DesktopBridge | null {
  return window.schemaEditorDesktop ?? null
}

/** 列表取文件夹名用作菜单标题，完整路径放在副标题 */
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
