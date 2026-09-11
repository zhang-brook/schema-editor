<script setup lang="ts">
/**
 * 身份对齐面板：确认「旧结构中消失的对象」与「新结构中新增的对象」是否同一个。
 *
 * 候选由相似度自动推断（source: auto），未经用户确认不会影响 diff；
 * 确认后以 source: manual 写入迁移的 renames，成为后续 diff 的匹配依据。
 * 字段集合完全一致的名称对调在数学上不可判定，这类会标为歧义并优先展示。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RenameEntry } from '@/core/version/types'
import type { RenameSuggestion } from '@/core/version/identity'

const props = defineProps<{
  suggestions: RenameSuggestion[]
  confirmed: RenameEntry[]
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm', entry: RenameEntry): void
  (e: 'remove', from: string): void
}>()

const { t } = useI18n()

interface Row {
  kind: RenameEntry['kind']
  from: string
  to: string
  score: number
  candidates: { to: string; score: number }[]
  ambiguous: boolean
  confirmedEntry: RenameEntry | null
}

const rows = computed<Row[]>(() =>
  props.suggestions.map(s => {
    const matched =
      props.confirmed.find(c => c.from === s.entry.from && c.kind === s.entry.kind) ?? null
    return {
      kind: s.entry.kind,
      from: s.entry.from,
      to: matched?.to ?? s.entry.to,
      score: s.entry.confidence ?? 0,
      candidates: s.candidates,
      ambiguous: s.ambiguous,
      confirmedEntry: matched,
    }
  }),
)

/** 歧义项排前面，让用户优先处理 */
const pending = computed(() => {
  const list = rows.value.filter(r => !r.confirmedEntry)
  return [...list].sort((a, b) => Number(b.ambiguous) - Number(a.ambiguous) || b.score - a.score)
})
const confirmedRows = computed(() => rows.value.filter(r => r.confirmedEntry))

/** 已确认但不在当前候选中（历史记录或跨版本沿用） */
const extraConfirmed = computed(() =>
  props.confirmed.filter(
    c => !props.suggestions.some(s => s.entry.from === c.from && s.entry.kind === c.kind),
  ),
)

function kindLabel(kind: RenameEntry['kind']): string {
  switch (kind) {
    case 'schema':
      return t('migration.kindSchema')
    case 'table':
      return t('migration.kindTable')
    case 'field':
      return t('migration.kindField')
    default:
      return t('migration.kindIndex')
  }
}

function percent(score: number): string {
  return `${Math.round(score * 100)}%`
}

function confirm(row: Row, to: string) {
  emit('confirm', { kind: row.kind, from: row.from, to, source: 'manual', confidence: 1 })
}

function onSelectTarget(row: Row, event: Event) {
  confirm(row, (event.target as HTMLSelectElement).value)
}
</script>

<template>
  <div class="ra">
    <div class="ra-head">
      <span class="ra-title">{{ t('migration.alignTitle') }}</span>
      <span v-if="loading" class="ra-loading">{{ t('migration.alignLoading') }}</span>
    </div>
    <p class="ra-desc">{{ t('migration.alignDesc') }}</p>

    <div v-if="!loading && rows.length === 0 && extraConfirmed.length === 0" class="ps-empty-sm">
      {{ t('migration.alignEmpty') }}
    </div>

    <template v-if="pending.length > 0">
      <div class="ra-group">{{ t('migration.alignPending') }} ({{ pending.length }})</div>
      <div v-for="row in pending" :key="`${row.kind}:${row.from}`" class="ra-row"
        :class="{ 'is-ambiguous': row.ambiguous }">
        <span class="ra-kind">{{ kindLabel(row.kind) }}</span>
        <span class="ra-path">{{ row.from }}<span class="ra-arrow">→</span>{{ row.to }}</span>
        <span class="ra-score">{{ percent(row.score) }}</span>
        <span v-if="row.ambiguous" class="ra-warn" :title="t('migration.alignAmbiguous')">⚠</span>
        <select v-if="row.candidates.length > 1" class="ra-select" :value="row.to"
          @change="onSelectTarget(row, $event)">
          <option v-for="c in row.candidates" :key="c.to" :value="c.to">
            {{ c.to }} ({{ percent(c.score) }})
          </option>
        </select>
        <span v-else class="ra-spacer" />
        <button class="btn btn-sm btn-primary" @click="confirm(row, row.to)">
          {{ t('migration.alignConfirm') }}
        </button>
      </div>
    </template>

    <template v-if="confirmedRows.length > 0 || extraConfirmed.length > 0">
      <div class="ra-group">
        {{ t('migration.alignConfirmed') }} ({{ confirmedRows.length + extraConfirmed.length }})
      </div>
      <div v-for="row in confirmedRows" :key="`c:${row.kind}:${row.from}`" class="ra-row is-ok">
        <span class="ra-kind">{{ kindLabel(row.kind) }}</span>
        <span class="ra-path">{{ row.from }}<span class="ra-arrow">→</span>{{ row.to }}</span>
        <span class="ra-spacer" />
        <button class="btn btn-sm btn-ghost" @click="emit('remove', row.from)">
          {{ t('migration.alignCancel') }}
        </button>
      </div>
      <div v-for="entry in extraConfirmed" :key="`e:${entry.kind}:${entry.from}`" class="ra-row is-ok">
        <span class="ra-kind">{{ kindLabel(entry.kind) }}</span>
        <span class="ra-path">{{ entry.from }}<span class="ra-arrow">→</span>{{ entry.to }}</span>
        <span class="ra-spacer" />
        <button class="btn btn-sm btn-ghost" @click="emit('remove', entry.from)">
          {{ t('migration.alignCancel') }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ra {
  padding: 10px 12px;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: var(--radius-sm, 6px);
  background: var(--bg-soft, #f9fafb);
}

.ra-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ra-title {
  font-size: 13px;
  font-weight: 600;
}

.ra-loading {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}

.ra-desc {
  margin: 4px 0 8px;
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}

.ra-group {
  margin: 8px 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #6b7280);
}

.ra-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
}

.ra-row:hover {
  background: var(--hover-bg, #f3f4f6);
}

.ra-row.is-ambiguous {
  background: #fffbeb;
}

.ra-row.is-ok {
  color: var(--text-secondary, #6b7280);
}

.ra-kind {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--bg-muted, #e5e7eb);
  font-size: 11px;
}

.ra-path {
  flex: 1 1 auto;
  overflow: hidden;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ra-arrow {
  margin: 0 6px;
  color: var(--primary-color, #2563eb);
}

.ra-score {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--text-secondary, #6b7280);
}

.ra-warn {
  flex: 0 0 auto;
  color: #b45309;
}

.ra-select {
  flex: 0 0 auto;
  max-width: 220px;
  font-size: 12px;
}

.ra-spacer {
  flex: 1 1 auto;
}
</style>
