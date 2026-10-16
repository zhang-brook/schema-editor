import { watch, onUnmounted, type Ref } from 'vue'

/**
 * 弹窗 ESC 关闭 composable
 *
 * 监听弹窗可见状态，显示时绑定 document keydown 事件，按 ESC 触发关闭回调；
 * 隐藏时移除事件监听，组件卸载时自动清理。
 *
 * @param showFlag  弹窗可见性的 Ref（ref / computed / toRef 均可）
 * @param onClose   按下 ESC 时的关闭回调
 *
 * @example
 * // 在弹窗组件中直接调用
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
