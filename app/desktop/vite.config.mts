import { defineConfig } from 'vite'

// 桌面外壳只构建主进程与 preload 脚本（CJS，供 Electron 直接加载）；
// 渲染层直接复用前端构建产物（app/web 构建到 app/desktop/renderer），不在此处打包。
//
// 两个入口分两次单入口构建：沙箱化的 preload 无法 require 额外文件，
// 必须自包含，因此不能与主进程共享公共 chunk。
const ENTRIES = {
  main: { name: 'main', path: 'src/main.ts' },
  preload: { name: 'preload', path: 'src/preload.ts' },
} as const

export default defineConfig(({ mode }) => {
  const entry = ENTRIES[mode as keyof typeof ENTRIES] ?? ENTRIES.main
  return {
    build: {
      outDir: 'dist',
      emptyOutDir: entry.name === 'main',
      minify: false,
      ssr: true,
      target: 'node22',
      rollupOptions: {
        input: { [entry.name]: entry.path },
        external: ['electron'],
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  }
})
