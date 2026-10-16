<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
import type { SettingsTab } from '@/types/settings'

const store = useEditorStore()

// 数组顺序即页面展示顺序
const tabs: SettingsTab[] = ['structure', 'version', 'project']
</script>

<template>
  <nav class="ps-rail">
    <!-- <div class="ps-rail-title">{{ $t('settings.title') }}</div> -->
    <button
      v-for="tab in tabs"
      :key="tab"
      class="ps-rail-item"
      :class="{ active: store.settingsTab === tab }"
      @click="store.selectSettingsTab(tab)"
    >{{ $t(`settings.tabs.${tab}`) }}</button>
  </nav>
</template>

<style scoped>
/* VSCode 风格页面切换列 */
.ps-rail {
  width: 200px;
  min-width: 200px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 14px 10px;
  gap: 4px;
}

.ps-rail-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--fg-subtle);
  text-transform: uppercase;
  letter-spacing: .06em;
  padding: 4px 10px 10px;
}

.ps-rail-item {
  text-align: left;
  padding: 9px 12px;
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--fg-muted);
  cursor: pointer;
  font-family: inherit;
  transition: background .12s ease, color .12s ease;
}

.ps-rail-item:hover {
  background: var(--surface-3);
  color: var(--fg);
}

.ps-rail-item.active {
  background: var(--accent-subtle);
  color: var(--accent-active);
  font-weight: 600;
  box-shadow: inset 3px 0 0 var(--accent);
}
</style>
