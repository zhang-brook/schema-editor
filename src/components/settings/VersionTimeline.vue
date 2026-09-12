<script setup lang="ts">
/**
 * 版本时间轴：按版本链顺序展示版本节点，节点之间的一段代表一次迁移。
 * 虚线段表示「相邻版本之间还没有迁移」，点击可直接补建。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
const { t } = useI18n()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'create-migration', from: string, to: string): void
}>()

const props = defineProps<{ activeId?: string | null }>()

const chain = computed(() => store.versionChain)

/** 取第 i 个节点之后的那一段连接（i 为最后一个节点时无） */
function segmentAfter(index: number) {
  return chain.value.segments[index] ?? null
}

/** ISO 时间截取到分钟，避免长串时间戳 */
function shortTime(iso: string): string {
  return (iso ?? '').slice(0, 16).replace('T', ' ')
}

/** 改名：进入编辑态 / 提交 / 取消 */
const editingId = ref<string | null>(null)
const editingName = ref('')

/** 进入改名态：回填当前名称并聚焦输入框 */
function startRename(v: { id: string; name: string }) {
  editingId.value = v.id
  editingName.value = v.name
}

/** 提交改名（失焦或回车触发）；editingId 守卫避免重复提交 */
function commitRename(id: string) {
  if (editingId.value !== id) return
  const name = editingName.value
  editingId.value = null
  void store.renameVersion(id, name)
}

/** 取消改名（Esc） */
function cancelRename() {
  editingId.value = null
}

/** 进入编辑态后自动聚焦输入框 */
const vFocus = {
  mounted: (el: Element) => (el as HTMLInputElement).focus(),
}
</script>

<template>
  <div v-if="chain.versions.length > 0" class="tl">
    <div class="tl-bar">
      <span class="tl-title">{{ t('version.timeline') }}</span>
      <span v-if="chain.gaps.length > 0" class="tl-gap-hint">
        {{ t('version.chainGapHint', { n: chain.gaps.length }) }}
      </span>
      <span v-if="chain.branched" class="tl-branch-hint">{{ t('version.chainBranched') }}</span>
    </div>

    <ol class="tl-track">
      <li v-for="(v, i) in chain.versions" :key="v.id" class="tl-item">
        <div
          class="tl-node"
          :class="{ active: props.activeId === v.id }"
          :title="v.created_at"
          @click="emit('select', v.id)"
        >
          <span class="tl-dot" />
          <div class="tl-name-row">
            <template v-if="editingId === v.id">
              <input
                class="tl-name-input"
                v-model="editingName"
                v-focus
                @click.stop
                @keyup.enter="commitRename(v.id)"
                @keyup.esc="cancelRename"
                @blur="commitRename(v.id)"
              />
            </template>
            <template v-else>
              <span class="tl-name">{{ v.name }}</span>
              <button class="tl-rename" :title="t('version.rename')" @click.stop="startRename(v)">✎</button>
            </template>
          </div>
          <span class="tl-date">{{ shortTime(v.created_at) }}</span>
        </div>

        <template v-if="segmentAfter(i)">
          <button
            v-if="!segmentAfter(i)!.migration"
            class="tl-link is-gap"
            :title="t('version.chainCreateMigration')"
            @click="emit('create-migration', segmentAfter(i)!.from.id, segmentAfter(i)!.to.id)"
          >
            <span class="tl-link-line" />
            <span class="tl-link-label">＋</span>
          </button>
          <span v-else class="tl-link" :title="segmentAfter(i)!.migration!.name">
            <span class="tl-link-line" />
          </span>
        </template>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.tl {
  padding: 10px 16px 4px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}

.tl-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  font-size: 12px;
}

.tl-title {
  font-weight: 600;
  color: var(--text-primary, #111827);
}

.tl-gap-hint {
  color: #b45309;
}

.tl-branch-hint {
  color: var(--text-secondary, #6b7280);
}

.tl-track {
  display: flex;
  align-items: flex-start;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-x: auto;
}

.tl-item {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
}

.tl-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  font: inherit;
  color: var(--text-primary, #111827);
}

.tl-node:hover {
  background: var(--hover-bg, #f3f4f6);
}

.tl-node.active {
  border-color: var(--primary-color, #2563eb);
  background: var(--primary-soft, #eff6ff);
}

.tl-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--primary-color, #2563eb);
}

.tl-name {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.tl-name-row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tl-rename {
  position: absolute;
  left: 100%;
  top: 50%;
  transform: translateY(-50%);
  margin-left: 2px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 0 2px;
  color: var(--text-secondary, #6b7280);
  opacity: 0;
  transition: opacity .12s ease;
}

.tl-node:hover .tl-rename,
.tl-rename:focus {
  opacity: 1;
}

.tl-rename:hover {
  color: var(--primary-color, #2563eb);
}

.tl-name-input {
  width: 92px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  padding: 1px 4px;
  border: 1px solid var(--primary-color, #2563eb);
  border-radius: 4px;
  box-sizing: border-box;
}

.tl-date {
  font-size: 11px;
  color: var(--text-secondary, #6b7280);
  white-space: nowrap;
}

.tl-link {
  display: flex;
  align-items: center;
  width: 56px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: default;
}

.tl-link.is-gap {
  cursor: pointer;
}

.tl-link-line {
  flex: 1;
  height: 2px;
  background: var(--primary-color, #2563eb);
}

.tl-link.is-gap .tl-link-line {
  background: repeating-linear-gradient(to right, #b45309 0 5px, transparent 5px 10px);
}

.tl-link-label {
  margin-left: 4px;
  font-size: 12px;
  color: #b45309;
}

.tl-link.is-gap:hover .tl-link-label {
  font-weight: 700;
}
</style>
