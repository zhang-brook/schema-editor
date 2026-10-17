import { mergeConfig, defineConfig } from 'vitest/config'
import viteConfig from './app/web/vite.config'

// 仅用于 Vitest 单元测试（不接 jsdom，纯逻辑测试）。
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['app/web/src/**/*.spec.ts', 'app/desktop/src/**/*.spec.ts', 'packages/core/src/**/*.spec.ts'],
    },
  }),
)
