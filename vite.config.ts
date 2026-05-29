import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import VueI18n from '@intlify/unplugin-vue-i18n/vite'

// https://vite.dev/config/
export default defineConfig({
  // docs:
  // - GITHUB_ACTIONS: https://docs.github.com/zh/actions/reference/workflows-and-actions/variables
  // - GITHUB_REPOSITORY: https://docs.github.com/zh/codespaces/developing-in-a-codespace/default-environment-variables-for-your-codespace
  base: process.env.GITHUB_ACTIONS
    ? `/${process.env.GITHUB_REPOSITORY?.split('/')[1]}/`
    : '/',
  plugins: [
    vue(),
    vueDevTools(),
    VueI18n({}),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
})
