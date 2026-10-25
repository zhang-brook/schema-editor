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

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = Number(process.argv[index + 1])
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} needs a positive number`)
  return value
}

// Layout viewport in CSS pixels. `--dpr` only scales the saved pixels; whether the
// fields table fits depends on the layout width alone.
const viewportWidth = arg('width', 1920)
const viewportHeight = arg('height', 1080)
const deviceScaleFactor = arg('dpr', 1.5)
// The saved image is downscaled by this factor after capture: the layout stays wide
// enough for every column, and the extra capture pixels only act as supersampling.
const outputScale = 0.72
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

  // English UI, light theme, a narrower sidebar and tighter columns so the whole
  // fields table fits at the emulated viewport width.
  await waitFor(`document.querySelector('.menu-bar') !== null`, 60000, 'menu bar')
  await evaluate(`(() => {
    localStorage.setItem('schema-editor-locale', 'en')
    localStorage.setItem('schema-editor.theme', 'light')
    localStorage.setItem('schema-editor.structureSidebarWidth', '250')
    localStorage.setItem('schema-editor.fieldTableColWidths', JSON.stringify({ name: 130, type: 180, length: 80, scale: 80, default: 175, comment: 190 }))
    return true
  })()`)
  await evaluate(`location.reload()`)
  await waitFor(`document.querySelector('.menu-bar') !== null`, 60000, 'menu bar after reload')
  // await sleep(1200)

  // Render at a larger desktop viewport than the physical window, so the whole field
  // grid fits without horizontal scrolling.
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor,
    mobile: false,
    screenWidth: viewportWidth,
    screenHeight: viewportHeight
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

  const overflow = await evaluate(`(() => {
    const body = document.querySelector('.fields-table')?.closest('.section-body')
    return body ? { scrollWidth: body.scrollWidth, clientWidth: body.clientWidth } : null
  })()`)
  if (overflow === null) throw new Error('fields table not found')
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    const minWidth = viewportWidth + overflow.scrollWidth - overflow.clientWidth
    console.warn(
      `warning: fields table clips at ${viewportWidth}px (needs ${overflow.scrollWidth}px, has ${overflow.clientWidth}px); ` +
        `use --width ${minWidth} or more to show every column`
    )
  }

  // The caption buttons are OS-drawn and absent from the page, so draw Windows-style
  // glyphs into the 150×40 corner the menu bar reserves for the title bar overlay.
  await evaluate(`(() => {
    const icon = (body) => '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#71717a" stroke-width="1">' + body + '</svg>'
    const glyphs = [
      icon('<path d="M0 5.5h10"/>'),
      icon('<rect x="0.5" y="0.5" width="9" height="9"/>'),
      icon('<path d="M0.5 0.5l9 9M9.5 0.5l-9 9"/>')
    ]
    const bar = document.createElement('div')
    bar.id = 'readme-caption-controls'
    bar.setAttribute('aria-hidden', 'true')
    bar.style.cssText = 'position:fixed;top:0;right:0;height:39px;display:flex;align-items:stretch;z-index:2147483647;pointer-events:none;'
    for (const glyph of glyphs) {
      const button = document.createElement('div')
      button.style.cssText = 'width:46px;display:flex;align-items:center;justify-content:center;'
      button.innerHTML = glyph
      bar.appendChild(button)
    }
    document.body.appendChild(bar)
    return true
  })()`)

  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false
  })
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, Buffer.from(result.data, 'base64'))
  execFileSync(process.execPath, [join(scriptDir, 'compress-png.mjs'), outputPath, '--scale', String(outputScale)], {
    stdio: 'inherit'
  })
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
