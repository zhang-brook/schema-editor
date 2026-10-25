import { computed, onMounted, ref, watch } from 'vue'
import type { DesktopTitleBarMode } from 'schema-editor-bridge'
import { useTheme } from './useTheme'

function getBridge() {
  return typeof window === 'undefined' ? null : (window.schemaEditorDesktop ?? null)
}

/** Platform and title bar chrome the current desktop process was started with */
export const desktopPlatform = ref(getBridge()?.platform ?? '')
export const appliedTitleBarMode = ref<DesktopTitleBarMode>(
  getBridge()?.titleBarMode ?? 'integrated',
)
export const isDesktop = computed(() => getBridge() !== null)

/** Current selection in the appearance panel; saved immediately but only applied after a relaunch */
export const selectedTitleBarMode = ref<DesktopTitleBarMode>(appliedTitleBarMode.value)

export const titleBarRestartRequired = computed(
  () => isDesktop.value && selectedTitleBarMode.value !== appliedTitleBarMode.value,
)

export async function setTitleBarMode(mode: DesktopTitleBarMode): Promise<void> {
  selectedTitleBarMode.value = mode
  await getBridge()?.setTitleBarMode(mode)
}

export async function restartApp(): Promise<void> {
  await getBridge()?.relaunch()
}

let chromeSyncInstalled = false

/**
 * Loads the saved title bar selection and keeps the Windows/Linux caption button overlay
 * in sync with the app theme. Called once from the root component.
 */
export function useWindowChrome() {
  if (chromeSyncInstalled || !isDesktop.value) return
  chromeSyncInstalled = true

  const desktopBridge = getBridge()
  if (!desktopBridge) return
  desktopPlatform.value = desktopBridge.platform

  // A page reload keeps the saved selection, so the restart prompt survives without restarting the app
  void desktopBridge
    .getTitleBarModePreference()
    .then(mode => {
      if (selectedTitleBarMode.value === appliedTitleBarMode.value) selectedTitleBarMode.value = mode
    })
    .catch(() => undefined)

  const { resolved } = useTheme()

  function syncOverlay(): void {
    const bridge = getBridge()
    if (!bridge) return
    if (bridge.platform === 'darwin' || appliedTitleBarMode.value !== 'integrated') return
    const tokens = getComputedStyle(document.documentElement)
    const color = tokens.getPropertyValue('--surface').trim()
    const symbolColor = tokens.getPropertyValue('--fg-muted').trim()
    if (!color || !symbolColor) return
    void bridge.setTitleBarOverlay(color, symbolColor).catch(() => undefined)
  }

  onMounted(syncOverlay)
  watch(resolved, syncOverlay, { flush: 'post' })
}
