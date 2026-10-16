/**
 * 桌面外壳与渲染进程之间的桥接协议：IPC 通道名与请求/响应负载（主进程、preload、渲染端共用）。
 *
 * 渲染端通过 `window.schemaEditorDesktop` 访问桥接对象，据此模拟
 * File System Access API 的句柄语义；主进程只提供文件系统原语与原生对话框。
 */

/** IPC 通道名 */
export const DESKTOP_CHANNELS = {
  pickDirectory: 'desktop:pick-directory',
  readDir: 'desktop:read-dir',
  statKind: 'desktop:stat-kind',
  ensureDir: 'desktop:ensure-dir',
  readText: 'desktop:read-text',
  writeText: 'desktop:write-text',
  remove: 'desktop:remove',
  watchStart: 'desktop:watch-start',
  watchStop: 'desktop:watch-stop',
  watchEvent: 'desktop:watch-event',
} as const

/** 条目类型（与 FileSystemHandle.kind 对齐） */
export type DesktopEntryKind = 'file' | 'directory'

/** 归一化后的文件系统错误代码 */
export type DesktopFsErrorCode = 'ENOENT' | 'EISDIR' | 'ENOTEMPTY' | 'EPERM' | 'EACCES' | 'UNKNOWN'

export type DesktopFsResult<T> = { ok: true; value: T } | { ok: false; code: DesktopFsErrorCode }

export interface DesktopDirEntry {
  name: string
  kind: DesktopEntryKind
}

export interface DesktopWatchEvent {
  id: number
  /** 相对被监听目录的路径，统一以 '/' 分隔 */
  relativePath: string
}

/** 渲染端可见的桥接对象 */
export interface DesktopBridge {
  /** 打开原生目录选择器；取消时返回 null */
  pickDirectory(): Promise<string | null>
  readDir(path: string): Promise<DesktopFsResult<DesktopDirEntry[]>>
  /** 路径不存在时 value 为 null */
  statKind(path: string): Promise<DesktopFsResult<DesktopEntryKind | null>>
  ensureDir(path: string): Promise<DesktopFsResult<null>>
  readText(path: string): Promise<DesktopFsResult<string>>
  writeText(path: string, content: string): Promise<DesktopFsResult<null>>
  remove(path: string, recursive: boolean): Promise<DesktopFsResult<null>>
  /** 开始监听目录（递归），返回监听 id */
  watchStart(path: string): Promise<DesktopFsResult<number>>
  watchStop(id: number): Promise<DesktopFsResult<null>>
  /** 注册唯一的事件回调，事件来自所有活动监听 */
  setWatchHandler(handler: (event: DesktopWatchEvent) => void): void
}
