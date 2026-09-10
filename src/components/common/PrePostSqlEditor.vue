<script setup lang="ts">
import { computed } from 'vue'
import { useEnabledDialect } from '@/composables/useEnabledDialect'
import SegmentedSwitch from '@/components/ui/SegmentedSwitch.vue'

const props = defineProps<{
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

// 只展示已启用的方言；当前方言被禁用时自动回落
const { dialectOptions, activeDialect } = useEnabledDialect()

const preValue = computed(() =>
  activeDialect.value === 'mysql' ? props.mysqlPre
    : activeDialect.value === 'postgresql' ? props.postgresqlPre
      : props.sqlitePre,
)

const postValue = computed(() =>
  activeDialect.value === 'mysql' ? props.mysqlPost
    : activeDialect.value === 'postgresql' ? props.postgresqlPost
      : props.sqlitePost,
)

function updatePre(val: string) {
  if (activeDialect.value === 'mysql') emit('update:mysqlPre', val)
  else if (activeDialect.value === 'postgresql') emit('update:postgresqlPre', val)
  else emit('update:sqlitePre', val)
}

function updatePost(val: string) {
  if (activeDialect.value === 'mysql') emit('update:mysqlPost', val)
  else if (activeDialect.value === 'postgresql') emit('update:postgresqlPost', val)
  else emit('update:sqlitePost', val)
}
</script>

<template>
  <div class="section-card">
    <div class="section-header">
      <div class="header-tabs">
        <div style="margin-right: 15px;">
          <span>{{ title }}</span>
        </div>
        <SegmentedSwitch v-model="activeDialect" :options="dialectOptions" />
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
            class="sql-textarea"
            :value="preValue"
            @input="updatePre(($event.target as HTMLTextAreaElement).value)"
            :placeholder="prePlaceholder"
            :rows="rows ?? 4"
          ></textarea>
        </div>
        <!-- 后置 SQL -->
        <div class="sql-group">
          <label class="sql-label">{{ $t('prePostSql.post') }}</label>
          <textarea
            class="sql-textarea"
            :value="postValue"
            @input="updatePost(($event.target as HTMLTextAreaElement).value)"
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
  align-items: center;
  gap: 0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
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
