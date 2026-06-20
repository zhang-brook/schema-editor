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
  pgsqlPre: string
  pgsqlPost: string
}>()

const emit = defineEmits<{
  'update:mysqlPre': [value: string]
  'update:mysqlPost': [value: string]
  'update:pgsqlPre': [value: string]
  'update:pgsqlPost': [value: string]
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
            :value="pgsqlPre"
            @input="emit('update:pgsqlPre', ($event.target as HTMLTextAreaElement).value)"
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
            :value="pgsqlPost"
            @input="emit('update:pgsqlPost', ($event.target as HTMLTextAreaElement).value)"
            :placeholder="postPlaceholder"
            :rows="rows ?? 4"
          ></textarea>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.section-card {
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 6px;
  margin-bottom: 16px;
  overflow: hidden;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #fafafa;
  border-bottom: 1px solid #eee;
  font-weight: 600;
  font-size: 13px;
  color: #444;
}

.section-body {
  padding: 14px;
}

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
  padding: 3px 10px;
  border: 1px solid #ccc;
  background: #fff;
  color: #666;
  font-size: 11px;
  cursor: pointer;
  transition: all .15s;
  font-family: inherit;
}

.tab-btn:first-child {
  border-radius: 3px 0 0 3px;
}

.tab-btn:last-child {
  border-radius: 0 3px 3px 0;
  border-left: none;
}

.tab-btn.active {
  background: #4a90d9;
  color: #fff;
  border-color: #4a90d9;
}

.tab-btn.active + .tab-btn {
  border-left-color: #4a90d9;
}

.tab-btn:not(.active):hover {
  background: #e8e8e8;
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
  border: 1px solid #ccc;
  border-radius: 3px;
  font-size: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  line-height: 1.5;
  resize: vertical;
  box-sizing: border-box;
}

.sql-textarea:focus {
  outline: none;
  border-color: #4a90d9;
}
</style>
