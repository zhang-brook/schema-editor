<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
</script>

<template>
  <!-- 项目信息：随项目保存到 common.json -->
  <div class="section-card">
    <div class="section-body">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">{{ $t('commonConfig.projectName') }}</label>
          <input
            class="form-input"
            type="text"
            :value="store.projectName"
            :placeholder="$t('commonConfig.projectNamePlaceholder')"
            @input="store.setProjectName(($event.target as HTMLInputElement).value)"
          />
          <p class="form-hint">{{ $t('commonConfig.projectNameHint') }}</p>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">{{ $t('commonConfig.projectDescription') }}</label>
          <textarea
            class="form-input"
            rows="3"
            :value="store.projectDescription"
            :placeholder="$t('commonConfig.projectDescriptionPlaceholder')"
            @input="store.setProjectDescription(($event.target as HTMLTextAreaElement).value)"
          ></textarea>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="@/assets/style/section.css"></style>
<style scoped src="@/assets/style/form.css"></style>
<style scoped>
textarea.form-input {
  resize: vertical;
  min-height: 64px;
  line-height: 1.5;
}

.form-hint {
  margin: 0;
  font-size: 11px;
  color: var(--fg-subtle);
}
</style>
