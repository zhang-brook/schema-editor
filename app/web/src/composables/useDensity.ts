import { ref } from 'vue'

/** 界面密度：影响数据表格行高与列表行间距 */
export type DensityPreference = 'compact' | 'normal' | 'relaxed'

const DENSITY_PREF = 'schema-editor.density'
const PREFERENCES: readonly DensityPreference[] = ['compact', 'normal', 'relaxed']

/** 非法偏好值一律回退到 normal */
export function normalizeDensity(value: unknown): DensityPreference {
  return typeof value === 'string' && (PREFERENCES as readonly string[]).includes(value)
    ? (value as DensityPreference)
    : 'normal'
}

function readPreference(): DensityPreference {
  if (typeof localStorage === 'undefined') return 'normal'
  return normalizeDensity(localStorage.getItem(DENSITY_PREF))
}

const preference = ref<DensityPreference>(readPreference())

function apply() {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.density = preference.value
}

export function setDensity(next: DensityPreference) {
  preference.value = next
  if (typeof localStorage !== 'undefined') localStorage.setItem(DENSITY_PREF, next)
  apply()
}

/** 应用密度偏好（应用启动时调用一次） */
export function initDensity() {
  apply()
}

export function useDensity() {
  return { preference, setDensity }
}
