<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
</script>

<template>
  <!-- Default MySQL Table Config -->
  <div class="section-card">
    <div class="section-header">{{ $t('commonConfig.defaultMysqlConfig') }}</div>
    <div class="section-body">
      <div class="form-row">
        <div class="form-group medium">
          <label class="form-label">{{ $t('commonConfig.engine') }}</label>
          <input
            class="form-input"
            :value="store.getCommonMysqlEngine()"
            @input="store.setCommonMysqlEngine(($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="form-group medium">
          <label class="form-label">{{ $t('commonConfig.charset') }}</label>
          <input
            class="form-input"
            :value="store.getCommonMysqlCharset()"
            @input="store.setCommonMysqlCharset(($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="form-group medium">
          <label class="form-label">{{ $t('commonConfig.collation') }}</label>
          <input
            class="form-input"
            :value="store.getCommonMysqlCollation()"
            @input="store.setCommonMysqlCollation(($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="@/assets/style/section.css"></style>
<style scoped src="@/assets/style/form.css"></style>
