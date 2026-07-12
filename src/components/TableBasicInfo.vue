<script setup lang="ts">
import { ref, computed } from 'vue'
import { useEditorStore } from '@/stores/editor'
import type { SqlDialect } from '@/utils/sql-generator/shared'

const store = useEditorStore()

/** 表名失焦确认时触发改名：同步迁移初始数据 key 并清理旧目录 */
async function onTableNameChange(event: Event) {
  const target = event.target as HTMLInputElement
  const newName = target.value
  const table = store.currentTable
  if (!table) return
  // 未变化（含空白）直接还原显示
  if (newName.trim() === table.name) {
    target.value = table.name
    return
  }
  const ok = await store.renameTable(store.selectedSchemaIdx, store.selectedTableIdx, newName)
  // 校验失败（重名/空）则还原为原名
  if (!ok) target.value = table.name
}

// ===== 分区表配置（按方言） =====
const partitionDialect = ref<SqlDialect>('mysql')

interface PartitionFormValue {
  strategy: string
  columns: string[]
  expression: string
}

const partitionConfig = computed<PartitionFormValue>({
  get() {
    const table = store.currentTable
    if (!table) return { strategy: '', columns: [], expression: '' }
    const p = store.getTablePartition(table, partitionDialect.value)
    return {
      strategy: p.strategy || '',
      columns: p.columns || [],
      expression: p.expression || '',
    }
  },
  set(val: PartitionFormValue) {
    const table = store.currentTable
    if (!table) return
    store.setTablePartition(table, partitionDialect.value, val)
  },
})

// 分区列：以逗号分隔的文本与数组互转
const partitionColumnsText = computed({
  get() {
    return partitionConfig.value.columns.join(', ')
  },
  set(val: string) {
    const cols = val
      .split(',')
      .map(c => c.trim())
      .filter(Boolean)
    partitionConfig.value = { ...partitionConfig.value, columns: cols }
  },
})

const partitionStrategy = computed({
  get() {
    return partitionConfig.value.strategy
  },
  set(val: string) {
    partitionConfig.value = { ...partitionConfig.value, strategy: val }
  },
})

const partitionExpression = computed({
  get() {
    return partitionConfig.value.expression
  },
  set(val: string) {
    partitionConfig.value = { ...partitionConfig.value, expression: val }
  },
})
</script>

<template>
  <!-- Table Basic Info -->
  <div class="section-card">
    <div class="section-header">
      {{ $t('tableEditor.table') }} {{ store.currentTable?.name }}
      <span class="badge" v-if="store.currentSchema">{{ store.currentSchema.schema }}</span>
    </div>
    <div class="section-body">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">{{ $t('tableEditor.tableName') }}</label>
          <input class="form-input" :value="store.currentTable!.name" @change="onTableNameChange">
        </div>
        <div class="form-group">
          <label class="form-label">{{ $t('tableEditor.comment') }}</label>
          <input class="form-input" v-model="store.currentTable!.comment">
        </div>
      </div>
      <!-- Comment Before Table -->
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">{{ $t('tableEditor.commentBeforeTable') }}</label>
          <textarea class="comment-editor"
                    :value="store.commentBeforeTableText(store.currentTable!)"
                    @input="store.setCommentBeforeTable(store.currentTable!, ($event.target as HTMLTextAreaElement).value)"
                    rows="3"></textarea>
          <span class="comment-hint">{{ $t('tableEditor.commentHint') }}</span>
        </div>
      </div>
      <!-- MySQL Table Config Override -->
      <div class="form-row">
        <div class="form-group narrow">
          <label class="form-label">{{ $t('tableEditor.mysqlEngine') }}</label>
          <input class="form-input" :value="store.getTableMysqlEngine(store.currentTable!)" @input="store.setTableMysqlEngine(store.currentTable!, ($event.target as HTMLInputElement).value)" placeholder="InnoDB">
        </div>
        <div class="form-group narrow">
          <label class="form-label">{{ $t('tableEditor.mysqlCharset') }}</label>
          <input class="form-input" :value="store.getTableMysqlCharset(store.currentTable!)" @input="store.setTableMysqlCharset(store.currentTable!, ($event.target as HTMLInputElement).value)" placeholder="utf8mb4">
        </div>
        <div class="form-group narrow">
          <label class="form-label">{{ $t('tableEditor.mysqlCollation') }}</label>
          <input class="form-input" :value="store.getTableMysqlCollation(store.currentTable!)" @input="store.setTableMysqlCollation(store.currentTable!, ($event.target as HTMLInputElement).value)" placeholder="utf8mb4_0900_ai_ci">
        </div>
      </div>

      <!-- Partition By（按方言） -->
      <div class="form-row partition-block">
        <div class="partition-header">
          <label class="form-label">{{ $t('tableEditor.partition') }}</label>
          <div class="header-tabs">
            <button class="tab-btn" :class="{ active: partitionDialect === 'mysql' }" @click="partitionDialect = 'mysql'">{{ $t('sqlPreview.mysql') }}</button>
            <button class="tab-btn" :class="{ active: partitionDialect === 'postgresql' }" @click="partitionDialect = 'postgresql'">{{ $t('sqlPreview.postgresql') }}</button>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group narrow">
            <label class="form-label">{{ $t('tableEditor.partitionStrategy') }}</label>
            <select class="form-input" v-model="partitionStrategy">
              <option value="">{{ $t('tableEditor.partitionRaw') }}</option>
              <option value="RANGE">RANGE</option>
              <option value="LIST">LIST</option>
              <option value="HASH">HASH</option>
              <option value="KEY">KEY</option>
              <option value="RANGE COLUMNS">RANGE COLUMNS</option>
              <option value="LIST COLUMNS">LIST COLUMNS</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('tableEditor.partitionColumns') }}</label>
            <input class="form-input" v-model="partitionColumnsText" :disabled="!partitionStrategy" :placeholder="$t('tableEditor.partitionColumnsPlaceholder')">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">{{ $t('tableEditor.partitionExpression') }}</label>
            <input class="form-input" v-model="partitionExpression" :placeholder="$t('tableEditor.partitionExpressionPlaceholder')">
            <span class="comment-hint">{{ $t('tableEditor.partitionHint') }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="@/assets/style/section.css"></style>
<style scoped src="@/assets/style/form.css"></style>
<style scoped src="@/assets/style/comment.css"></style>
<style scoped>
.partition-block {
  flex-direction: column;
  align-items: stretch;
}
.partition-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.header-tabs {
  display: flex;
  gap: 6px;
}
.tab-btn {
  padding: 4px 12px;
  border: 1px solid #d0d7de;
  background: #f6f8fa;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.tab-btn.active {
  background: #0969da;
  color: #fff;
  border-color: #0969da;
}
</style>
