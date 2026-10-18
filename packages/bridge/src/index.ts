/**
 * Bridge protocol between the desktop shell and the renderer process: IPC channel names and request/response payloads (shared by the main process, preload and renderer).
 *
 * The renderer accesses the bridge via `window.schemaEditorDesktop` to emulate
 * File System Access API handle semantics; the main process provides filesystem primitives, native dialogs and online updates.
 */

/** IPC channel names */
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

/** Entry kind (aligned with FileSystemHandle.kind) */
export type DesktopEntryKind = 'file' | 'directory'

/** Normalized filesystem error codes */
export type DesktopFsErrorCode = 'ENOENT' | 'EISDIR' | 'ENOTEMPTY' | 'EPERM' | 'EACCES' | 'UNKNOWN'

export type DesktopFsResult<T> = { ok: true; value: T } | { ok: false; code: DesktopFsErrorCode }

export interface DesktopDirEntry {
  name: string
  kind: DesktopEntryKind
}

export interface DesktopWatchEvent {
  id: number
  /** Path relative to the watched directory, always separated by '/' */
  relativePath: string
}

/** Update flow state; `unsupported` means online updates are disabled in the current environment, `idle` means no check has run yet */
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
  /** Currently running version */
  currentVersion: string
  /** Version available remotely; only present from `downloading` onward */
  availableVersion?: string
  /** Download progress, 0-100 */
  percent?: number
}

/** Bridge object exposed to the renderer */
export interface DesktopBridge {
  /** Opens the native directory picker; returns null when cancelled */
  pickDirectory(): Promise<string | null>
  /** Recently opened project folders, newest first */
  listRecentFolders(): Promise<string[]>
  /** Opens a folder from the recent list; returns null when the directory no longer exists */
  openRecentFolder(path: string): Promise<string | null>
  /** Removes a folder from the recent list and returns the updated list */
  removeRecentFolder(path: string): Promise<string[]>
  readDir(path: string): Promise<DesktopFsResult<DesktopDirEntry[]>>
  /** value is null when the path does not exist */
  statKind(path: string): Promise<DesktopFsResult<DesktopEntryKind | null>>
  ensureDir(path: string): Promise<DesktopFsResult<null>>
  readText(path: string): Promise<DesktopFsResult<string>>
  writeText(path: string, content: string): Promise<DesktopFsResult<null>>
  remove(path: string, recursive: boolean): Promise<DesktopFsResult<null>>
  /** Starts watching a directory (recursively) and returns the watch id */
  watchStart(path: string): Promise<DesktopFsResult<number>>
  watchStop(id: number): Promise<DesktopFsResult<null>>
  /** Registers the single event callback; events come from all active watches */
  setWatchHandler(handler: (event: DesktopWatchEvent) => void): void
  /** Reads the current update status without triggering a network check */
  getUpdateStatus(): Promise<DesktopUpdateStatus>
  /** Starts one update check; when a new version is found the download begins and progress is pushed via setUpdateHandler */
  checkUpdate(): Promise<DesktopUpdateStatus>
  /** Restarts and installs the downloaded update; ignored when the download has not finished */
  installUpdate(): Promise<void>
  /** Registers the single update status callback */
  setUpdateHandler(handler: (status: DesktopUpdateStatus) => void): void
}
