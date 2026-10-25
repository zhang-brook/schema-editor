import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { autoUpdater } from 'electron-updater'
import { DESKTOP_CHANNELS, DESKTOP_TITLE_BAR_ARG, type DesktopUpdateStatus } from 'schema-editor-bridge'
import { createFsService } from './fs-service'
import { createRecentFolders, type RecentFolders } from './recent-folders'
import { createUiPreferences, type UiPreferencesStore } from './ui-preferences'
import { createUpdater } from './updater'
import {
  defaultOverlay,
  frameOptions,
  getWindowChrome,
  setWindowChrome,
  TITLE_BAR_OVERLAY_HEIGHT,
  updateOverlayColors,
} from './window-chrome'

const DEV_SERVER_URL = 'http://localhost:6842'
const DEV_SERVER_RETRIES = 120

const fsService = createFsService()

autoUpdater.autoInstallOnAppQuit = false

/** Push update status to all windows that have not been destroyed */
function publishUpdateStatus(status: DesktopUpdateStatus): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(DESKTOP_CHANNELS.updateStatus, status)
  }
}

const updater = createUpdater(
  {
    // A portable exe cannot overwrite itself; macOS rejects unsigned updates, so enable after signing
    updateSupported:
      app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR && process.platform !== 'darwin',
    currentVersion: app.getVersion(),
    checkForUpdates: () => autoUpdater.checkForUpdates(),
    quitAndInstall: () => autoUpdater.quitAndInstall(),
    onUpdateAvailable: listener => autoUpdater.on('update-available', info => listener(info.version)),
    onUpdateNotAvailable: listener => autoUpdater.on('update-not-available', () => listener()),
    onDownloadProgress: listener => autoUpdater.on('download-progress', info => listener(info.percent)),
    onDownloaded: listener => autoUpdater.on('update-downloaded', info => listener(info.version)),
    onError: listener => autoUpdater.on('error', error => listener(error)),
  },
  publishUpdateStatus,
)

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory()
  } catch {
    return false
  }
}

function registerIpcHandlers(recentFolders: RecentFolders, uiPreferences: UiPreferencesStore): void {
  ipcMain.handle(DESKTOP_CHANNELS.pickDirectory, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
    // Default to the last opened folder; fall back to the system default if it was deleted
    const lastFolder = await recentFolders.mostRecent()
    if (lastFolder && await isDirectory(lastFolder)) options.defaultPath = lastFolder
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    const picked = result.canceled ? undefined : result.filePaths[0]
    if (!picked) return null
    const root = fsService.allowRoot(picked)
    await recentFolders.add(root)
    return root
  })

  ipcMain.handle(DESKTOP_CHANNELS.listRecentFolders, () => recentFolders.list())
  ipcMain.handle(DESKTOP_CHANNELS.openRecentFolder, async (_event, target: string) => {
    if (typeof target !== 'string' || !(await isDirectory(target))) return null
    const root = fsService.allowRoot(target)
    await recentFolders.add(root)
    return root
  })
  ipcMain.handle(DESKTOP_CHANNELS.removeRecentFolder, (_event, target: string) => recentFolders.remove(target))

  ipcMain.handle(DESKTOP_CHANNELS.readDir, (_event, target: string) => fsService.readDir(target))
  ipcMain.handle(DESKTOP_CHANNELS.statKind, (_event, target: string) => fsService.statKind(target))
  ipcMain.handle(DESKTOP_CHANNELS.ensureDir, (_event, target: string) => fsService.ensureDir(target))
  ipcMain.handle(DESKTOP_CHANNELS.readText, (_event, target: string) => fsService.readText(target))
  ipcMain.handle(DESKTOP_CHANNELS.writeText, (_event, target: string, content: string) => fsService.writeText(target, content))
  ipcMain.handle(DESKTOP_CHANNELS.remove, (_event, target: string, recursive: boolean) => fsService.remove(target, recursive))

  ipcMain.handle(DESKTOP_CHANNELS.watchStart, (event, target: string) =>
    fsService.watchStart(target, payload => {
      if (!event.sender.isDestroyed()) event.sender.send(DESKTOP_CHANNELS.watchEvent, payload)
    }),
  )
  ipcMain.handle(DESKTOP_CHANNELS.watchStop, (_event, id: number) => fsService.watchStop(id))

  ipcMain.handle(DESKTOP_CHANNELS.getUpdateStatus, () => updater.status())
  ipcMain.handle(DESKTOP_CHANNELS.checkUpdate, () => updater.check())
  ipcMain.handle(DESKTOP_CHANNELS.installUpdate, () => updater.install())

  ipcMain.handle(DESKTOP_CHANNELS.getTitleBarModePreference, async () => {
    return (await uiPreferences.load()).titleBarMode
  })

  ipcMain.handle(DESKTOP_CHANNELS.setTitleBarMode, async (_event, mode: unknown) => {
    if (mode !== 'integrated' && mode !== 'native') return
    await uiPreferences.setTitleBarMode(mode)
  })

  ipcMain.handle(DESKTOP_CHANNELS.setTitleBarOverlay, (event, color: unknown, symbolColor: unknown) => {
    if (typeof color !== 'string' || typeof symbolColor !== 'string') return
    updateOverlayColors(color, symbolColor)
    if (process.platform === 'darwin' || getWindowChrome().titleBarMode !== 'integrated') return
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed()) return
    try {
      window.setTitleBarOverlay({ color, symbolColor, height: TITLE_BAR_OVERLAY_HEIGHT })
    } catch {
      // Some Linux window managers do not support the caption overlay.
    }
  })

  ipcMain.handle(DESKTOP_CHANNELS.relaunch, () => {
    app.relaunch()
    app.quit()
  })
}

/** In dev mode the Vite server may not be ready yet; retry until it is available */
async function loadDevServer(window: BrowserWindow): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await window.loadURL(DEV_SERVER_URL)
      return
    } catch (error) {
      if (attempt >= DEV_SERVER_RETRIES) throw error
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
}

async function createWindow(): Promise<void> {
  const chrome = getWindowChrome()
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181b' : '#ffffff',
    autoHideMenuBar: true,
    ...frameOptions(chrome),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments: [`${DESKTOP_TITLE_BAR_ARG}${chrome.titleBarMode}`],
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  window.once('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = app.isPackaged ? url.startsWith('file:') : url.startsWith(DEV_SERVER_URL)
    if (allowed) return
    event.preventDefault()
    void shell.openExternal(url)
  })
  // Allow page unload when an update is ready to quit and install, so the unsaved prompt cannot block restart
  window.webContents.on('will-prevent-unload', event => {
    if (updater.isInstalling()) event.preventDefault()
  })

  if (app.isPackaged) {
    await window.loadFile(path.join(__dirname, '../renderer/index.html'))
    return
  }
  await loadDevServer(window)
  window.webContents.openDevTools({ mode: 'detach' })
}

void app.whenReady().then(async () => {
  // Windows/Linux standardize on the in-app menu bar; the OS menu bar would duplicate its File/Edit/Help entries
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)

  const userData = app.getPath('userData')
  const uiPreferences = createUiPreferences(path.join(userData, 'ui-preferences.json'))
  const preferences = await uiPreferences.load()
  setWindowChrome({
    titleBarMode: preferences.titleBarMode,
    overlay: defaultOverlay(nativeTheme.shouldUseDarkColors),
  })

  registerIpcHandlers(createRecentFolders(path.join(userData, 'recent-folders.json')), uiPreferences)
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
