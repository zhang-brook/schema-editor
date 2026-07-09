<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
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
          <input class="form-input" v-model="store.currentTable!.name">
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

<style scoped>
@import '../assets/style/section.css';
@import '../assets/style/form.css';
@import '../assets/style/comment.css';
</style>
