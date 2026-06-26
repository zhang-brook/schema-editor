<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
import { useDropFolder } from '@/composables/useDropFolder'
import EditorToolbar from '@/components/EditorToolbar.vue'
import EditorSidebar from '@/components/EditorSidebar.vue'
import CommonConfigPanel from '@/components/CommonConfigPanel.vue'
import SchemaConfigPanel from '@/components/SchemaConfigPanel.vue'
import TableEditor from '@/components/TableEditor.vue'
import AddFieldModal from '@/components/AddFieldModal.vue'
import ImportSqlModal from '@/components/ImportSqlModal.vue'

const store = useEditorStore()
const { dragOver, onDragOver, onDragEnter, onDragLeave, onDrop } = useDropFolder()
</script>

<template>
  <div class="app-container" @dragover="onDragOver" @dragenter="onDragEnter" @dragleave="onDragLeave" @drop="onDrop">
    <!-- 拖拽文件夹时的视觉覆盖层 -->
    <div v-if="dragOver" class="drop-overlay">
      <div class="drop-overlay-box">
        <span class="drop-overlay-icon">&#128193;</span>
        <span class="drop-overlay-text">{{ $t('app.dropHint') }}</span>
      </div>
    </div>
    <!-- 顶部工具栏 -->
    <EditorToolbar />

    <div class="main-layout">
      <!-- 左侧导航 -->
      <EditorSidebar />

      <!-- 右侧内容区 -->
      <div class="content">
        <!-- Common 配置面板 -->
        <CommonConfigPanel v-if="store.showCommonPanel && store.commonConfig" />

        <!-- Schema 配置面板 -->
        <SchemaConfigPanel v-else-if="store.currentSchema && store.selectedTableIdx === -1" />

        <!-- 表编辑面板 -->
        <TableEditor v-else-if="store.currentTable" />

        <!-- 空状态 -->
        <div v-else class="global-empty-state">
          <p>{{ $t('app.emptyState') }}</p>
        </div>
      </div>
    </div>

    <!-- 添加字段弹窗 -->
    <AddFieldModal />

    <!-- 导入 SQL 弹窗 -->
    <ImportSqlModal />

    <!-- Toast 通知 -->
    <div class="toast" :class="{ show: store.toastVisible }">{{ store.toastMsg }}</div>
  </div>
</template>

<style scoped>
/* ===== Drop Overlay (拖拽文件夹打开) ===== */
.drop-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(74, 144, 217, 0.12);
  border: 3px dashed #4a90d9;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5000;
  pointer-events: none;
}

.drop-overlay-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 60px;
  background: rgba(255, 255, 255, 0.92);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
}

.drop-overlay-icon {
  font-size: 48px;
  line-height: 1;
}

.drop-overlay-text {
  font-size: 16px;
  font-weight: 600;
  color: #4a90d9;
}
</style>
