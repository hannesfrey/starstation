import { app, BrowserWindow, ipcMain, protocol, net, shell, screen } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { filesDir, dir, ensureDataDirs, redirectElectronPaths } from './paths'
import { logger } from './log'
import { getSettings, setSetting } from './settings'
import { loadPresets } from './presets'
import { loadLibrary, rescan, view, toggleFavorite, getGame } from './library/library'
import { consoleInfos } from './consoles'
import { launch, setLauncherWindow, runningGame, stopRunning } from './launcher'
import { attachWindow, notify, send } from './notify'
import type { AppState, Settings } from '../shared/types'

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
      notify({ kind: 'info', title: 'Emulator manager', detail: 'Open Settings → Emulators to install it.' })
      send('navigate', 'settings:emulators')
      return
    default:
      log.warn(`unknown command ${command}`)
  }
}

function registerIpc(): void {
  ipcMain.handle('state', () => state())
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
