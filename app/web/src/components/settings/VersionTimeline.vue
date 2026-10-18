<script setup lang="ts">
/**
 * Version timeline: displays version nodes in version-chain order; each segment between
 * adjacent nodes represents one migration.
 * A dashed segment means "there is no migration between adjacent versions yet"; click it to create one directly.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
const { t } = useI18n()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'create-migration', from: string, to: string): void
  (e: 'view-migration', id: string): void
}>()

const props = defineProps<{ activeId?: string | null }>()

const chain = computed(() => store.versionChain)

/**
 * Display order: newest → oldest.
 * Only the UI presentation order is reversed; the underlying version chain
 * (parent-child relationships, migration direction) stays as-is, so the newest
 * version is leftmost and visible without scrolling horizontally to the end.
 */
const displayVersions = computed(() => [...chain.value.versions].reverse())

/**
 * Get the connector to the right of the index-th "displayed node".
 * Display position index maps to original chain index n-1-index; the connector between
 * it and its right-hand node has index n-2-index.
 */
function segmentAfter(index: number) {
  const k = chain.value.versions.length - 2 - index
  return k >= 0 ? (chain.value.segments[k] ?? null) : null
}

/** Truncate ISO time to minutes to avoid long timestamps */
function shortTime(iso: string): string {
  return (iso ?? '').slice(0, 16).replace('T', ' ')
}

/** Rename: enter edit mode / commit / cancel */
const editingId = ref<string | null>(null)
const editingName = ref('')

/** Enter rename mode: prefill the current name and focus the input */
function startRename(v: { id: string; name: string }) {
  editingId.value = v.id
  editingName.value = v.name
}

/** Commit the rename (triggered by blur or Enter); the editingId guard prevents duplicate submits */
function commitRename(id: string) {
  if (editingId.value !== id) return
  const name = editingName.value
  editingId.value = null
  void store.renameVersion(id, name)
}

/** Cancel the rename (Esc) */
function cancelRename() {
  editingId.value = null
}

/** Automatically focus the input after entering edit mode */
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
      <li v-for="(v, i) in displayVersions" :key="v.id" class="tl-item">
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
            <span class="tl-link-label">{{ t('version.chainGapLabel') }}</span>
            <span class="tl-link-line" />
          </button>
          <button
            v-else
            class="tl-link is-migration"
            :title="t('version.chainViewMigrationTip', { name: segmentAfter(i)!.migration!.name })"
            @click="emit('view-migration', segmentAfter(i)!.migration!.id)"
          >
            <span class="tl-link-label">{{ t('version.chainViewMigration') }}</span>
            <span class="tl-link-line" />
          </button>
        </template>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.tl {
  padding: 10px 16px 4px;
  border-bottom: 1px solid var(--border);
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
  color: var(--fg);
}

.tl-gap-hint {
  color: var(--warning);
}

.tl-branch-hint {
  color: var(--fg-muted);
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
  border: 1px solid var(--border-muted);
  border-radius: 6px;
  background: var(--surface);
  cursor: pointer;
  font: inherit;
  color: var(--fg);
  transition: border-color .12s ease, background .12s ease;
}

.tl-node:hover {
  border-color: var(--border-strong);
  background: var(--surface-3);
}

.tl-node.active {
  border-color: var(--accent);
  background: var(--accent-subtle);
}

.tl-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 2px var(--surface);
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
  color: var(--fg-muted);
  opacity: 0;
  transition: opacity .12s ease;
}

.tl-node:hover .tl-rename,
.tl-rename:focus {
  opacity: 1;
}

.tl-rename:hover {
  color: var(--accent);
}

.tl-name-input {
  width: 92px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  padding: 1px 4px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  box-sizing: border-box;
}

.tl-date {
  font-size: 11px;
  color: var(--fg-muted);
  white-space: nowrap;
}

/* Connector between versions: a horizontal line with an arrow; the action label floats centered above the line */
.tl-link {
  position: relative;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  width: 76px;
  height: 28px;
  padding: 0 8px;
  border: none;
  background: transparent;
  cursor: default;
}

.tl-link.is-gap,
.tl-link.is-migration {
  cursor: pointer;
}

.tl-link-line {
  position: relative;
  flex: 1;
  height: 2px;
  background: var(--accent);
}

/* Arrow on the left end, pointing to the left (older) version */
.tl-link-line::before {
  content: '';
  position: absolute;
  right: 100%;
  top: 50%;
  transform: translateY(-50%);
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-right: 6px solid var(--accent);
}

.tl-link.is-gap .tl-link-line {
  background: repeating-linear-gradient(to right, var(--warning) 0 5px, transparent 5px 10px);
}

.tl-link.is-gap .tl-link-line::before {
  border-right-color: var(--warning);
}

.tl-link-label {
  position: absolute;
  left: 50%;
  top: 0;
  transform: translateX(-50%);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  color: var(--warning);
}

.tl-link.is-gap:hover .tl-link-label {
  font-weight: 700;
}

.tl-link.is-migration .tl-link-label {
  color: var(--accent);
}

.tl-link.is-migration:hover .tl-link-label {
  font-weight: 700;
  text-decoration: underline;
}
</style>
