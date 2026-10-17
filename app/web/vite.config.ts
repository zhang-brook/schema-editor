import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import VueI18n from '@intlify/unplugin-vue-i18n/vite'

// 版本号只在仓库根 package.json 维护，两端构建期取用
function rootVersion(): string {
  const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  return version
}

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

// 注入版本号、构建时间与 Git 提交 id，供「关于」弹窗展示
function buildInfoPlugin(): Plugin {
  return {
    name: 'schema-editor:build-info',
    config() {
      return {
        define: {
          __APP_VERSION__: JSON.stringify(rootVersion()),
          __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
          __COMMIT_ID__: JSON.stringify(gitShortCommit()),
        },
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // 相对基址：产物可部署在任意路径下，也可被桌面外壳以 file:// 直接加载
  base: './',
  server: {
    host: '0.0.0.0',
    port: 6842,
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
