import { defineConfig } from 'vite'

// The desktop shell only builds the main process and preload scripts (CJS, loaded directly by Electron);
// the renderer reuses the web build output (app/web builds into app/desktop/renderer) and is not bundled here.
//
// The two entries are built as two separate single-entry builds: a sandboxed preload cannot require extra files,
// so it must be self-contained and cannot share a common chunk with the main process.
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
        // electron is provided by the runtime; electron-updater is a production dependency shipped inside the asar, so it is not inlined into the main process bundle
        external: ['electron', 'electron-updater'],
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  }
})
