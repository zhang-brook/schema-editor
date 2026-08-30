<script setup lang="ts">
import type { SqlDialect } from '@/utils/sql-generator/shared';
import { ref } from 'vue'

defineProps<{
  title: string
  prePlaceholder: string
  postPlaceholder: string
  rows?: number
  mysqlPre: string
  mysqlPost: string
  postgresqlPre: string
  postgresqlPost: string
  sqlitePre: string
  sqlitePost: string
}>()

const emit = defineEmits<{
  'update:mysqlPre': [value: string]
  'update:mysqlPost': [value: string]
  'update:postgresqlPre': [value: string]
  'update:postgresqlPost': [value: string]
  'update:sqlitePre': [value: string]
  'update:sqlitePost': [value: string]
}>()

const dialect = ref<SqlDialect>('mysql')
</script>

<template>
  <div class="section-card">
    <div class="section-header">
      <div class="header-tabs">
        <div style="margin-right: 15px;">
          <span>{{ title }}</span>
        </div>
        <div class="tab-group">
          <button class="tab-btn" :class="{ active: dialect === 'mysql' }" @click="dialect = 'mysql'">MySQL</button>
          <button class="tab-btn" :class="{ active: dialect === 'postgresql' }" @click="dialect = 'postgresql'">PostgreSQL</button>
          <button class="tab-btn" :class="{ active: dialect === 'sqlite' }" @click="dialect = 'sqlite'">SQLite</button>
        </div>
      </div>
      <div class="header-right">
        <slot name="header-actions"></slot>
      </div>
    </div>
    <div class="section-body">
      <div class="sql-grid">
        <!-- 前置 SQL -->
        <div class="sql-group">
          <label class="sql-label">{{ $t('prePostSql.pre') }}</label>
          <textarea
            v-if="dialect === 'mysql'"
            class="sql-textarea"
            :value="mysqlPre"
            @input="emit('update:mysqlPre', ($event.target as HTMLTextAreaElement).value)"
            :placeholder="prePlaceholder"
            :rows="rows ?? 4"
          ></textarea>
          <textarea
            v-else-if="dialect === 'postgresql'"
            class="sql-textarea"
            :value="postgresqlPre"
            @input="emit('update:postgresqlPre', ($event.target as HTMLTextAreaElement).value)"
            :placeholder="prePlaceholder"
            :rows="rows ?? 4"
          ></textarea>
          <textarea
            v-else-if="dialect === 'sqlite'"
            class="sql-textarea"
            :value="sqlitePre"
            @input="emit('update:sqlitePre', ($event.target as HTMLTextAreaElement).value)"
            :placeholder="prePlaceholder"
            :rows="rows ?? 4"
          ></textarea>
        </div>
        <!-- 后置 SQL -->
        <div class="sql-group">
          <label class="sql-label">{{ $t('prePostSql.post') }}</label>
          <textarea
            v-if="dialect === 'mysql'"
            class="sql-textarea"
            :value="mysqlPost"
            @input="emit('update:mysqlPost', ($event.target as HTMLTextAreaElement).value)"
            :placeholder="postPlaceholder"
            :rows="rows ?? 4"
          ></textarea>
          <textarea
            v-else-if="dialect === 'postgresql'"
            class="sql-textarea"
            :value="postgresqlPost"
            @input="emit('update:postgresqlPost', ($event.target as HTMLTextAreaElement).value)"
            :placeholder="postPlaceholder"
            :rows="rows ?? 4"
          ></textarea>
          <textarea
            v-else-if="dialect === 'sqlite'"
            class="sql-textarea"
            :value="sqlitePost"
            @input="emit('update:sqlitePost', ($event.target as HTMLTextAreaElement).value)"
            :placeholder="postPlaceholder"
            :rows="rows ?? 4"
          ></textarea>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="@/assets/style/section.css"></style>
<style scoped src="@/assets/style/btn.css"></style>
<style scoped>
.header-tabs {
  display: flex;
  gap: 0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tab-group {
  display: flex;
  gap: 0;
}

.tab-btn {
  padding: 4px 12px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--fg-muted);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background .15s ease, color .15s ease, border-color .15s ease;
  font-family: inherit;
}

.tab-btn:first-child {
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.tab-btn:last-child {
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  border-left: none;
}

.tab-btn.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.tab-btn.active + .tab-btn {
  border-left-color: var(--accent);
}

.tab-btn:not(.active):hover {
  background: var(--surface-3);
  color: var(--fg);
}

.sql-grid {
  display: flex;
  gap: 16px;
}

.sql-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.sql-label {
  font-size: 10px;
  font-weight: 600;
  color: #888;
  text-transform: uppercase;
}

.sql-textarea {
  width: 100%;
  min-height: 80px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  line-height: 1.5;
  resize: vertical;
  box-sizing: border-box;
}

.sql-textarea:focus {
  outline: none;
  border-color: var(--accent);
}
</style>
