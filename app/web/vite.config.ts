import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import VueI18n from '@intlify/unplugin-vue-i18n/vite'

// The version lives only in the repo root package.json and is read at build time by both apps
function rootVersion(): string {
  const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  return version
}

// Read the short hash of the current Git commit (returns "unknown" outside a Git environment)
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

// Inject version, build time and Git commit id for the "About" dialog
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
  // Relative base: the output can be deployed under any path and loaded directly by the desktop shell via file://
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
