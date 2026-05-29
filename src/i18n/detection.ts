const STORAGE_KEY = 'schema-editor-locale'

const SUPPORTED_LOCALES = ['en', 'zh-CN', 'zh-TW'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

/** 当前可用的 locale 列表 */
export const availableLocales: SupportedLocale[] = [...SUPPORTED_LOCALES]

/** 检测当前有效 locale：localStorage > navigator.language > 'en' */
export function detectLocale(): SupportedLocale {
  // 1. 用户手动选择
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && isSupported(stored)) return stored

  // 2. 浏览器偏好
  const browser = navigator.language.toLowerCase()
  // 先尝试完整匹配（如 zh-CN, zh-TW）
  if (isSupported(browser)) return browser as SupportedLocale
  // 再尝试截取前缀匹配（如 zh -> zh-CN）
  const prefix = browser.slice(0, 2)
  const fallback = SUPPORTED_LOCALES.find(l => l.startsWith(prefix))
  if (fallback) return fallback

  // 3. 默认
  return 'en'
}

/** 保存用户选择的 locale 到 localStorage */
export function persistLocale(locale: SupportedLocale): void {
  localStorage.setItem(STORAGE_KEY, locale)
}

function isSupported(locale: string): locale is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale)
}
