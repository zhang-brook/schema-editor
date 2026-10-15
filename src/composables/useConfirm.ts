import { reactive } from 'vue'

/** 弹窗按钮标识：确认（主按钮）/ 次按钮 / 取消 */
export type ConfirmChoice = 'confirm' | 'secondary' | 'cancel'

export interface ConfirmOptions {
  /** 标题文本（已翻译后的字符串，直接显示） */
  title: string
  /** 正文消息，支持 \n 换行 */
  message: string
  /** 确认按钮文本 */
  confirmText?: string
  /** 取消按钮文本；为空则不显示取消按钮 */
  cancelText?: string
  /** 确认按钮是否使用主色调（默认 true） */
  primaryConfirm?: boolean
}

/** 带次按钮的弹窗选项（如「保存 / 不保存 / 取消」三选一） */
export interface ChooseOptions extends ConfirmOptions {
  secondaryText: string
}

interface ConfirmRequest {
  title: string
  message: string
  confirmText: string
  secondaryText: string
  cancelText: string
  primaryConfirm: boolean
  resolve: (value: ConfirmChoice) => void
}

// 队列：每次 confirmDialog()/chooseDialog()/alertDialog() 入队并返回 Promise，
// 由 App.vue 中唯一的 ConfirmModal 依次展示队首，关闭后自动展示下一个。
// 因此天然支持弹窗嵌套（如确认框的回调里再弹确认）或多个异步链并发触发弹窗，
// 不会出现「单例 state 被覆盖导致前一个 Promise 永不 resolve」的问题。
const queue: ConfirmRequest[] = []

const state = reactive({
  visible: false,
  title: '',
  message: '',
  confirmText: 'OK',
  secondaryText: '',
  cancelText: '',
  primaryConfirm: true,
})

function showFront() {
  const front = queue[0]
  if (!front) {
    state.visible = false
    return
  }
  state.title = front.title
  state.message = front.message
  state.confirmText = front.confirmText
  state.secondaryText = front.secondaryText
  state.cancelText = front.cancelText
  state.primaryConfirm = front.primaryConfirm
  state.visible = true
}

function enqueue(options: ConfirmOptions, resolve: (value: ConfirmChoice) => void, secondaryText = '') {
  queue.push({
    title: options.title,
    message: options.message,
    confirmText: options.confirmText ?? 'OK',
    secondaryText,
    cancelText: options.cancelText ?? '',
    primaryConfirm: options.primaryConfirm ?? true,
    resolve,
  })
  // 当前没有弹窗在展示时才立即展示；否则等待队首关闭后由 resolveConfirm 自动展示下一个
  if (!state.visible) showFront()
}

/**
 * 打开确认弹窗，返回用户是否点击「确认」。
 * 替代原生 window.confirm，统一项目弹窗样式。
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => enqueue(options, (value) => resolve(value === 'confirm')))
}

/** 打开三选一弹窗，返回被点击的按钮标识（Esc 与点击遮罩算「取消」） */
export function chooseDialog(options: ChooseOptions): Promise<ConfirmChoice> {
  return new Promise<ConfirmChoice>((resolve) => enqueue(options, resolve, options.secondaryText))
}

/**
 * 打开提示弹窗（仅确认按钮），返回 Promise<void>。
 * 替代原生 window.alert，统一项目弹窗样式。
 */
export function alertDialog(options: Omit<ConfirmOptions, 'cancelText'>): Promise<void> {
  return new Promise<void>((resolve) => enqueue({ ...options, cancelText: '' }, () => resolve()))
}

/** 由 ConfirmModal 在用户点击某个按钮或点击遮罩时调用 */
export function resolveConfirm(value: ConfirmChoice) {
  const front = queue.shift()
  if (!front) return
  front.resolve(value)
  showFront()
}

/** 暴露响应式状态，供 App.vue 全局唯一挂载的 ConfirmModal 绑定 */
export function useConfirmState() {
  return state
}
