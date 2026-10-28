<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { ALL_SQL_DIALECTS, type SqlDialect } from 'schema-editor-core/utils/sql-generator/shared'
import { DIALECT_LABELS } from '@/composables/useEnabledDialect'

const store = useEditorStore()

const enabledCount = computed(() => ALL_SQL_DIALECTS.filter(d => store.isDialectEnabled(d)).length)

/** This dialect is the only one currently enabled: unchecking is forbidden to keep at least one dialect enabled */
function isLastEnabled(dialect: SqlDialect): boolean {
  return store.isDialectEnabled(dialect) && enabledCount.value <= 1
}
</script>

<template>
  <div class="section-card">
    <div class="section-header">{{ $t('dialectConfig.title') }}</div>
    <div class="section-body">
      <div class="dialect-options">
        <label
          v-for="d in ALL_SQL_DIALECTS"
          :key="d"
          class="dialect-option"
          :class="{ disabled: isLastEnabled(d) }"
        >
          <input
            type="checkbox"
            class="checkbox"
            :checked="store.isDialectEnabled(d)"
            :disabled="isLastEnabled(d)"
            :title="isLastEnabled(d) ? $t('dialectConfig.keepOne') : ''"
            @change="store.setDialectEnabled(d, ($event.target as HTMLInputElement).checked)"
          />
          <span class="dialect-name">{{ DIALECT_LABELS[d] }}</span>
        </label>
      </div>
      <p class="dialect-hint">{{ $t('dialectConfig.hint') }}</p>
    </div>
  </div>
</template>

<style scoped>
.dialect-options {
  display: flex;
  flex-wrap: wrap;
  gap: 22px;
}

.dialect-option {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  color: var(--fg);
  cursor: pointer;
  user-select: none;
}

.dialect-option.disabled {
  opacity: .55;
  cursor: not-allowed;
}

.dialect-name {
  font-family: 'Consolas', 'Monaco', monospace;
  font-weight: 500;
}

.dialect-hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--fg-muted);
  line-height: 1.6;
}
</style>
