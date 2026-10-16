// 构建元信息（由 vite.config.ts 中 buildInfoPlugin 注入，类型上无值声明以兼容 vitest）
declare const __BUILD_TIME__: string | undefined
declare const __COMMIT_ID__: string | undefined

/** 构建时刻（ISO 8601 UTC），开发模式下为 dev server 启动时刻 */
export const BUILD_TIME: string = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : ''

/** 构建时所在 Git 提交短哈希 */
export const COMMIT_ID: string = typeof __COMMIT_ID__ !== 'undefined' ? __COMMIT_ID__ : ''
