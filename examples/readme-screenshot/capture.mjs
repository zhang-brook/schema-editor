#!/usr/bin/env node
// Drives the schema-editor desktop shell over CDP to render the README screenshot.
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const desktopDir = join(repoRoot, 'app', 'desktop')
const webDir = join(repoRoot, 'app', 'web')
const projectDir = join(repoRoot, '.fixtures', 'readme-screenshot', 'project')
const profileDir = join(repoRoot, '.fixtures', 'readme-screenshot', 'profile')
const outputPath = join(repoRoot, 'docs', 'images', 'schema-editor-structure.png')
const port = 9412
const devServerUrl = 'http://localhost:6842'
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

console.log('generating demo project…')
execFileSync(process.execPath, [join(scriptDir, 'create-project.mjs'), '--out', projectDir], {
  cwd: repoRoot,
  stdio: 'inherit'
})

rmSync(profileDir, { recursive: true, force: true })
mkdirSync(profileDir, { recursive: true })
writeFileSync(
  join(profileDir, 'recent-folders.json'),
  JSON.stringify({ folders: [projectDir] }, null, 2),
  'utf8'
)

let devServer
let devServerTail = ''
async function ensureDevServer() {
  try {
    const response = await fetch(devServerUrl)
    if (response.ok) return
  } catch {
    // not running yet
  }
  console.log('starting Vite dev server…')
  devServer = spawn(process.execPath, [join(webDir, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', '6842', '--strictPort'], {
    cwd: webDir,
    stdio: ['ignore', 'ignore', 'pipe']
  })
  devServer.stderr.on('data', (chunk) => {
    devServerTail = (devServerTail + String(chunk)).slice(-2000)
  })
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(devServerUrl)
      if (response.ok) return
    } catch {
      // not up yet
    }
    await sleep(300)
  }
  throw new Error(`dev server did not start${devServerTail ? `: ${devServerTail}` : ''}`)
}

await ensureDevServer()

const electronPath = createRequire(join(desktopDir, 'package.json'))('electron')
const electronEnv = { ...process.env }
delete electronEnv.ELECTRON_RUN_AS_NODE
const child = spawn(electronPath, ['.', `--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`], {
  cwd: desktopDir,
  stdio: ['ignore', 'ignore', 'pipe'],
  env: electronEnv
})
let tail = ''
child.stderr.on('data', (chunk) => {
  tail = (tail + String(chunk)).slice(-4000)
})

async function waitForTarget(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      const page = targets.find(
        (target) => target.type === 'page' && target.webSocketDebuggerUrl && target.url.includes('localhost:6842')
      )
      if (page !== undefined) return page.webSocketDebuggerUrl
    } catch {
      // not up yet
    }
    await sleep(250)
  }
  throw new Error('CDP target not found')
}

function connect(wsUrl) {
  return new Promise((resolvePromise, rejectPromise) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    let nextId = 1
    ws.onopen = () =>
      resolvePromise({
        send: (method, params = {}) =>
          new Promise((resolveSend, rejectSend) => {
            const id = nextId
            nextId += 1
            pending.set(id, { resolveSend, rejectSend })
            ws.send(JSON.stringify({ id, method, params }))
          }),
        close: () => ws.close()
      })
    ws.onerror = () => rejectPromise(new Error('CDP websocket failed'))
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      const entry = pending.get(message.id)
      if (entry === undefined) return
      pending.delete(message.id)
      if (message.error) entry.rejectSend(new Error(message.error.message))
      else entry.resolveSend(message.result)
    }
  })
}

async function main() {
  const wsUrl = await waitForTarget(90000)
  const cdp = await connect(wsUrl)
  const evaluate = async (expression) => {
    const response = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (response.exceptionDetails !== undefined) {
      throw new Error(`page error: ${response.exceptionDetails.text} ${response.exceptionDetails.exception?.description ?? ''}`)
    }
    return response.result.value
  }
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')

  const waitFor = async (expression, timeoutMs, label) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return true
      await sleep(250)
    }
    throw new Error(`${label} never appeared`)
  }

  // English UI, light theme, a slightly wider sidebar for the table tree.
  await waitFor(`document.querySelector('.menu-bar') !== null`, 60000, 'menu bar')
  await evaluate(`(() => {
    localStorage.setItem('schema-editor-locale', 'en')
    localStorage.setItem('schema-editor.theme', 'light')
    localStorage.setItem('schema-editor.structureSidebarWidth', '290')
    localStorage.setItem('schema-editor.fieldTableColWidths', JSON.stringify({ name: 150, type: 210, length: 90, scale: 90, default: 175, comment: 230 }))
    return true
  })()`)
  await evaluate(`location.reload()`)
  await waitFor(`document.querySelector('.menu-bar') !== null`, 60000, 'menu bar after reload')
  await sleep(1200)

  // Render at a large desktop viewport (like a 1850×1120 display) regardless of the
  // physical window size, so the whole field grid fits without horizontal scrolling.
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 2000,
    height: 1285,
    deviceScaleFactor: 1.5,
    mobile: false,
    screenWidth: 2000,
    screenHeight: 1285
  })
  await sleep(900)

  // Open the demo project through the real desktop file-system bridge.
  const opened = await evaluate(`(async () => {
    const bridge = window.schemaEditorDesktop
    if (!bridge) return 'no bridge'
    const { DesktopDirectoryHandle } = await import('/src/platform/desktop-fsa.ts')
    const root = await bridge.openRecentFolder(${JSON.stringify(projectDir)})
    if (!root) return 'no root'
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const store = pinia._s.get('editor')
    await store.openProjectFromHandle(new DesktopDirectoryHandle(bridge, root))
    store.selectTable(0, 3)
    return 'ok'
  })()`)
  if (opened !== 'ok') throw new Error(`open project failed: ${opened}`)

  await waitFor(`document.querySelectorAll('.fields-table tbody tr').length >= 15`, 30000, 'orders fields')
  await waitFor(`document.querySelectorAll('.sidebar-item.table-item').length >= 8`, 30000, 'table tree')
  // Let the "project opened" toast fade out before capturing.
  await sleep(3200)

  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, Buffer.from(result.data, 'base64'))
  console.log(`saved ${outputPath}`)
  cdp.close()
}

try {
  await main()
} catch (error) {
  console.error(`readme screenshot: ${error instanceof Error ? error.message : String(error)}`)
  if (tail.trim() !== '') console.error(tail)
  process.exitCode = 1
} finally {
  child.kill()
  devServer?.kill()
  await sleep(800)
  try {
    rmSync(profileDir, { recursive: true, force: true })
  } catch {
    // Windows may still hold Electron profile files; they live in .fixtures/ anyway.
  }
}
