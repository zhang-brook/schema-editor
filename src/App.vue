<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
import { useDropFolder } from '@/composables/useDropFolder'
import EditorToolbar from '@/components/EditorToolbar.vue'
import OpenFolderArt from '@/components/icon/OpenFolderArt.vue'
import ProjectSettingsPanel from '@/components/ProjectSettingsPanel.vue'
import AddFieldModal from '@/components/modal/AddFieldModal.vue'
import ImportSqlModal from '@/components/modal/ImportSqlModal.vue'
import ConfirmModal from '@/components/modal/ConfirmModal.vue'
import UpgradingOverlay from '@/components/UpgradingOverlay.vue'
import { useConfirmState, resolveConfirm } from '@/composables/useConfirm'

const store = useEditorStore()
const { dragOver, onDragOver, onDragEnter, onDragLeave, onDrop } = useDropFolder()

// 全局确认弹窗：绑定 useConfirm 队列，供 confirmDialog()/alertDialog() 驱动
const confirmState = useConfirmState()
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
      <!-- 已打开文件夹：统一使用新版布局（左侧 tab 切换列 + 右侧页面） -->
      <ProjectSettingsPanel v-if="store.projectOpened" />

      <!-- 未打开文件夹：直接提示打开，点击空白区域即可弹出打开文件夹对话框 -->
      <div v-else class="app-not-opened" @click="store.openProject()">
        <OpenFolderArt style="margin-bottom: 3.14rem;" />
        <p>{{ $t('app.notOpened') }}</p>
      </div>
    </div>

    <!-- 添加字段弹窗 -->
    <AddFieldModal />

    <!-- 导入 SQL 弹窗 -->
    <ImportSqlModal />

    <!-- 全局唯一确认弹窗：绑定 useConfirm 队列，处理 confirmDialog()/alertDialog() 触发的全部确认/提示 -->
    <ConfirmModal
      :visible="confirmState.visible"
      :title="confirmState.title"
      :message="confirmState.message"
      :confirm-text="confirmState.confirmText"
      :cancel-text="confirmState.cancelText"
      :primary-confirm="confirmState.primaryConfirm"
      @confirm="resolveConfirm(true)"
      @cancel="resolveConfirm(false)"
    />

    <!-- 全局加载遮罩 -->
    <UpgradingOverlay v-if="store.overlayVisible" :text="store.overlayText" />

    <!-- Toast 通知 -->
    <div class="toast" :class="{ show: store.toastVisible }">{{ store.toastMsg }}</div>
  </div>
</template>

<!-- 全局基础样式 -->
<style src="@/assets/style/base.css"></style>

<style scoped src="@/assets/style/layout.css"></style>
<style scoped src="@/assets/style/toast.css"></style>

<style scoped>
/* ===== Drop Overlay (拖拽文件夹打开) ===== */
.drop-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(58, 114, 196, 0.08);
  border: 3px dashed var(--accent);
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
  gap: 14px;
  padding: 44px 64px;
  background: var(--surface);
  border: 1px solid var(--accent-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

.drop-overlay-icon {
  font-size: 52px;
  line-height: 1;
}

.drop-overlay-text {
  font-size: 16px;
  font-weight: 600;
  color: var(--accent);
}

/* ===== 未打开文件夹时的全局提示 ===== */
.app-not-opened {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 22px;
  color: var(--fg-muted);
  font-size: 14px;
  padding: 24px;
  text-align: center;
  cursor: pointer;
}
</style>
