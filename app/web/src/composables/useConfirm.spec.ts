import { describe, expect, it } from 'vitest'
import { alertDialog, chooseDialog, confirmDialog, resolveConfirm, useConfirmState } from './useConfirm'

describe('confirm dialog queue', () => {
  it('shows the front request and resolves it with the clicked button', async () => {
    const state = useConfirmState()
    const first = confirmDialog({ title: 'A', message: 'a', cancelText: 'No' })
    expect(state.visible).toBe(true)
    expect(state.title).toBe('A')
    expect(state.secondaryText).toBe('')

    resolveConfirm('confirm')
    expect(await first).toBe(true)
    expect(state.visible).toBe(false)
  })

  it('maps every non-confirm button of confirmDialog to false', async () => {
    const cancelled = confirmDialog({ title: 'A', message: 'a', cancelText: 'No' })
    resolveConfirm('cancel')
    expect(await cancelled).toBe(false)

    const secondary = confirmDialog({ title: 'B', message: 'b', cancelText: 'No' })
    resolveConfirm('secondary')
    expect(await secondary).toBe(false)
  })

  it('renders the three-way save guard and reports the chosen button', async () => {
    const state = useConfirmState()
    const choice = chooseDialog({ title: 'Save?', message: 'unsaved', confirmText: 'Save', secondaryText: 'Discard', cancelText: 'Cancel' })
    expect(state.visible).toBe(true)
    expect(state.confirmText).toBe('Save')
    expect(state.secondaryText).toBe('Discard')
    expect(state.cancelText).toBe('Cancel')

    resolveConfirm('secondary')
    expect(await choice).toBe('secondary')
  })

  it('queues concurrent requests and reveals them one by one', async () => {
    const state = useConfirmState()
    const first = confirmDialog({ title: 'First', message: '1' })
    const second = chooseDialog({ title: 'Second', message: '2', confirmText: 'Yes', secondaryText: 'Skip', cancelText: 'No' })
    expect(state.title).toBe('First')
    expect(state.secondaryText).toBe('')

    resolveConfirm('cancel')
    expect(await first).toBe(false)
    expect(state.title).toBe('Second')
    expect(state.secondaryText).toBe('Skip')

    resolveConfirm('confirm')
    expect(await second).toBe('confirm')
    expect(state.visible).toBe(false)
  })

  it('keeps alert dialogs button-free and resolves them on any click', async () => {
    const state = useConfirmState()
    const alert = alertDialog({ title: 'Notice', message: 'done' })
    expect(state.cancelText).toBe('')

    resolveConfirm('confirm')
    await expect(alert).resolves.toBeUndefined()
  })

  it('ignores a stray resolution when no dialog is pending', () => {
    resolveConfirm('confirm')
    expect(useConfirmState().visible).toBe(false)
  })
})
