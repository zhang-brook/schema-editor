<script setup lang="ts">
/**
 * Identity alignment panel: confirm whether an object that disappeared from the old structure and an object added in the new structure are the same.
 *
 * Candidates are inferred automatically by similarity (source: auto) and do not affect the diff until confirmed by the user; once confirmed, they are written into the migration renames as source: manual and become the matching basis for later diffs.
 * Swapping names whose field sets are exactly identical is mathematically undecidable; such cases are marked ambiguous and shown first.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RenameEntry } from 'schema-editor-core/core/version/types'
import type { RenameSuggestion } from 'schema-editor-core/core/version/identity'

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

/** Ambiguous items come first so the user handles them first */
const pending = computed(() => {
  const list = rows.value.filter(r => !r.confirmedEntry)
  return [...list].sort((a, b) => Number(b.ambiguous) - Number(a.ambiguous) || b.score - a.score)
})
const confirmedRows = computed(() => rows.value.filter(r => r.confirmedEntry))

/** Confirmed but not in the current candidates (history or carried over across versions) */
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
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
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
  color: var(--fg-muted);
}

.ra-desc {
  margin: 4px 0 8px;
  font-size: 12px;
  color: var(--fg-muted);
}

.ra-group {
  margin: 8px 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-muted);
}

.ra-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
}

.ra-row:hover {
  background: var(--surface-3);
}

.ra-row.is-ambiguous {
  background: var(--warning-subtle);
}

.ra-row.is-ok {
  color: var(--fg-muted);
}

.ra-kind {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--surface-3);
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
  color: var(--accent);
}

.ra-score {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--fg-muted);
}

.ra-warn {
  flex: 0 0 auto;
  color: var(--warning);
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
