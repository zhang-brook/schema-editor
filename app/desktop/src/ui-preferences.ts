import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DesktopTitleBarMode } from 'schema-editor-bridge'

export interface UiPreferences {
  titleBarMode: DesktopTitleBarMode
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  titleBarMode: 'integrated',
}

export function normalizeUiPreferences(input: unknown): UiPreferences {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  return {
    titleBarMode: source.titleBarMode === 'native' ? 'native' : 'integrated',
  }
}

/**
 * Window chrome preferences read by the main process before the window is created.
 * A missing or corrupted file falls back to the defaults so startup is never blocked.
 */
export function createUiPreferences(file: string) {
  let cache: Promise<UiPreferences> | null = null

  async function read(): Promise<UiPreferences> {
    try {
      return normalizeUiPreferences(JSON.parse(await fs.readFile(file, 'utf8')))
    } catch {
      return { ...DEFAULT_UI_PREFERENCES }
    }
  }

  function load(): Promise<UiPreferences> {
    cache ??= read()
    return cache
  }

  async function setTitleBarMode(mode: DesktopTitleBarMode): Promise<UiPreferences> {
    const next = normalizeUiPreferences({ ...(await load()), titleBarMode: mode })
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    cache = Promise.resolve(next)
    return next
  }

  return { load, setTitleBarMode }
}

export type UiPreferencesStore = ReturnType<typeof createUiPreferences>
