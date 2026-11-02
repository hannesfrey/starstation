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
import { checkUpdates, emulatorInfos, installCore, installEmulator } from './emulators'
import { loadLibrary, rescan, view, toggleFavorite, getGame, forgetGame, updateStats } from './library/library'
import { backupGame, gameFiles, listBackups, noteResumeVersion, ownSaves, previousResume, pruneBackups, restoreBackup, restorePreviousResume, resumeInfo, saveEntries } from './gamedata'
import { createCollection, deleteCollection, listCollections, removeGameFromCollections, renameCollection, toggleInCollection } from './collections'
import { addGames } from './addgames'
import { availableOptions, gameOptions, setGameOption } from './gameoptions'
import { reportPads } from './controllers'
import { addMod, deleteMod, finishAdd, gamebananaGame, listMods, modSupport, setGamebananaGame, setModEnabled } from './mods'
import { gbModDetails, installGbMod, listGbMods, searchGames } from './gamebanana'
import { consoleInfos } from './consoles'
import { launch, setLauncherWindow, runningGame, stopRunning, onBeforeLaunch, onAfterExit } from './launcher'
import { attachWindow, notify, send } from './notify'
import type { AddGamesResult, AppState, EmulatorInfo, GameDetails, Settings } from '../shared/types'

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
    collections: listCollections(),
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
    case 'open-path': {
      // only folders inside Files\ (e.g. one save backup)
      const p = arg ? path.resolve(arg) : ''
      if (p && p.toLowerCase().startsWith(path.resolve(filesDir()).toLowerCase() + path.sep) && fs.existsSync(p)) await shell.openPath(p)
      return
    }
    case 'rescan':
      send('library', rescan())
      send('consoles', consoleInfos())
      return
    case 'install-emulator':
      if (arg) await doInstallEmulator(arg)
      return
    case 'install-core':
      if (!arg) return
      try {
        await installCore(arg, (text) => send('emulator-progress', { id: 'retroarch', text }))
        notify({ kind: 'success', title: 'Core installed', detail: arg })
        send('consoles', consoleInfos())
      } catch (e) {
        notify({ kind: 'error', title: 'Core install failed', detail: (e as Error).message })
      } finally {
        send('emulator-progress', { id: 'retroarch', text: '' })
      }
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
  ipcMain.handle('launch', (_e, id: string, mode?: 'fresh' | 'resume') => launch(id, mode === 'resume' ? 'resume' : 'fresh'))
  ipcMain.handle('game-details', (_e, id: string): GameDetails | null => {
    const g = getGame(id)
    if (!g) return null
    const ml = listMods(g)
    return { mods: { total: ml.length, on: ml.filter((m) => m.enabled).length, supported: modSupport(g).targets.length > 0 }, options: gameOptions(g), available: availableOptions(g), resume: resumeInfo(g), backups: listBackups(g), ownSaves: ownSaves(g).length, canBackup: !!getConsole(g.console)?.backup?.length, previousResume: previousResume(g)?.savedAt ?? null }
  })
  ipcMain.handle('backup-now', async (_e, id: string) => {
    const g = getGame(id)
    if (!g) return null
    const b = await backupGame(g, 'manual')
    if (b) await pruneBackups(g)
    notify(b ? { kind: 'save', title: 'Saves backed up', detail: g.title } : { kind: 'info', title: saveEntries(g).length ? 'Saves unchanged since the last backup' : 'No saves found yet', detail: g.title })
    return b
  })
  ipcMain.handle('backup-restore', async (_e, id: string, backupId: string) => {
    const g = getGame(id)
    if (!g) return { ok: false, error: 'Game not found' }
    if (runningGame()) return { ok: false, error: 'Close the game first.' }
    try {
      await restoreBackup(g, backupId)
      notify({ kind: 'save', title: 'Saves restored', detail: g.title })
      return { ok: true }
    } catch (e) {
      notify({ kind: 'error', title: 'Restore failed', detail: (e as Error).message })
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('resume-restore-previous', async (_e, id: string) => {
    const g = getGame(id)
    if (!g) return { ok: false, error: 'Game not found' }
    if (runningGame()) return { ok: false, error: 'Close the game first.' }
    try {
      await restorePreviousResume(g)
      notify({ kind: 'save', title: 'Earlier resume point is back', detail: g.title })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('game-option-set', (_e, id: string, key: 'graphics' | 'crt' | 'patch', value: string | boolean, patchId?: string) => {
    const g = getGame(id)
    return g ? setGameOption(g, key, value, patchId) : null
  })
  ipcMain.handle('report-pads', (_e, ids: string[]) => reportPads(Array.isArray(ids) ? ids.map(String) : []))
  // ---- mods ----
  const withGame = <T>(id: string, fn: (g: NonNullable<ReturnType<typeof getGame>>) => T): T | { ok: false; error: string } => {
    const g = getGame(id)
    return g ? fn(g) : { ok: false, error: 'Game not found' }
  }
  const notRunning = (id: string) => (runningGame()?.gameId === id ? { ok: false as const, error: 'Close the game first.' } : null)
  ipcMain.handle('mods', (_e, id: string) => {
    const g = getGame(id)
    return g ? { mods: listMods(g), ...modSupport(g) } : null
  })
  ipcMain.handle('mod-add', (_e, id: string, p: string) => withGame(id, (g) => addMod(g, p).then(modAdded(g))))
  ipcMain.handle('mod-add-dialog', async (_e, id: string, folder: boolean) => {
    const g = getGame(id)
    if (!g) return null
    const pick = await dialog.showOpenDialog(win!, {
      title: folder ? 'Choose a mod folder' : 'Choose a mod file',
      properties: [folder ? 'openDirectory' : 'openFile'],
      ...(folder ? {} : { filters: [{ name: 'Mods', extensions: ['zip', '7z', 'rar', 'pnach', 'png', 'dds', 'ips'] }, { name: 'All files', extensions: ['*'] }] })
    })
    if (pick.canceled || !pick.filePaths[0]) return null
    return addMod(g, pick.filePaths[0]).then(modAdded(g))
  })
  ipcMain.handle('mod-place', (_e, id: string, pending: string, target: string) => withGame(id, (g) => finishAdd(g, pending, target).then(modAdded(g))))
  ipcMain.handle('mod-toggle', (_e, id: string, modId: string, on: boolean, winner?: 'this' | 'other') =>
    notRunning(id) ?? withGame(id, (g) => setModEnabled(g, modId, !!on, winner === 'this' || winner === 'other' ? winner : undefined))
  )
  ipcMain.handle('mod-delete', (_e, id: string, modId: string) => notRunning(id) ?? withGame(id, (g) => deleteMod(g, modId)))
  ipcMain.handle('gb-search', async (_e, id: string, name?: string) => {
    const g = getGame(id)
    if (!g) return { games: [] }
    return { games: await searchGames(name ?? g.title), chosen: gamebananaGame(g) }
  })
  ipcMain.handle('gb-choose', (_e, id: string, gbId: number) => {
    const g = getGame(id)
    if (g) setGamebananaGame(g, Number(gbId))
  })
  ipcMain.handle('gb-mods', (_e, gbId: number, page: number) => listGbMods(Number(gbId), Number(page) || 1))
  ipcMain.handle('gb-mod', (_e, modId: number) => gbModDetails(Number(modId)))
  ipcMain.handle('gb-install', (_e, id: string, modId: number, fileId: number) =>
    withGame(id, (g) => installGbMod(g, Number(modId), Number(fileId)).then(modAdded(g)))
  )
  ipcMain.handle('delete-game', (_e, id: string, withSaves: boolean) => deleteGame(id, !!withSaves))
  ipcMain.handle('collection-create', (_e, name: string, first?: string) => pushCollections(createCollection(name, first)))
  ipcMain.handle('collection-rename', (_e, id: string, name: string) => pushCollections(renameCollection(id, name)))
  ipcMain.handle('collection-delete', (_e, id: string) => pushCollections(deleteCollection(id)))
  ipcMain.handle('collection-toggle', (_e, id: string, gameId: string) => pushCollections(toggleInCollection(id, gameId)))
  ipcMain.handle('add-games', (_e, paths: string[], consoleId?: string) => doAddGames(paths, consoleId))
  ipcMain.handle('add-games-dialog', async () => {
    const pick = await dialog.showOpenDialog(win!, { title: 'Add games', properties: ['openFile', 'multiSelections'] })
    if (pick.canceled || !pick.filePaths.length) return null
    return doAddGames(pick.filePaths)
  })
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

/** Notification after a mod was added (or why not). */
function modAdded(g: { title: string }) {
  return <T extends { ok: boolean; mod?: { name: string }; error?: string; ask?: unknown }>(r: T): T => {
    if (r.ok && r.mod) notify({ kind: 'mod', title: 'Mod installed', detail: `${r.mod.name} · ${g.title}` })
    else if (!r.ok && r.error && r.error !== 'Cancelled.') notify({ kind: 'error', title: 'Mod not added', detail: r.error })
    return r
  }
}

function pushCollections<T>(list: T): T {
  send('collections', list)
  return list
}

async function doAddGames(paths: string[], consoleId?: string): Promise<AddGamesResult> {
  const r = await addGames(paths, consoleId)
  if (r.added.length) {
    const lib = rescan()
    send('library', lib)
    send('consoles', consoleInfos())
    for (const a of r.added) a.title = lib.games.find((g) => g.path.toLowerCase() === a.path.toLowerCase())?.title
    notify({ kind: 'success', title: r.added.length === 1 ? 'Game added' : `${r.added.length} games added`, detail: r.added.map((a) => a.title ?? path.basename(a.path)).join(', ') })
  }
  if (r.errors.length) notify({ kind: 'warning', title: 'Some files were not added', detail: r.errors.slice(0, 2).join(' ') })
  return r
}

/** Move the game (and, if asked, its own saves) to the Recycle Bin, then forget it. */
async function deleteGame(id: string, withSaves: boolean): Promise<{ ok: boolean; error?: string }> {
  const g = getGame(id)
  if (!g) return { ok: false, error: 'Game not found' }
  if (runningGame()?.gameId === id) return { ok: false, error: 'Close the game first.' }
  const targets = [...gameFiles(g), ...(withSaves ? ownSaves(g) : [])].filter((p) => fs.existsSync(p))
  try {
    for (const t of targets) await trash(t)
  } catch (e) {
    log.error(`delete ${id} failed`, e)
    notify({ kind: 'error', title: 'Could not delete the game', detail: (e as Error).message })
    send('library', rescan())
    return { ok: false, error: (e as Error).message }
  }
  forgetGame(id)
  send('collections', removeGameFromCollections(id))
  send('library', rescan())
  send('consoles', consoleInfos())
  log.info(`deleted ${id} (${targets.length} item(s), saves ${withSaves ? 'deleted' : 'kept'})`)
  notify({ kind: 'info', title: 'Game deleted', detail: `${g.title} is in the Recycle Bin${withSaves ? ' with its saves' : ''}.` })
  return { ok: true }
}

/** Recycle Bin, so a delete can be undone. Hidden test runs use a folder instead of Hannes's Recycle Bin. */
async function trash(p: string): Promise<void> {
  if (HEADLESS) {
    const to = dir('config', 'test-trash', `${Date.now()}-${path.basename(p)}`)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.renameSync(p, to)
    return
  }
  await shell.trashItem(p)
}

function registerHooks(): void {
  onBeforeLaunch(async (id) => {
    const g = getGame(id)
    if (!g) return
    const b = await backupGame(g, 'launch')
    if (b) await pruneBackups(g)
  })
  onAfterExit((id, _s, _c, startedAt) => {
    const v = noteResumeVersion(id, startedAt)
    if (v) updateStats(id, (s) => ({ ...s, resumeVersion: v }))
  })
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
  registerHooks()
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
