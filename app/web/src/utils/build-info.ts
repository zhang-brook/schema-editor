// Build metadata (injected by buildInfoPlugin in vite.config.ts; declared without a value for vitest compatibility)
declare const __APP_VERSION__: string | undefined
declare const __BUILD_TIME__: string | undefined
declare const __COMMIT_ID__: string | undefined

/** App version (taken from the repository root package.json) */
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''

/** Build timestamp (ISO 8601 UTC); in dev mode, the dev server start time */
export const BUILD_TIME: string = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : ''

/** Short hash of the Git commit the build was produced from */
export const COMMIT_ID: string = typeof __COMMIT_ID__ !== 'undefined' ? __COMMIT_ID__ : ''
