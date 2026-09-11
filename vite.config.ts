import { execSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import VueI18n from '@intlify/unplugin-vue-i18n/vite'

// 读取当前 Git 提交短哈希（非 Git 环境则返回 unknown）
function gitShortCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  }
  catch {
    return 'unknown'
  }
}

// 注入构建时间与 Git 提交 id，供「关于」弹窗展示
function buildInfoPlugin(): Plugin {
  return {
    name: 'schema-editor:build-info',
    config() {
      return {
        define: {
          __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
          __COMMIT_ID__: JSON.stringify(gitShortCommit()),
        },
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // docs:
  // - GITHUB_ACTIONS: https://docs.github.com/zh/actions/reference/workflows-and-actions/variables
  // - GITHUB_REPOSITORY: https://docs.github.com/zh/codespaces/developing-in-a-codespace/default-environment-variables-for-your-codespace
  base: process.env.GITHUB_ACTIONS
    ? `/${process.env.GITHUB_REPOSITORY?.split('/')[1]}/`
    : '/',
  server: {
    host: '0.0.0.0',
  },
  plugins: [
    buildInfoPlugin(),
    vue(),
    vueDevTools(),
    VueI18n({}),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
