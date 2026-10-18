import { computed, ref, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import type { SegmentedOption } from '@/components/ui/SegmentedSwitch.vue'
import type { SqlDialect } from 'schema-editor-core/utils/sql-generator/shared'

/** Dialect display names (dialect names stay the same across all locales) */
export const DIALECT_LABELS: Record<SqlDialect, string> = {
  mysql: 'MySQL',
  postgresql: 'PostgreSQL',
  sqlite: 'SQLite',
}

/** Converts a dialect list into options for the segmented switch component */
export function toDialectOptions(dialects: SqlDialect[]): SegmentedOption[] {
  return dialects.map(d => ({ value: d, label: DIALECT_LABELS[d] }))
}

/**
 * Dialect tab state constrained by the project's "enabled SQL dialects":
 * - `enabledDialects`: currently enabled dialects (in supported order)
 * - `dialectOptions`: options that can be passed directly to SegmentedSwitch
 * - `activeDialect`: currently selected dialect; falls back to the first enabled dialect when it is disabled
 */
export function useEnabledDialect() {
  const store = useEditorStore()
  const enabledDialects = computed(() => store.enabledDialects)
  const dialectOptions = computed(() => toDialectOptions(enabledDialects.value))
  const activeDialect = ref<SqlDialect>(store.enabledDialects[0] ?? 'mysql')

  watch(
    enabledDialects,
    (list) => {
      if (list.length > 0 && !list.includes(activeDialect.value)) {
        activeDialect.value = list[0]!
      }
    },
    { immediate: true },
  )

  return { enabledDialects, dialectOptions, activeDialect }
}
