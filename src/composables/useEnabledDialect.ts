import { computed, ref, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import type { SegmentedOption } from '@/components/ui/SegmentedSwitch.vue'
import type { SqlDialect } from '@/utils/sql-generator/shared'

/** 方言展示名（各方言名称在各语言环境下保持一致） */
export const DIALECT_LABELS: Record<SqlDialect, string> = {
  mysql: 'MySQL',
  postgresql: 'PostgreSQL',
  sqlite: 'SQLite',
}

/** 将方言列表转为分段切换组件的选项 */
export function toDialectOptions(dialects: SqlDialect[]): SegmentedOption[] {
  return dialects.map(d => ({ value: d, label: DIALECT_LABELS[d] }))
}

/**
 * 受项目「启用的 SQL 方言」约束的方言页签状态：
 * - `enabledDialects`：当前启用的方言（按支持顺序排列）
 * - `dialectOptions`：可直接喂给 SegmentedSwitch 的选项
 * - `activeDialect`：当前选中方言，其被取消启用时自动回落到第一个启用的方言
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
