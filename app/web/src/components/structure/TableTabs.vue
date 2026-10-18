<script setup lang="ts">
import { useTableTabs } from '@/composables/useTableTabs'

const { openTabs, isActive, activate, close } = useTableTabs()
</script>

<template>
  <!-- Open tables: click to switch, × to close; takes no space when there are no tabs -->
  <div v-if="openTabs.length" class="table-tabs">
    <div
      v-for="tab in openTabs"
      :key="`${tab.schema.schema}.${tab.table.name}`"
      class="table-tab"
      :class="{ active: isActive(tab) }"
      :title="`${tab.schema.schema}.${tab.table.name}`"
      @click="activate(tab)"
    >
      <span class="table-tab-name">{{ tab.table.name }}</span>
      <span class="table-tab-close" :title="$t('structureTabs.close')" @click.stop="close(tab)">&times;</span>
    </div>
  </div>
</template>

<style scoped>
.table-tabs {
  display: flex;
  align-items: stretch;
  gap: 2px;
  flex-shrink: 0;
  padding: 8px 8px 0;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  scrollbar-width: thin;
}

.table-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 200px;
  padding: 4px 6px 4px 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  font-size: 12px;
  color: var(--fg-muted);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  transition: background .12s ease, color .12s ease;
}

.table-tab:hover {
  background: var(--surface-3);
  color: var(--fg);
}

.table-tab.active {
  background: var(--surface);
  border-color: var(--border);
  color: var(--fg);
  font-weight: 600;
}

.table-tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.table-tab-close {
  flex-shrink: 0;
  padding: 0 3px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  line-height: 1.2;
  opacity: 0;
  transition: opacity .12s ease, background .12s ease;
}

.table-tab:hover .table-tab-close,
.table-tab.active .table-tab-close {
  opacity: 0.6;
}

.table-tab-close:hover {
  opacity: 1;
  background: var(--accent-subtle);
  color: var(--accent-active);
}
</style>
