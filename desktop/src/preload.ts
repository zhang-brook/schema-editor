import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_CHANNELS, type DesktopBridge, type DesktopWatchEvent } from '../../src/platform/bridge'

let watchHandler: ((event: DesktopWatchEvent) => void) | null = null

ipcRenderer.on(DESKTOP_CHANNELS.watchEvent, (_event, payload: DesktopWatchEvent) => {
  watchHandler?.(payload)
})

const bridge: DesktopBridge = {
  pickDirectory: () => ipcRenderer.invoke(DESKTOP_CHANNELS.pickDirectory),
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
}

contextBridge.exposeInMainWorld('schemaEditorDesktop', bridge)
