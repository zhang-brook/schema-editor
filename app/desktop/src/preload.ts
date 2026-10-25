import { contextBridge, ipcRenderer } from 'electron'
import {
  DESKTOP_CHANNELS,
  DESKTOP_TITLE_BAR_ARG,
  type DesktopBridge,
  type DesktopTitleBarMode,
  type DesktopUpdateStatus,
  type DesktopWatchEvent,
} from 'schema-editor-bridge'

let watchHandler: ((event: DesktopWatchEvent) => void) | null = null
let updateHandler: ((status: DesktopUpdateStatus) => void) | null = null

const titleBarArg = process.argv.find(arg => arg.startsWith(DESKTOP_TITLE_BAR_ARG))
const titleBarMode: DesktopTitleBarMode =
  titleBarArg?.slice(DESKTOP_TITLE_BAR_ARG.length) === 'native' ? 'native' : 'integrated'

ipcRenderer.on(DESKTOP_CHANNELS.watchEvent, (_event, payload: DesktopWatchEvent) => {
  watchHandler?.(payload)
})

ipcRenderer.on(DESKTOP_CHANNELS.updateStatus, (_event, payload: DesktopUpdateStatus) => {
  updateHandler?.(payload)
})

const bridge: DesktopBridge = {
  titleBarMode,
  platform: process.platform,
  pickDirectory: () => ipcRenderer.invoke(DESKTOP_CHANNELS.pickDirectory),
  listRecentFolders: () => ipcRenderer.invoke(DESKTOP_CHANNELS.listRecentFolders),
  openRecentFolder: path => ipcRenderer.invoke(DESKTOP_CHANNELS.openRecentFolder, path),
  removeRecentFolder: path => ipcRenderer.invoke(DESKTOP_CHANNELS.removeRecentFolder, path),
  readDir: path => ipcRenderer.invoke(DESKTOP_CHANNELS.readDir, path),
  statKind: path => ipcRenderer.invoke(DESKTOP_CHANNELS.statKind, path),
  ensureDir: path => ipcRenderer.invoke(DESKTOP_CHANNELS.ensureDir, path),
  readText: path => ipcRenderer.invoke(DESKTOP_CHANNELS.readText, path),
  writeText: (path, content) => ipcRenderer.invoke(DESKTOP_CHANNELS.writeText, path, content),
  remove: (path, recursive) => ipcRenderer.invoke(DESKTOP_CHANNELS.remove, path, recursive),
  watchStart: path => ipcRenderer.invoke(DESKTOP_CHANNELS.watchStart, path),
  watchStop: id => ipcRenderer.invoke(DESKTOP_CHANNELS.watchStop, id),
  setWatchHandler: handler => {
    watchHandler = handler
  },
  getUpdateStatus: () => ipcRenderer.invoke(DESKTOP_CHANNELS.getUpdateStatus),
  checkUpdate: () => ipcRenderer.invoke(DESKTOP_CHANNELS.checkUpdate),
  installUpdate: () => ipcRenderer.invoke(DESKTOP_CHANNELS.installUpdate),
  setUpdateHandler: handler => {
    updateHandler = handler
  },
  getTitleBarModePreference: () => ipcRenderer.invoke(DESKTOP_CHANNELS.getTitleBarModePreference),
  setTitleBarMode: mode => ipcRenderer.invoke(DESKTOP_CHANNELS.setTitleBarMode, mode),
  setTitleBarOverlay: (color, symbolColor) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.setTitleBarOverlay, color, symbolColor),
  relaunch: () => ipcRenderer.invoke(DESKTOP_CHANNELS.relaunch),
}

contextBridge.exposeInMainWorld('schemaEditorDesktop', bridge)
