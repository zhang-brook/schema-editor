import { watch, onUnmounted, nextTick, type Ref } from 'vue'

/**
 * 弹窗回车确认 composable
 *
 * 监听弹窗可见状态，显示时绑定 window keydown 事件，按 Enter 触发确认回调；
 * 隐藏时移除事件监听，组件卸载时自动清理。
 * 文本域 / 下拉框 / 富文本内的回车有自身语义（换行、展开选项），不抢键；
 * 按钮上的回车交给原生 click；Ctrl/Cmd + Enter 在文本域内仍可确认。
 * 若传入 focusEl，弹窗显示后会把焦点移入该元素——否则焦点残留在触发按钮上时，
 * 回车会重复触发原按钮，永远轮不到弹窗。
 *
 * @param showFlag  弹窗可见性的 Ref（ref / computed / toRef 均可）
 * @param onConfirm 按下 Enter 时的确认回调
 * @param focusEl   弹窗显示后自动聚焦的元素（一般为确认按钮或首个输入框）
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
