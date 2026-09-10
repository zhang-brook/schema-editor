<script setup lang="ts">
import { computed } from 'vue'
import type { Index } from '@/types/schema'
import { useEditorStore } from '@/stores/editor'
import IndexColumnsEditor from './IndexColumnsEditor.vue'

const store = useEditorStore()

const availableFieldNames = computed(() => {
  if (!store.currentTable) return []
  return store.currentTable.fields.map(f => f.field_name)
})

// 索引名称采用「{pre} + 核心名 + {post}」三段式：用户只需填写中间核心部分，
// 前后缀占位符在生成 SQL 时按方言与索引类型自动展开；且前后缀均可点击徽标自由开关。
const PRE = '{pre}'
const POST = '{post}'

// 新建（未设置名称）时默认开启前后缀；已有名称则依据是否包含占位符判断
function hasPre(index: Index): boolean {
  const name = index.name
  if (name == null) return true
  return name.startsWith(PRE)
}

function hasPost(index: Index): boolean {
  const name = index.name
  if (name == null) return true
  return name.endsWith(POST)
}

// 从存储的完整名称中剥离首尾占位符，得到中间可编辑的核心名
function getIndexCore(index: Index): string {
  let name = index.name ?? ''
  if (name.startsWith(PRE)) name = name.slice(PRE.length)
  if (name.endsWith(POST)) name = name.slice(0, name.length - POST.length)
  return name
}

// 按前后缀开关状态重建完整名称
function composeIndexName(core: string, pre: boolean, post: boolean): string {
  return `${pre ? PRE : ''}${core}${post ? POST : ''}`
}

// 回写核心名时保留当前前后缀开关状态
function setIndexCore(index: Index, core: string) {
  index.name = composeIndexName(core, hasPre(index), hasPost(index))
}

// 点击徽标：切换是否自动添加前缀 / 后缀
function togglePre(index: Index) {
  index.name = composeIndexName(getIndexCore(index), !hasPre(index), hasPost(index))
}

function togglePost(index: Index) {
  index.name = composeIndexName(getIndexCore(index), hasPre(index), !hasPost(index))
}
</script>

<template>
  <div class="section-card" v-if="store.currentTable">
    <div class="section-header">
      {{ $t('indexTable.indexes') }}
      <span class="badge">{{ store.currentTable.indexes.length }}</span>
      <button class="btn btn-sm btn-primary" style="margin-left:auto;" @click="store.addIndex(store.currentTable!)">{{ $t('indexTable.addIndex') }}</button>
    </div>
    <div class="section-body" style="padding: 0; overflow-x: auto;">
      <table class="indexes-table" v-if="store.currentTable.indexes.length > 0">
        <thead>
          <tr>
            <th style="width:30px;"></th>
            <th>{{ $t('indexTable.name') }}</th>
            <th>{{ $t('indexTable.type') }}</th>
            <th>{{ $t('indexTable.columns') }}</th>
            <th>{{ $t('indexTable.using') }}</th>
            <th>{{ $t('indexTable.comment') }}</th>
            <th style="width:50px;">{{ $t('indexTable.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(index, iIdx) in store.currentTable.indexes" :key="iIdx">
            <tr>
              <td>
                <span class="expand-toggle" @click="store.toggleIndexExpand(store.indexKey(store.currentSchema!, store.currentTable!, index, iIdx))">
                  {{ store.expandedIndexes.has(store.indexKey(store.currentSchema!, store.currentTable!, index, iIdx)) ? '▼' : '▶' }}
                </span>
              </td>
              <td>
                <div class="index-name-group">
                  <button
                    type="button"
                    class="index-name-affix"
                    :class="{ 'is-active': hasPre(index) }"
                    :title="$t('indexTable.preAffixTip')"
                    @click="togglePre(index)"
                  >{pre}</button>
                  <input
                    class="table-input index-name-core"
                    :value="getIndexCore(index)"
                    @input="setIndexCore(index, ($event.target as HTMLInputElement).value)"
                    :placeholder="$t('indexTable.namePlaceholder')"
                  >
                  <button
                    type="button"
                    class="index-name-affix"
                    :class="{ 'is-active': hasPost(index) }"
                    :title="$t('indexTable.postAffixTip')"
                    @click="togglePost(index)"
                  >{post}</button>
                </div>
              </td>
              <td>
                <select class="form-input" v-model="index.type" style="width:80px;">
                  <option value="index">index</option>
                  <option value="unique">unique</option>
                </select>
              </td>
              <td style="min-width:240px;">
                <IndexColumnsEditor v-model="index.columns" :available-fields="availableFieldNames" />
              </td>
              <td>
                <input class="table-input" v-model="index.using" style="width:60px;">
              </td>
              <td>
                <input class="table-input" v-model="index.comment" :placeholder="$t('indexTable.commentPlaceholder')" style="min-width:100px;">
              </td>
              <td>
                <button class="btn btn-sm btn-danger" @click="store.deleteIndex(store.currentTable!, iIdx)">×</button>
              </td>
            </tr>
            <!-- Expanded Index Detail -->
            <tr v-if="store.expandedIndexes.has(store.indexKey(store.currentSchema!, store.currentTable!, index, iIdx))">
              <td colspan="7">
                <div class="field-expand-content">
                  <!-- 解析后名称预览 -->
                  <div class="expand-section">
                    <div class="expand-section-title">{{ $t('indexTable.resolvedName') }}</div>
                    <div class="resolved-type-row">
                      <span class="db-label">MySQL:</span>
                      <code>{{ store.getResolvedIndexNameForDb(index, store.currentTable!, 'mysql') }}</code>
                      <span class="db-label" style="margin-left:16px;">PostgreSQL:</span>
                      <code>{{ store.getResolvedIndexNameForDb(index, store.currentTable!, 'postgresql') }}</code>
                      <span class="db-label" style="margin-left:16px;">SQLite:</span>
                      <code>{{ store.getResolvedIndexNameForDb(index, store.currentTable!, 'sqlite') }}</code>
                    </div>
                  </div>
                  <div class="expand-section">
                    <div class="expand-section-title">{{ $t('indexTable.indexOverrides') }}</div>
                    <div class="db-override-grid">
                      <div class="db-override-group">
                        <div class="db-label">MySQL</div>
                        <select class="form-input" :value="store.getIndexOverrideValue(index, 'mysql', 'type')" @input="store.setIndexOverrideValue(index, 'mysql', 'type', ($event.target as HTMLSelectElement).value)">
                          <option value="">{{ $t('indexTable.typeSelect') }}</option>
                          <option value="index">index</option>
                          <option value="unique">unique</option>
                        </select>
                        <input class="form-input" placeholder="name" :value="store.getIndexOverrideValue(index, 'mysql', 'name')" @input="store.setIndexOverrideValue(index, 'mysql', 'name', ($event.target as HTMLInputElement).value)">
                        <input class="form-input" placeholder="using" :value="store.getIndexOverrideValue(index, 'mysql', 'using')" @input="store.setIndexOverrideValue(index, 'mysql', 'using', ($event.target as HTMLInputElement).value)">
                      </div>
                      <div class="db-override-group">
                        <div class="db-label">PostgreSQL</div>
                        <select class="form-input" :value="store.getIndexOverrideValue(index, 'postgresql', 'type')" @input="store.setIndexOverrideValue(index, 'postgresql', 'type', ($event.target as HTMLSelectElement).value)">
                          <option value="">{{ $t('indexTable.typeSelect') }}</option>
                          <option value="index">index</option>
                          <option value="unique">unique</option>
                        </select>
                        <input class="form-input" placeholder="name" :value="store.getIndexOverrideValue(index, 'postgresql', 'name')" @input="store.setIndexOverrideValue(index, 'postgresql', 'name', ($event.target as HTMLInputElement).value)">
                      </div>
                      <div class="db-override-group">
                        <div class="db-label">SQLite</div>
                        <select class="form-input" :value="store.getIndexOverrideValue(index, 'sqlite', 'type')" @input="store.setIndexOverrideValue(index, 'sqlite', 'type', ($event.target as HTMLSelectElement).value)">
                          <option value="">{{ $t('indexTable.typeSelect') }}</option>
                          <option value="index">index</option>
                          <option value="unique">unique</option>
                        </select>
                        <input class="form-input" placeholder="name" :value="store.getIndexOverrideValue(index, 'sqlite', 'name')" @input="store.setIndexOverrideValue(index, 'sqlite', 'name', ($event.target as HTMLInputElement).value)">
                      </div>
                    </div>
                  </div>
                  <div class="expand-section">
                    <div class="expand-section-title">{{ $t('indexTable.preComment') }}</div>
                    <input class="form-input" v-model="index.pre_comment" :placeholder="$t('indexTable.preCommentPlaceholder')">
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <div v-else style="padding: 14px; color: #aaa; font-size: 12px; text-align: center;">
        {{ $t('indexTable.empty') }}
      </div>
    </div>
  </div>
</template>

<style scoped src="@/assets/style/section.css"></style>
<style scoped src="@/assets/style/table.css"></style>
<style scoped src="@/assets/style/form.css"></style>
<style scoped src="@/assets/style/btn.css"></style>
<style scoped src="@/assets/style/expand.css"></style>
<style scoped>
.indexes-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.indexes-table th,
.indexes-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-muted);
  text-align: left;
  vertical-align: middle;
}

.indexes-table th {
  background: var(--surface-2);
  font-weight: 600;
  color: var(--code-thumb);
  font-size: 11px;
  white-space: nowrap;
}

.indexes-table tbody tr:hover {
  background: var(--surface-2);
}

.table-input {
  padding: 3px 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-family: inherit;
  width: 100%;
  box-sizing: border-box;
}

.table-input:focus {
  outline: none;
  border-color: var(--accent);
}

/* 三段式索引名输入：{pre} 徽标 + 核心名 + {post} 徽标 */
.index-name-group {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 200px;
}

.index-name-affix {
  flex: none;
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--fg-subtle);
  border: 1px dashed var(--border);
  font-size: 11px;
  font-family: 'Consolas', 'Monaco', monospace;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
  opacity: 0.6;
}

.index-name-affix:hover {
  border-color: var(--accent);
  color: var(--accent);
  opacity: 1;
}

/* 启用态（蓝色实线）：会自动添加对应前/后缀；关闭态为灰色虚线 */
.index-name-affix.is-active {
  background: var(--accent-subtle);
  color: var(--accent);
  border-style: solid;
  border-color: var(--accent);
  opacity: 1;
}

.index-name-core {
  min-width: 90px;
}

/* 解析后名称预览（与 FieldTable 的解析类型预览保持一致） */
.resolved-type-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.resolved-type-row code {
  background: var(--accent-subtle);
  color: var(--fg);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-family: 'Consolas', 'Monaco', monospace;
}

.btn {
  padding: 4px 10px;
  border: 1px solid var(--border);
  background: #fff;
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}

.btn:hover {
  background: var(--surface-2);
}

.btn-primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-danger {
  color: var(--danger);
  border-color: var(--danger);
}

.btn-danger:hover {
  background: var(--danger-subtle);
}

.btn-sm {
  padding: 2px 6px;
  font-size: 11px;
}

</style>
