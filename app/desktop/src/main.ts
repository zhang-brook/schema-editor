import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import path from 'node:path'
import { autoUpdater } from 'electron-updater'
import { DESKTOP_CHANNELS, type DesktopUpdateStatus } from 'schema-editor-bridge'
import { createFsService } from './fs-service'
import { createUpdater } from './updater'

const DEV_SERVER_URL = 'http://localhost:6842'
const DEV_SERVER_RETRIES = 120

const fsService = createFsService()

autoUpdater.autoInstallOnAppQuit = false

/** 更新状态推送到所有未销毁窗口 */
function publishUpdateStatus(status: DesktopUpdateStatus): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(DESKTOP_CHANNELS.updateStatus, status)
  }
}

const updater = createUpdater(
  {
    // 免安装 exe 就地解压运行，无法自我覆盖，只在 NSIS 安装版开放在线更新
    updateSupported: app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR,
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

function registerIpcHandlers(): void {
  ipcMain.handle(DESKTOP_CHANNELS.pickDirectory, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    const picked = result.canceled ? undefined : result.filePaths[0]
    return picked ? fsService.allowRoot(picked) : null
  })

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
}

/** 开发模式下 Vite 服务可能尚未就绪，失败后重试直至可用 */
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
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#18181b' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
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
  // 更新已就绪要退出安装时，放行页面卸载，避免未保存提醒挡住重启
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

app.whenReady().then(() => {
  registerIpcHandlers()
  void createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
