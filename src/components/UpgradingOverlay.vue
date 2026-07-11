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
  background: rgba(255, 255, 255, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 6000;
  backdrop-filter: blur(2px);
}

.upgrading-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 36px 56px;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.16);
}

.upgrading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(74, 144, 217, 0.2);
  border-top-color: #4a90d9;
  border-radius: 50%;
  animation: upgrading-spin 0.8s linear infinite;
}

.upgrading-text {
  font-size: 15px;
  font-weight: 600;
  color: #4a90d9;
}

@keyframes upgrading-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
