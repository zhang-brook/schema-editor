import type { BrowserWindowConstructorOptions } from 'electron'
import type { DesktopTitleBarMode } from 'schema-editor-bridge'

export interface WindowChrome {
  titleBarMode: DesktopTitleBarMode
  overlay: {
    color: string
    symbolColor: string
  }
}

// One pixel shorter than the 40px app menu bar so its bottom border stays outside the caption overlay.
export const TITLE_BAR_OVERLAY_HEIGHT = 39

let chrome: WindowChrome = {
  titleBarMode: 'integrated',
  overlay: { color: '#ffffff', symbolColor: '#71717a' },
}

export function getWindowChrome(): WindowChrome {
  return chrome
}

export function setWindowChrome(next: WindowChrome): void {
  chrome = next
}

export function defaultOverlay(dark: boolean): WindowChrome['overlay'] {
  return dark
    ? { color: '#18181b', symbolColor: '#a1a1aa' }
    : { color: '#ffffff', symbolColor: '#71717a' }
}

export function updateOverlayColors(color: string, symbolColor: string): void {
  chrome = { ...chrome, overlay: { color, symbolColor } }
}

/**
 * Frameless chrome for integrated mode; native mode returns no overrides so Electron draws the OS frame.
 * macOS keeps the traffic lights and only hides the title bar, while Windows/Linux use a caption overlay.
 */
export function frameOptions(
  chrome: WindowChrome,
  platform: NodeJS.Platform = process.platform,
): Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'titleBarOverlay' | 'trafficLightPosition'> {
  if (chrome.titleBarMode !== 'integrated') return {}
  if (platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } }
  }
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: chrome.overlay.color,
      symbolColor: chrome.overlay.symbolColor,
      height: TITLE_BAR_OVERLAY_HEIGHT,
    },
  }
}
