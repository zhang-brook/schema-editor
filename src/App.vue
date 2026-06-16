<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
import EditorToolbar from '@/components/EditorToolbar.vue'
import EditorSidebar from '@/components/EditorSidebar.vue'
import CommonConfigPanel from '@/components/CommonConfigPanel.vue'
import TableEditor from '@/components/TableEditor.vue'
import AddFieldModal from '@/components/AddFieldModal.vue'
import ImportSqlModal from '@/components/ImportSqlModal.vue'

const store = useEditorStore()
</script>

<template>
  <div class="app-container">
    <!-- 顶部工具栏 -->
    <EditorToolbar />

    <div class="main-layout">
      <!-- 左侧导航 -->
      <EditorSidebar />

      <!-- 右侧内容区 -->
      <div class="content">
        <!-- Common 配置面板 -->
        <CommonConfigPanel v-if="store.showCommonPanel && store.commonConfig" />

        <!-- 表编辑面板 -->
        <TableEditor v-else-if="store.currentTable" />

        <!-- 空状态 -->
        <div v-else class="empty-state">
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
