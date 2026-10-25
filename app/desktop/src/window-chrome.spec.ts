import { describe, expect, it } from 'vitest'
import { frameOptions, TITLE_BAR_OVERLAY_HEIGHT, type WindowChrome } from './window-chrome'

const integrated: WindowChrome = {
  titleBarMode: 'integrated',
  overlay: { color: '#ffffff', symbolColor: '#71717a' },
}

describe('frameOptions', () => {
  it('adds a caption overlay on Windows and Linux in integrated mode', () => {
    const expected = {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#ffffff',
        symbolColor: '#71717a',
        height: TITLE_BAR_OVERLAY_HEIGHT,
      },
    }
    expect(frameOptions(integrated, 'win32')).toEqual(expected)
    expect(frameOptions(integrated, 'linux')).toEqual(expected)
  })

  it('hides only the title bar on macOS so the traffic lights stay available', () => {
    expect(frameOptions(integrated, 'darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 14 },
    })
  })

  it('leaves the native frame untouched in native mode', () => {
    expect(frameOptions({ ...integrated, titleBarMode: 'native' }, 'win32')).toEqual({})
    expect(frameOptions({ ...integrated, titleBarMode: 'native' }, 'darwin')).toEqual({})
  })
})
