<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
</script>

<template>
  <!-- SQLite default config (card shell and title are provided by DatabaseDefaultsPanel) -->
  <div class="form-row">
    <div class="form-group">
      <label class="form-label">{{ $t('commonConfig.quoteIdentifiers') }}</label>
      <div class="toggle-row">
        <label class="toggle-switch">
          <input
            type="checkbox"
            :checked="store.getCommonSqliteQuoteIdentifiers()"
            @change="store.setCommonSqliteQuoteIdentifiers(($event.target as HTMLInputElement).checked)"
          />
          <span class="toggle-slider"></span>
        </label>
        <span class="toggle-hint">{{ $t('commonConfig.quoteIdentifiersHint') }}</span>
      </div>
    </div>
  </div>
</template>

