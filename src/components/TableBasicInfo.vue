<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'

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
    </div>
  </div>
</template>

<style scoped src="@/assets/style/section.css"></style>
<style scoped src="@/assets/style/form.css"></style>
<style scoped src="@/assets/style/comment.css"></style>
<style scoped></style>
