<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
</script>

<template>
  <!-- PostgreSQL 默认配置（由 DatabaseDefaultsPanel 提供卡片外壳与标题） -->
  <div class="form-row">
    <div class="form-group">
      <label class="form-label">{{ $t('commonConfig.quoteIdentifiers') }}</label>
      <div class="toggle-row">
        <label class="toggle-switch">
          <input
            type="checkbox"
            :checked="store.getCommonPostgresqlQuoteIdentifiers()"
            @change="store.setCommonPostgresqlQuoteIdentifiers(($event.target as HTMLInputElement).checked)"
          />
          <span class="toggle-slider"></span>
        </label>
        <span class="toggle-hint">{{ $t('commonConfig.quoteIdentifiersHint') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped src="@/assets/style/form.css"></style>
<style scoped src="@/assets/style/toggle.css"></style>
