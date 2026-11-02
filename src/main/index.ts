import { app, BrowserWindow, dialog, ipcMain, protocol, net, shell, screen } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { filesDir, dir, ensureDataDirs, redirectElectronPaths } from './paths'
import { logger } from './log'
import { getSettings, setSetting } from './settings'
import { allConsoles, emulatorDir, emulatorExe, getConsole, getEmulator, loadPresets } from './presets'
import { applyConsoleConfig } from './emuconfig'
import { biosStatus } from './bios'
import { findSources, planImport, runImport, summarize } from './importer'
import { checkUpdates, emulatorInfos, installEmulator } from './emulators'
import { loadLibrary, rescan, view, toggleFavorite, getGame } from './library/library'
import { consoleInfos } from './consoles'
import { launch, setLauncherWindow, runningGame, stopRunning } from './launcher'
import { attachWindow, notify, send } from './notify'
import type { AppState, EmulatorInfo, Settings } from '../shared/types'

// ---- before ready: keep everything inside Files\ ----
redirectElectronPaths()
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
/** Automated tests: never show a window or play sound on Hannes's screen. */
const HEADLESS = process.env.STARSTATION_HEADLESS === '1'
if (HEADLESS) app.commandLine.appendSwitch('mute-audio')
const log = logger('main')
protocol.registerSchemesAsPrivileged([
  { scheme: 'starstation-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let win: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const s = getSettings()
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const w = new BrowserWindow({
    width: Math.min(1600, Math.round(width * 0.85)),
    height: Math.min(900, Math.round(height * 0.85)),
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#05070d',
    title: 'Starstation',
    show: false,
    fullscreen: s.startFullscreen && !HEADLESS,
    autoHideMenuBar: true,
    skipTaskbar: HEADLESS,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  w.removeMenu()
  if (HEADLESS) w.webContents.setAudioMuted(true)
  else w.once('ready-to-show', () => w.show())
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  w.webContents.on('render-process-gone', (_e, d) => log.error('renderer gone', d))
  if (process.env.ELECTRON_RENDERER_URL) w.loadURL(process.env.ELECTRON_RENDERER_URL)
  else w.loadFile(path.join(__dirname, '../renderer/index.html'))
  return w
}

function state(): AppState {
  return {
    info: { version: app.getVersion(), filesDir: filesDir(), isPackaged: app.isPackaged },
    settings: getSettings(),
    consoles: consoleInfos(),
    library: view(),
    running: runningGame()
  }
}

/** Folder shortcuts used by "Open folder" buttons and error fixes. */
function folderFor(kind: string, arg?: string): string | null {
  const [what, sub] = kind.includes(':') ? kind.split(':') : [kind, arg]
  switch (what) {
    case 'emulators':
      return dir('emulators', sub ?? '')
    case 'bios':
    case 'games':
    case 'saves':
    case 'mods':
    case 'backups':
      return dir(what, sub ?? '')
    case 'screenshots':
      return dir('media', 'screenshots', sub ?? '')
    case 'logs':
      return dir('config', 'logs')
    case 'files':
      return filesDir()
    case 'game': {
      const g = sub ? getGame(sub) : undefined
      return g ? (g.kind === 'file' ? path.dirname(g.path) : g.path) : null
    }
    default:
      return null
  }
}

async function runCommand(command: string, arg?: string): Promise<void> {
  switch (command) {
    case 'open-folder': {
      const f = arg ? folderFor(arg) : null
      if (f) {
        fs.mkdirSync(f, { recursive: true })
        await shell.openPath(f)
      }
      return
    }
    case 'rescan':
      send('library', rescan())
      send('consoles', consoleInfos())
      return
    case 'install-emulator':
      if (arg) await doInstallEmulator(arg)
      return
    case 'install-ps3-firmware':
      await installPs3Firmware()
      return
    case 'open-url':
      // only official pages from presets are passed here
      if (arg && /^https:\/\//.test(arg)) await shell.openExternal(arg)
      return
    default:
      log.warn(`unknown command ${command}`)
  }
}

async function doInstallEmulator(id: string): Promise<{ ok: boolean; error?: string; info?: EmulatorInfo }> {
  try {
    const info = await installEmulator(id, (text) => send('emulator-progress', { id, text }))
    notify({ kind: 'success', title: `${info.name} installed`, detail: info.version ? `Version ${info.version}` : undefined })
    send('consoles', consoleInfos())
    return { ok: true, info }
  } catch (e) {
    log.error(`install ${id} failed`, e)
    notify({ kind: 'error', title: 'Install failed', detail: (e as Error).message })
    return { ok: false, error: (e as Error).message }
  } finally {
    send('emulator-progress', { id, text: '' })
  }
}

/** Ask for PS3UPDAT.PUP (from Sony's official page) and install it into RPCS3. */
async function installPs3Firmware(): Promise<void> {
  const ps3 = getConsole('ps3')
  const e = ps3 ? getEmulator(ps3.emulator) : undefined
  if (!ps3 || !e || !fs.existsSync(emulatorExe(e))) {
    notify({ kind: 'error', title: 'RPCS3 is not installed', detail: 'Install it in Settings → Emulators first.' })
    return
  }
  const choice = await dialog.showMessageBox(win!, {
    type: 'question',
    title: 'PS3 firmware',
    message: 'RPCS3 needs the official PS3 system software (PS3UPDAT.PUP).',
    detail: 'Download it from playstation.com, then choose the file here.',
    buttons: ['Choose PS3UPDAT.PUP…', 'Open download page', 'Cancel'],
    cancelId: 2
  })
  if (choice.response === 1 && ps3.bios?.url) await shell.openExternal(ps3.bios.url)
  if (choice.response !== 0) return
  const pick = await dialog.showOpenDialog(win!, {
    title: 'Choose PS3UPDAT.PUP',
    filters: [{ name: 'PS3 firmware', extensions: ['PUP', 'pup'] }],
    properties: ['openFile']
  })
  if (pick.canceled || !pick.filePaths[0]) return
  applyConsoleConfig(ps3)
  notify({ kind: 'info', title: 'Installing PS3 firmware…', detail: 'RPCS3 shows its progress.' })
  await new Promise<void>((resolve) => {
    const p = spawn(emulatorExe(e), ['--installfw', pick.filePaths[0]], { cwd: emulatorDir(e), stdio: 'ignore' })
    p.once('exit', () => resolve())
    p.once('error', () => resolve())
  })
  const ok = biosStatus(ps3).ok
  notify({ kind: ok ? 'success' : 'error', title: ok ? 'PS3 firmware installed' : 'PS3 firmware not installed', detail: ok ? undefined : 'Check the RPCS3 log.' })
  send('consoles', consoleInfos())
}

function registerIpc(): void {
  ipcMain.handle('state', () => state())
  ipcMain.handle('import-scan', () =>
    findSources().map((s, index) => {
      const plan = planImport(s)
      return { index, label: s.label, summary: summarize(plan), skipped: plan.skipped }
    })
  )
  ipcMain.handle('import-run', async (_e, index: number) => {
    const source = findSources()[index]
    if (!source) return { ok: false, copied: 0, moved: 0, conflicts: [], errors: ['Source not found'] }
    const result = await runImport(planImport(source), (p) => send('import-progress', p))
    for (const c of allConsoles()) applyConsoleConfig(c)
    send('library', rescan())
    send('consoles', consoleInfos())
    notify({
      kind: result.ok ? 'success' : 'error',
      title: result.ok ? 'Import finished' : 'Import stopped',
      detail: result.ok ? `${result.moved} game(s) moved, ${result.copied} item(s) copied` : result.errors[0]
    })
    return result
  })
  ipcMain.handle('emulators', () => emulatorInfos())
  ipcMain.handle('emulators-check', () => checkUpdates())
  ipcMain.handle('emulator-install', (_e, id: string) => doInstallEmulator(id))
  ipcMain.handle('set-setting', (_e, key: keyof Settings, value: Settings[keyof Settings]) => {
    const s = setSetting(key, value as never)
    if (key === 'showEmptyConsoles') send('consoles', consoleInfos())
    if (key === 'startWithWindows' && app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!value })
    return s
  })
  ipcMain.handle('rescan', () => {
    const l = rescan()
    send('consoles', consoleInfos())
    return l
  })
  ipcMain.handle('launch', (_e, id: string) => launch(id))
  ipcMain.handle('toggle-favorite', (_e, id: string) => toggleFavorite(id))
  ipcMain.handle('open-folder', (_e, kind: string, arg?: string) => runCommand('open-folder', arg ? `${kind}:${arg}` : kind))
  ipcMain.handle('run-command', (_e, command: string, arg?: string) => runCommand(command, arg))
  ipcMain.handle('toggle-fullscreen', () => {
    if (!win) return false
    win.setFullScreen(!win.isFullScreen())
    return win.isFullScreen()
  })
  ipcMain.handle('quit', () => app.quit())
}

function registerMediaProtocol(): void {
  // starstation-media://local/<encoded absolute path> → file, only inside Files\ or game folders
  protocol.handle('starstation-media', (req) => {
    const u = new URL(req.url)
    const p = decodeURIComponent(u.pathname.slice(1))
    const abs = path.resolve(p)
    const root = path.resolve(filesDir())
    if (!abs.toLowerCase().startsWith(root.toLowerCase() + path.sep)) return new Response('forbidden', { status: 403 })
    return net.fetch(pathToFileURL(abs).toString())
  })
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(() => {
  ensureDataDirs()
  log.info(`Starstation ${app.getVersion()} starting; Files=${filesDir()}`)
  loadPresets()
  loadLibrary()
  registerIpc()
  registerMediaProtocol()
  win = createWindow()
  attachWindow(win)
  setLauncherWindow(win)
  // scan after the window is up so startup stays fast (cache is shown first)
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      send('library', rescan())
      send('consoles', consoleInfos())
    }, 50)
  })
})

app.on('window-all-closed', () => {
  stopRunning()
  app.quit()
})

process.on('uncaughtException', (e) => log.error('uncaught', e))
process.on('unhandledRejection', (e) => log.error('unhandled rejection', e))
