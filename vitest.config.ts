import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

// 仅用于 Vitest 单元测试（不接 jsdom，纯逻辑测试）。
// 别名复用 vite.config 的 '@' → src 映射。
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
})
