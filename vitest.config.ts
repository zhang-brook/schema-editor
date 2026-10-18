import { mergeConfig, defineConfig } from 'vitest/config'
import viteConfig from './app/web/vite.config'

// Vitest unit tests only (no jsdom, pure logic).
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['app/web/src/**/*.spec.ts', 'app/desktop/src/**/*.spec.ts', 'packages/core/src/**/*.spec.ts'],
    },
  }),
)
