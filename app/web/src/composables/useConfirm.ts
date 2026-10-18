import { reactive } from 'vue'

/** Dialog button identifier: confirm (primary button) / secondary button / cancel */
export type ConfirmChoice = 'confirm' | 'secondary' | 'cancel'

export interface ConfirmOptions {
  /** Title text (an already translated string, displayed as is) */
  title: string
  /** Body message, supports \n line breaks */
  message: string
  /** Confirm button text */
  confirmText?: string
  /** Cancel button text; the cancel button is hidden when empty */
  cancelText?: string
  /** Whether the confirm button uses the primary color (default true) */
  primaryConfirm?: boolean
}

/** Dialog options with a secondary button (e.g. a three-way choice of "Save / Don't Save / Cancel") */
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

// Queue: every confirmDialog()/chooseDialog()/alertDialog() call enqueues a request and returns a Promise;
// the single ConfirmModal in App.vue displays the head of the queue in order and automatically shows the next one after closing.
// This naturally supports nested dialogs (e.g. a confirm inside a confirm callback) or multiple async chains triggering dialogs concurrently,
// without the problem of "the singleton state being overwritten so the previous Promise never resolves".
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
  // Show immediately only when no dialog is currently displayed; otherwise wait for the head to close, then resolveConfirm shows the next one
  if (!state.visible) showFront()
}

/**
 * Opens a confirmation dialog and returns whether the user clicked "Confirm".
 * Replaces the native window.confirm with the project's unified dialog style.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => enqueue(options, (value) => resolve(value === 'confirm')))
}

/** Opens a three-way choice dialog and returns the clicked button identifier (Esc and overlay clicks count as "cancel") */
export function chooseDialog(options: ChooseOptions): Promise<ConfirmChoice> {
  return new Promise<ConfirmChoice>((resolve) => enqueue(options, resolve, options.secondaryText))
}

/**
 * Opens an alert dialog (confirm button only) and returns Promise<void>.
 * Replaces the native window.alert with the project's unified dialog style.
 */
export function alertDialog(options: Omit<ConfirmOptions, 'cancelText'>): Promise<void> {
  return new Promise<void>((resolve) => enqueue({ ...options, cancelText: '' }, () => resolve()))
}

/** Called by ConfirmModal when the user clicks a button or the overlay */
export function resolveConfirm(value: ConfirmChoice) {
  const front = queue.shift()
  if (!front) return
  front.resolve(value)
  showFront()
}

/** Exposes reactive state for the globally mounted ConfirmModal in App.vue to bind to */
export function useConfirmState() {
  return state
}
