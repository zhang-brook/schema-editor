import { ref } from 'vue'

/** 主题偏好：system 跟随系统，其余为固定主题 */
export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const THEME_PREF = 'schema-editor.theme'
const PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

/** 非法偏好值一律回退到 system */
export function normalizePreference(value: unknown): ThemePreference {
  return typeof value === 'string' && (PREFERENCES as readonly string[]).includes(value)
    ? (value as ThemePreference)
    : 'system'
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light'
  return preference
}

const darkQuery = typeof window === 'undefined' ? null : window.matchMedia('(prefers-color-scheme: dark)')

function readPreference(): ThemePreference {
  if (typeof localStorage === 'undefined') return 'system'
  return normalizePreference(localStorage.getItem(THEME_PREF))
}

const preference = ref<ThemePreference>(readPreference())
const resolved = ref<ResolvedTheme>('light')

function apply() {
  const isDark = resolveTheme(preference.value, darkQuery?.matches ?? false) === 'dark'
  resolved.value = isDark ? 'dark' : 'light'
  document.documentElement.classList.toggle('dark', isDark)
}

export function setTheme(next: ThemePreference) {
  preference.value = next
  if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_PREF, next)
  apply()
}

/** 应用主题并跟随系统深浅色变化（应用启动时调用一次） */
export function initTheme() {
  apply()
  darkQuery?.addEventListener('change', () => {
    if (preference.value === 'system') apply()
  })
}

export function useTheme() {
  return { preference, resolved, setTheme }
}
