<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
</script>

<template>
  <div class="section-card">
    <div class="section-body">
      <label class="ai-guide-switch">
        <input
          type="checkbox"
          :checked="store.generateAiGuide"
          @change="store.setGenerateAiGuide(($event.target as HTMLInputElement).checked)"
        />
        <span class="ai-guide-label">{{ $t('settings.aiGuide') }}</span>
      </label>
      <p class="ai-guide-hint">{{ $t('settings.aiGuideHint') }}</p>
    </div>
  </div>
</template>

<style scoped src="@/assets/style/section.css"></style>
<style scoped>
.ai-guide-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: var(--fg);
}

.ai-guide-switch input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.ai-guide-hint {
  margin: 8px 0 0 24px;
  font-size: 12px;
  color: #888;
  line-height: 1.5;
}
</style>
