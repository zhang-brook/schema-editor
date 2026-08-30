import { mergeConfig, defineConfig } from 'vitest/config'
import viteConfig from './vite.config'

// 仅用于 Vitest 单元测试（不接 jsdom，纯逻辑测试）。
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.spec.ts'],
    },
  }),
)
