<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
</script>

<template>
  <!-- Default PostgreSQL Config -->
  <div class="section-card">
    <div class="section-header">{{ $t('commonConfig.defaultPostgresqlConfig') }}</div>
    <div class="section-body">
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
    </div>
  </div>
</template>

<style scoped src="@/assets/style/section.css"></style>
<style scoped src="@/assets/style/form.css"></style>
<style scoped src="@/assets/style/toggle.css"></style>
