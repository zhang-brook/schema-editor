const STORAGE_KEY = 'schema-editor-locale'

const SUPPORTED_LOCALES = ['en', 'zh-CN', 'zh-TW'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

/** Currently available locales */
export const availableLocales: SupportedLocale[] = [...SUPPORTED_LOCALES]

/** Resolve the active locale: localStorage > navigator.language > 'en' */
export function detectLocale(): SupportedLocale {
  // 1. Manual user selection
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && isSupported(stored)) return stored

  // 2. Browser preference
  const browser = navigator.language.toLowerCase()
  // Try an exact match first (e.g. zh-CN, zh-TW)
  if (isSupported(browser)) return browser as SupportedLocale
  // Fall back to a prefix match (e.g. zh -> zh-CN)
  const prefix = browser.slice(0, 2)
  const fallback = SUPPORTED_LOCALES.find(l => l.startsWith(prefix))
  if (fallback) return fallback

  // 3. Default
  return 'en'
}

/** Persist the user's locale choice to localStorage */
export function persistLocale(locale: SupportedLocale): void {
  localStorage.setItem(STORAGE_KEY, locale)
}

function isSupported(locale: string): locale is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale)
}
