import { ref } from 'vue'

/** UI density: affects data table row height and list row spacing */
export type DensityPreference = 'compact' | 'normal' | 'relaxed'

const DENSITY_PREF = 'schema-editor.density'
const PREFERENCES: readonly DensityPreference[] = ['compact', 'normal', 'relaxed']

/** Invalid preference values always fall back to normal */
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

/** Applies the density preference (called once at app startup) */
export function initDensity() {
  apply()
}

export function useDensity() {
  return { preference, setDensity }
}
