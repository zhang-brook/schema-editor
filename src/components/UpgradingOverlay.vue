<script setup lang="ts">
defineProps<{ text?: string }>()
</script>

<template>
  <div class="upgrading-overlay">
    <div class="upgrading-box">
      <span class="upgrading-spinner"></span>
      <span v-if="text" class="upgrading-text">{{ text }}</span>
    </div>
  </div>
</template>

<style scoped>
.upgrading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: color-mix(in srgb, var(--surface) 75%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  /* 低于 .modal-overlay(1000)：加载期间若弹出确认框，弹窗必须可点 */
  z-index: 900;
  backdrop-filter: blur(2px);
}

.upgrading-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 36px 56px;
  background: var(--surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}

.upgrading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid var(--accent-border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: upgrading-spin 0.8s linear infinite;
}

.upgrading-text {
  font-size: 15px;
  font-weight: 600;
  color: var(--accent);
}

@keyframes upgrading-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
