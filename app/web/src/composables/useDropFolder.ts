import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'

/**
 * Folder drag-and-drop opening composable
 *
 * Returns the dragOver reactive state and four drag event handlers;
 * bind them on the root container in App.vue to enable opening a project by dropping a folder.
 */
export function useDropFolder() {
  const store = useEditorStore()
  const { t } = useI18n()

  const dragOver = ref(false)
  let dragOverCounter = 0

  /**
   * Determines whether this is an external file/folder drag (from the operating system).
   *
   * Note: do not rely solely on the presence of getAsFileSystemHandle; in Chromium,
   * this method exists on every DataTransferItem (returning null for non-file items), so
   * reordering drags of internal elements are also misidentified as folder drags, wrongly showing the overlay.
   *
   * A reliable way to distinguish them is checking whether dataTransfer.types includes 'Files':
   * it is always present when files/folders are dragged in from the OS, while internal reordering drags
   * (draggable elements) never carry the 'Files' type.
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
    // Show the overlay only when both conditions are met:
    //   1) it is an external file/folder drag (avoids the overlay being triggered by internal reordering drags)
    //   2) the browser supports getAsFileSystemHandle (otherwise the folder cannot be opened even if shown)
    if (!isExternalFileDrag(e)) return
    const item = e.dataTransfer?.items[0]
    if (!item || typeof item.getAsFileSystemHandle !== 'function') return
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

    // Ignore internal reordering drags and only handle external file/folder drags
    if (!isExternalFileDrag(e)) return

    const items = e.dataTransfer?.items
    if (!items?.length) return

    const item = items[0]
    if (!item || typeof item.getAsFileSystemHandle !== 'function') {
      store.showToast(t('toast.dropNotSupported'))
      return
    }

    try {
      const handle = await item.getAsFileSystemHandle()
      if (!handle) return

      if (handle.kind !== 'directory') {
        store.showToast(t('toast.dropFolderOnly'))
        return
      }

      // Close the existing project first (the leave-guard dialog decides whether to save/discard/cancel unsaved changes), then open the new project
      if (store.projectOpened && !(await store.requestCloseProject())) return

      await store.openProjectFromHandle(handle as FileSystemDirectoryHandle)
    } catch (err) {
      console.error('[useDropFolder] Failed to open dropped folder:', err)
      store.showToast(t('toast.dropNotSupported'))
    }
  }

  return { dragOver, onDragOver, onDragEnter, onDragLeave, onDrop }
}
