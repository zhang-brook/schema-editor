<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore } from '@/stores/editor'
import type { LogicalDeleteMysqlStrategy } from 'schema-editor-core/types/schema'
import { deriveDeletePredicate } from 'schema-editor-core/utils/logical-delete'

const store = useEditorStore()

const cfg = computed(() => store.getLogicalDelete())

const enabled = computed(() => cfg.value.enabled === true)

/** Not-deleted predicate: when empty, show the derived result as the placeholder hint */
const derivedPredicate = computed(() => deriveDeletePredicate(cfg.value.field ?? ''))
</script>

<template>
  <!-- Logical delete: declare the deletion marker field and decide how unique indexes bypass deleted rows -->
  <div class="section-card">
    <div class="section-header">{{ $t('logicalDelete.title') }}</div>
    <div class="section-body">
      <div class="form-row">
        <div class="form-group">
          <label class="ld-check" :title="$t('logicalDelete.enabledTip')">
            <input
              type="checkbox"
              :checked="enabled"
              @change="store.setLogicalDelete({ enabled: ($event.target as HTMLInputElement).checked })"
            >
            <span>{{ $t('logicalDelete.enabled') }}</span>
          </label>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group medium">
          <label class="form-label">{{ $t('logicalDelete.field') }}</label>
          <input
            class="form-input"
            :value="cfg.field ?? ''"
            :placeholder="$t('logicalDelete.fieldPlaceholder')"
            @input="store.setLogicalDelete({ field: ($event.target as HTMLInputElement).value })"
          >
        </div>
        <div class="form-group medium">
          <label class="form-label">{{ $t('logicalDelete.predicate') }}</label>
          <input
            class="form-input"
            :value="cfg.predicate ?? ''"
            :placeholder="derivedPredicate || $t('logicalDelete.predicatePlaceholder')"
            @input="store.setLogicalDelete({ predicate: ($event.target as HTMLInputElement).value })"
          >
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">{{ $t('logicalDelete.mysqlStrategy') }}</label>
          <div class="radio-group">
            <label class="radio-option" v-for="opt in [
              { value: 'functional', label: $t('logicalDelete.functional') },
              { value: 'timestamp_union', label: $t('logicalDelete.timestampUnion') },
            ]" :key="opt.value">
              <input
                type="radio"
                name="logicalDeleteMysqlStrategy"
                :value="opt.value"
                :checked="(cfg.mysql_strategy ?? 'functional') === opt.value"
                @change="store.setLogicalDelete({ mysql_strategy: opt.value as LogicalDeleteMysqlStrategy })"
              />
              <span class="radio-label">{{ opt.label }}</span>
            </label>
          </div>
        </div>
      </div>

      <div class="ld-hint">{{ $t('logicalDelete.applyHint') }}</div>
      <div class="ld-tip">{{ $t('logicalDelete.tip') }}</div>
    </div>
  </div>
</template>

<style scoped>
.ld-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}

.ld-check input {
  margin: 0;
  cursor: pointer;
}

/* Reuse the radio card styles from DdlOptionsPanel */
.radio-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.radio-option {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 12px;
  color: var(--fg);
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  transition: border-color .15s, background .15s;
}

.radio-option:hover {
  border-color: var(--accent);
  background: var(--accent-subtle-2);
}

.radio-option input[type="radio"] {
  accent-color: var(--accent);
  width: 16px;
  height: 16px;
  cursor: pointer;
  flex-shrink: 0;
}

.radio-label {
  font-size: 12px;
  color: var(--fg);
  font-family: 'Consolas', 'Monaco', monospace;
}

.ld-hint {
  margin-top: 10px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--accent);
}

.ld-tip {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--fg-subtle);
  font-size: 11px;
  line-height: 1.6;
}
</style>
