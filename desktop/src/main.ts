import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import path from 'node:path'
import { DESKTOP_CHANNELS } from '../../src/platform/bridge'
import { createFsService } from './fs-service'

const DEV_SERVER_URL = 'http://localhost:6842'
const DEV_SERVER_RETRIES = 120

const fsService = createFsService()

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
