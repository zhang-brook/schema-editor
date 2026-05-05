<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
</script>

<template>
  <!-- ===== Top Toolbar ===== -->
  <div class="toolbar">
    <span class="title">Schema Editor</span>

    <!-- Primary: Open Folder -->
    <button class="btn btn-primary" @click="store.openProject()">
      <span class="btn-icon">&#128193;&#xFE0E;</span> Open Folder
    </button>

    <span v-if="store.projectOpened" class="sync-badge" title="编辑内容实时同步到本地文件">
      &#128190;&#xFE0E; Auto-saving to disk
    </span>

    <button
      v-if="store.projectOpened"
      class="btn btn-reload"
      title="放弃网页中的修改，从本地文件重新加载"
      @click="store.reloadFromDisk()"
    >
      &#8635;&#xFE0E; Reload from Disk
    </button>
  </div>
</template>

<style scoped>
/* ===== Top Toolbar ===== */
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: #fff;
  border-bottom: 1px solid #ddd;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.toolbar .title {
  font-size: 15px;
  font-weight: 600;
  color: #4a90d9;
  margin-right: 16px;
  white-space: nowrap;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  color: #333;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all .15s;
}

.btn:hover {
  background: #e8e8e8;
  border-color: #aaa;
}

.btn-primary {
  background: #4a90d9;
  color: #fff;
  border-color: #4a90d9;
  /* padding: 5px 16px; */
  font-weight: 500;
}

.btn-primary:hover {
  background: #3a7bc8;
  border-color: #3a7bc8;
}

.btn-icon {
  font-size: 14px;
  line-height: 1;
}

.sync-badge {
  font-size: 11px;
  /* color: #888; */
  display: inline-flex;
  align-items: center;
  gap: 3px;
  opacity: 0.618;
}

.btn-reload {
  margin-left: auto;
}
</style>
