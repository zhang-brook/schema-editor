/**
 * 桌面外壳与渲染进程之间的桥接协议：IPC 通道名与请求/响应负载（主进程、preload、渲染端共用）。
 *
 * 渲染端通过 `window.schemaEditorDesktop` 访问桥接对象，据此模拟
 * File System Access API 的句柄语义；主进程提供文件系统原语、原生对话框与在线更新。
 */

/** IPC 通道名 */
export const DESKTOP_CHANNELS = {
  pickDirectory: 'desktop:pick-directory',
  listRecentFolders: 'desktop:list-recent-folders',
  openRecentFolder: 'desktop:open-recent-folder',
  removeRecentFolder: 'desktop:remove-recent-folder',
  readDir: 'desktop:read-dir',
  statKind: 'desktop:stat-kind',
  ensureDir: 'desktop:ensure-dir',
  readText: 'desktop:read-text',
  writeText: 'desktop:write-text',
  remove: 'desktop:remove',
  watchStart: 'desktop:watch-start',
  watchStop: 'desktop:watch-stop',
  watchEvent: 'desktop:watch-event',
  checkUpdate: 'desktop:check-update',
  getUpdateStatus: 'desktop:get-update-status',
  installUpdate: 'desktop:install-update',
  updateStatus: 'desktop:update-status',
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

/** 更新流程状态；`unsupported` 表示当前运行环境不做在线更新，`idle` 表示尚未检查 */
export type DesktopUpdateState =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'downloading'
  | 'ready'
  | 'failed'

export interface DesktopUpdateStatus {
  state: DesktopUpdateState
  /** 当前运行版本 */
  currentVersion: string
  /** 远端可用版本，`downloading` 及之后的状态才有 */
  availableVersion?: string
  /** 下载进度，0-100 */
  percent?: number
}

/** 渲染端可见的桥接对象 */
export interface DesktopBridge {
  /** 打开原生目录选择器；取消时返回 null */
  pickDirectory(): Promise<string | null>
  /** 最近打开过的项目文件夹，最新在前 */
  listRecentFolders(): Promise<string[]>
  /** 打开最近列表中的文件夹；目录已不存在时返回 null */
  openRecentFolder(path: string): Promise<string | null>
  /** 从最近列表移除，返回更新后的列表 */
  removeRecentFolder(path: string): Promise<string[]>
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
  /** 读取当前更新状态，不发起网络检查 */
  getUpdateStatus(): Promise<DesktopUpdateStatus>
  /** 发起一次更新检查；发现新版本随即开始下载，后续进度经 setUpdateHandler 推送 */
  checkUpdate(): Promise<DesktopUpdateStatus>
  /** 重启并安装已下载的更新；未下载完成时忽略 */
  installUpdate(): Promise<void>
  /** 注册唯一的更新状态回调 */
  setUpdateHandler(handler: (status: DesktopUpdateStatus) => void): void
}
