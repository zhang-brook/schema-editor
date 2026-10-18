<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useEditorStore } from '@/stores/editor'
import SegmentedSwitch from '@/components/ui/SegmentedSwitch.vue'
import { toDialectOptions } from '@/composables/useEnabledDialect'
import type { SqlDialect } from 'schema-editor-core/utils/sql-generator/shared'

const store = useEditorStore()

/** More settings (comment before table / MySQL engine, etc.) are collapsed by default */
const showMore = ref(false)

/** Rename on table-name blur confirm: migrate initial-data keys and clean up the old directory */
async function onTableNameChange(event: Event) {
  const target = event.target as HTMLInputElement
  const newName = target.value
  const table = store.currentTable
  if (!table) return
  // Unchanged (including blank): restore the displayed value directly
  if (newName.trim() === table.name) {
    target.value = table.name
    return
  }
  const ok = await store.renameTable(store.selectedSchemaIdx, store.selectedTableIdx, newName)
  // Validation failed (duplicate/empty): restore the original name
  if (!ok) target.value = table.name
}

// ===== Partition table config (per dialect) =====
const partitionDialect = ref<SqlDialect>('mysql')

// Partitioning is supported only by MySQL / PostgreSQL, then filtered by the dialects enabled in the project
const PARTITION_DIALECTS: SqlDialect[] = ['mysql', 'postgresql']
const partitionDialects = computed(() =>
  store.enabledDialects.filter(d => PARTITION_DIALECTS.includes(d)),
)
const partitionDialectOptions = computed(() => toDialectOptions(partitionDialects.value))

// Fall back to the first available dialect when the current partition dialect is disabled
watch(partitionDialects, (list) => {
  if (list.length > 0 && !list.includes(partitionDialect.value)) {
    partitionDialect.value = list[0]!
  }
}, { immediate: true })

interface PartitionFormValue {
  strategy: string
  columns: string[]
  expression: string
}

const partitionConfig = computed<PartitionFormValue>({
  get() {
    const table = store.currentTable
    if (!table) return { strategy: '', columns: [], expression: '' }
    const p = store.getTablePartition(table, partitionDialect.value)
    return {
      strategy: p.strategy || '',
      columns: p.columns || [],
      expression: p.expression || '',
    }
  },
  set(val: PartitionFormValue) {
    const table = store.currentTable
    if (!table) return
    store.setTablePartition(table, partitionDialect.value, val)
  },
})

// Partition columns: convert between a comma-separated text value and an array
const partitionColumnsText = computed({
  get() {
    return partitionConfig.value.columns.join(', ')
  },
  set(val: string) {
    const cols = val
      .split(',')
      .map(c => c.trim())
      .filter(Boolean)
    partitionConfig.value = { ...partitionConfig.value, columns: cols }
  },
})

const partitionStrategy = computed({
  get() {
    return partitionConfig.value.strategy
  },
  set(val: string) {
    partitionConfig.value = { ...partitionConfig.value, strategy: val }
  },
})

const partitionExpression = computed({
  get() {
    return partitionConfig.value.expression
  },
  set(val: string) {
    partitionConfig.value = { ...partitionConfig.value, expression: val }
  },
})
</script>

<template>
  <!-- Table Basic Info -->
  <div class="section-card">
    <div class="section-header">
      {{ $t('tableEditor.table') }} {{ store.currentTable?.name }}
      <span class="badge" v-if="store.currentSchema">{{ store.currentSchema.schema }}</span>
    </div>
    <div class="section-body">
      <div class="form-row name-row">
        <div class="form-group">
          <label class="form-label">{{ $t('tableEditor.tableName') }}</label>
          <input class="form-input" :value="store.currentTable!.name" @change="onTableNameChange">
        </div>
        <div class="form-group">
          <label class="form-label">{{ $t('tableEditor.comment') }}</label>
          <input class="form-input" :value="store.currentTable!.comment" @input="store.updateTable(store.currentTable!, { comment: ($event.target as HTMLInputElement).value })">
        </div>
      </div>
      <div v-show="showMore" class="more-settings">
        <!-- Comment Before Table -->
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">{{ $t('tableEditor.commentBeforeTable') }}</label>
            <textarea class="comment-editor"
                      :value="store.commentBeforeTableText(store.currentTable!)"
                      @input="store.setCommentBeforeTable(store.currentTable!, ($event.target as HTMLTextAreaElement).value)"
                      rows="3"></textarea>
            <span class="comment-hint">{{ $t('tableEditor.commentHint') }}</span>
          </div>
        </div>
        <!-- MySQL Table Config Override -->
        <div class="form-row">
          <div class="form-group narrow">
            <label class="form-label">{{ $t('tableEditor.mysqlEngine') }}</label>
            <input class="form-input" :value="store.getTableMysqlEngine(store.currentTable!)" @input="store.setTableMysqlEngine(store.currentTable!, ($event.target as HTMLInputElement).value)" placeholder="InnoDB">
          </div>
          <div class="form-group narrow">
            <label class="form-label">{{ $t('tableEditor.mysqlCharset') }}</label>
            <input class="form-input" :value="store.getTableMysqlCharset(store.currentTable!)" @input="store.setTableMysqlCharset(store.currentTable!, ($event.target as HTMLInputElement).value)" placeholder="utf8mb4">
          </div>
          <div class="form-group narrow">
            <label class="form-label">{{ $t('tableEditor.mysqlCollation') }}</label>
            <input class="form-input" :value="store.getTableMysqlCollation(store.currentTable!)" @input="store.setTableMysqlCollation(store.currentTable!, ($event.target as HTMLInputElement).value)" placeholder="utf8mb4_0900_ai_ci">
          </div>
        </div>

        <!-- Partition By (per dialect) -->
        <div v-if="partitionDialects.length > 0" class="form-row partition-block">
          <div class="partition-header">
            <label class="form-label">{{ $t('tableEditor.partition') }}</label>
            <div class="header-tabs">
              <SegmentedSwitch v-model="partitionDialect" :options="partitionDialectOptions" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group narrow">
              <label class="form-label">{{ $t('tableEditor.partitionStrategy') }}</label>
              <select class="form-input" v-model="partitionStrategy">
                <option value="">{{ $t('tableEditor.partitionRaw') }}</option>
                <option value="RANGE">RANGE</option>
                <option value="LIST">LIST</option>
                <option value="HASH">HASH</option>
                <option value="KEY">KEY</option>
                <option value="RANGE COLUMNS">RANGE COLUMNS</option>
                <option value="LIST COLUMNS">LIST COLUMNS</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">{{ $t('tableEditor.partitionColumns') }}</label>
              <input class="form-input" v-model="partitionColumnsText" :disabled="!partitionStrategy" :placeholder="$t('tableEditor.partitionColumnsPlaceholder')">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">{{ $t('tableEditor.partitionExpression') }}</label>
              <input class="form-input" v-model="partitionExpression" :placeholder="$t('tableEditor.partitionExpressionPlaceholder')">
              <span class="comment-hint">{{ $t('tableEditor.partitionHint') }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="more-toggle-wrap">
        <button type="button" class="more-toggle" :aria-expanded="showMore" @click="showMore = !showMore">
          {{ $t('tableEditor.moreSettings') }}
          <svg class="chevron" :class="{ open: showMore }" width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped src="@/assets/style/section.css"></style>
<style scoped src="@/assets/style/form.css"></style>
<style scoped src="@/assets/style/comment.css"></style>
<style scoped>
.more-settings {
  border-top: 1px dashed var(--border);
  padding-top: 14px;
}

.more-toggle-wrap {
  display: flex;
  justify-content: center;
}

.more-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--fg-muted);
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.more-toggle:hover {
  background: var(--surface-3);
  color: var(--fg);
}

.more-toggle:focus-visible {
  box-shadow: var(--focus-ring);
}

.chevron {
  transition: transform 0.15s ease;
}

.chevron.open {
  transform: rotate(180deg);
}

.partition-block {
  flex-direction: column;
  align-items: stretch;
}
.partition-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.header-tabs {
  display: flex;
  gap: 6px;
}
</style>
