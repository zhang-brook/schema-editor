import { watch, onUnmounted, type Ref } from 'vue'

/**
 * Dialog ESC-to-close composable
 *
 * Watches the dialog visibility state and binds a document keydown event while visible, triggering the close callback on ESC;
 * removes the listener when hidden and cleans up automatically when the component unmounts.
 *
 * @param showFlag Ref of the dialog visibility (ref / computed / toRef all work)
 * @param onClose  Close callback invoked when ESC is pressed
 *
 * @example
 * // Call directly inside the dialog component
 * useEscClose(computed(() => store.showSomeModal), () => { store.showSomeModal = false })
 * useEscClose(computed(() => props.visible), () => emit('close'))
 */
export function useEscClose(showFlag: Ref<boolean>, onClose: () => void) {
  function escHandler(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose()
    }
  }

  watch(showFlag, (show) => {
    if (show) {
      document.addEventListener('keydown', escHandler)
    } else {
      document.removeEventListener('keydown', escHandler)
    }
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', escHandler)
  })
}
