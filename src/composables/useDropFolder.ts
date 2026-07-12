import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'

/**
 * 文件夹拖拽打开 composable
 *
 * 返回 dragOver 响应式状态和四个拖拽事件处理器，
 * 在 App.vue 的根容器上绑定即可启用拖入文件夹直接打开项目的功能。
 */
export function useDropFolder() {
  const store = useEditorStore()
  const { t } = useI18n()

  const dragOver = ref(false)
  let dragOverCounter = 0

  /**
   * 判断是否为外部文件/文件夹拖拽（来自操作系统）。
   *
   * 注意：不能仅依赖 getAsFileSystemHandle 是否存在来做判断——在 Chromium 中，
   * 该方法存在于每一个 DataTransferItem 上（对非文件项返回 null），因此内部
   * 元素的排序拖拽也会被误判为文件夹拖拽，从而错误地弹出遮罩层。
   *
   * 可靠的区分方式是检查 dataTransfer.types 是否包含 'Files'：
   * 操作系统拖入文件/文件夹时该值一定存在，而内部排序拖拽（draggable 元素）
   * 不会带有 'Files' 类型。
   */
  function isExternalFileDrag(e: DragEvent): boolean {
    return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
  }

  function onDragOver(e: DragEvent) {
    if (!isExternalFileDrag(e)) return
    e.preventDefault()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  function onDragEnter(e: DragEvent) {
    e.preventDefault()
    // 两个条件同时满足才显示覆盖层：
    //   1) 是外部文件/文件夹拖拽（避免内部排序拖拽误触发遮罩层）
    //   2) 浏览器支持 getAsFileSystemHandle（否则即使显示也无法打开文件夹）
    if (!isExternalFileDrag(e)) return
    const item = e.dataTransfer?.items[0]
    if (!item || typeof (item as any).getAsFileSystemHandle !== 'function') return
    dragOverCounter++
    if (dragOverCounter === 1) {
      dragOver.value = true
    }
  }

  function onDragLeave(e: DragEvent) {
    e.preventDefault()
    dragOverCounter--
    if (dragOverCounter <= 0) {
      dragOverCounter = 0
      dragOver.value = false
    }
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault()
    dragOver.value = false
    dragOverCounter = 0

    // 忽略内部排序拖拽，仅处理外部文件/文件夹拖拽
    if (!isExternalFileDrag(e)) return

    const items = e.dataTransfer?.items
    if (!items?.length) return

    const item = items[0]
    if (!item || typeof (item as any).getAsFileSystemHandle !== 'function') {
      store.showToast(t('toast.dropNotSupported'))
      return
    }

    try {
      const handle = await (item as any).getAsFileSystemHandle() as FileSystemHandle | null
      if (!handle) return

      if (handle.kind !== 'directory') {
        store.showToast(t('toast.dropFolderOnly'))
        return
      }

      // 如果已有项目打开，先关闭再打开新项目
      if (store.projectOpened) {
        store.closeProject()
      }

      await store.openProjectFromHandle(handle as FileSystemDirectoryHandle)
    } catch (err) {
      console.error('[useDropFolder] Failed to open dropped folder:', err)
      store.showToast(t('toast.dropNotSupported'))
    }
  }

  return { dragOver, onDragOver, onDragEnter, onDragLeave, onDrop }
}
