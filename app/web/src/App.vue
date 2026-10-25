<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
import { useDropFolder } from '@/composables/useDropFolder'
import EditorToolbar from '@/components/EditorToolbar.vue'
import OpenFolderArt from '@/components/icon/OpenFolderArt.vue'
import ProjectSettingsPanel from '@/components/settings/SettingsPanel.vue'
import AddFieldModal from '@/components/modal/AddFieldModal.vue'
import ImportSqlModal from '@/components/modal/ImportSqlModal.vue'
import OpenGitRepoModal from '@/components/modal/OpenGitRepoModal.vue'
import CommitDialog from '@/components/modal/CommitDialog.vue'
import ConfirmModal from '@/components/modal/ConfirmModal.vue'
import UpgradingOverlay from '@/components/UpgradingOverlay.vue'
import { useConfirmState, resolveConfirm } from '@/composables/useConfirm'
import { useWindowChrome } from '@/composables/useWindowChrome'

const store = useEditorStore()
const { dragOver, onDragOver, onDragEnter, onDragLeave, onDrop } = useDropFolder()

useWindowChrome()

// Global confirm dialog: binds the useConfirm queue, driven by confirmDialog()/alertDialog()
const confirmState = useConfirmState()
</script>

<template>
  <div class="app-container" @dragover="onDragOver" @dragenter="onDragEnter" @dragleave="onDragLeave" @drop="onDrop">
    <!-- Visual overlay while dragging a folder -->
    <div v-if="dragOver" class="drop-overlay">
      <div class="drop-overlay-box">
        <span class="drop-overlay-icon">&#128193;</span>
        <span class="drop-overlay-text">{{ $t('app.dropHint') }}</span>
      </div>
    </div>
    <!-- Top toolbar -->
    <EditorToolbar />

    <div class="main-layout">
      <!-- Folder opened: always use the new layout (tab column switcher on the left + page on the right) -->
      <ProjectSettingsPanel v-if="store.projectOpened" />

      <!-- No folder opened: prompt to open one; clicking the empty area opens the folder dialog -->
      <div v-else class="app-not-opened" @click="store.openProject()">
        <OpenFolderArt style="margin-bottom: 3.14rem;" />
        <p>{{ $t('app.notOpened') }}</p>
      </div>
    </div>

    <!-- Add field modal -->
    <AddFieldModal />

    <!-- Import SQL modal -->
    <ImportSqlModal />

    <!-- Open Git repository modal -->
    <OpenGitRepoModal />

    <!-- Git commit dialog (collects commit info on manual save) -->
    <CommitDialog />

    <!-- Single global confirm dialog: binds the useConfirm queue and handles every confirm/alert prompt raised by confirmDialog()/alertDialog() -->
    <ConfirmModal
      :visible="confirmState.visible"
      :title="confirmState.title"
      :message="confirmState.message"
      :confirm-text="confirmState.confirmText"
      :secondary-text="confirmState.secondaryText"
      :cancel-text="confirmState.cancelText"
      :primary-confirm="confirmState.primaryConfirm"
      @confirm="resolveConfirm('confirm')"
      @secondary="resolveConfirm('secondary')"
      @cancel="resolveConfirm('cancel')"
    />

    <!-- Global loading overlay -->
    <UpgradingOverlay v-if="store.overlayVisible" :text="store.overlayText" />

    <!-- Toast notifications -->
    <div class="toast" :class="{ show: store.toastVisible }">{{ store.toastMsg }}</div>
  </div>
</template>

<!-- Global base styles -->
<style src="@/assets/style/base.css"></style>
<style src="@/assets/style/menu.css"></style>
<style src="@/assets/style/popover.css"></style>

<style scoped src="@/assets/style/layout.css"></style>
<style scoped src="@/assets/style/toast.css"></style>

<style scoped>
/* ===== Drop Overlay (open folder by dragging) ===== */
.drop-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--accent-subtle-2);
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

/* ===== Global hint when no folder is open ===== */
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
