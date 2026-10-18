import { watch, onUnmounted, nextTick, type Ref } from 'vue'

/**
 * Dialog Enter-to-confirm composable
 *
 * Watches the dialog visibility state and binds a window keydown event while visible, triggering the confirm callback on Enter;
 * removes the listener when hidden and cleans up automatically when the component unmounts.
 * Enter inside textareas / selects / rich text has its own semantics (newline, expanding options) and is not intercepted;
 * Enter on buttons is left to the native click; Ctrl/Cmd + Enter still confirms inside a textarea.
 * When focusEl is passed in, focus is moved into that element after the dialog is shown; otherwise, if focus stays
 * on the trigger button, Enter keeps re-triggering that button and never reaches the dialog.
 *
 * @param showFlag  Ref of the dialog visibility (ref / computed / toRef all work)
 * @param onConfirm Confirm callback invoked when Enter is pressed
 * @param focusEl   Element to focus automatically after the dialog is shown (usually the confirm button or first input)
 *
 * @example
 * const confirmBtn = ref<HTMLButtonElement | null>(null)
 * useEnterConfirm(computed(() => store.showAddFieldModal), () => store.confirmAddField(), confirmBtn)
 */
export function useEnterConfirm(
  showFlag: Ref<boolean>,
  onConfirm: () => void,
  focusEl?: Ref<HTMLElement | null>,
) {
  function enterHandler(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.isComposing) return
    const el = e.target as HTMLElement | null
    const tag = el?.tagName
    if (tag === 'TEXTAREA') {
      if (!(e.ctrlKey || e.metaKey)) return
    } else if (tag === 'SELECT' || el?.isContentEditable) {
      return
    } else if (el instanceof HTMLButtonElement) {
      return
    }

    e.preventDefault()
    onConfirm()
  }

  watch(showFlag, (show) => {
    if (show) {
      nextTick(() => focusEl?.value?.focus())
      window.addEventListener('keydown', enterHandler)
    } else {
      window.removeEventListener('keydown', enterHandler)
    }
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', enterHandler)
  })
}
