import { app, BrowserWindow, dialog, ipcMain, nativeImage, protocol, net, shell, screen } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { filesDir, dir, ensureDataDirs, redirectElectronPaths } from './paths'
import { logger } from './log'
import { writeJson } from './store'
import { getSettings, isTester, setSetting } from './settings'
import { enterSafeMode, inSafeMode, leaveSafeMode, restoreSuspended } from './safemode'
import { endSession, startSession, type StartInfo } from './session'
import { maybeRescue, releaseToEveryone, takeNewVersion, takeRescueNote, undoUpdate } from './updater'
import { compareVersions } from '../shared/semver'
import { whatsNewFor } from '../shared/whatsnew'
import { allConsoles, emulatorDir, emulatorExe, getConsole, getEmulator, loadPresets } from './presets'
import { applyConsoleConfig } from './emuconfig'
import { biosStatus } from './bios'
import { findSources, planImport, runImport, summarize } from './importer'
import { checkUpdates, emulatorInfos, installCore, installEmulator, markTested } from './emulators'
import { loadLibrary, rescan, view, toggleFavorite, getGame, forgetGame, updateStats } from './library/library'
import { backupOutcome, gameFiles, listBackups, noteResumeVersion, ownSaves, previousResume, pruneBackups, restoreBackup, restorePreviousResume, resumeInfo } from './gamedata'
import { createCollection, deleteCollection, listCollections, removeGameFromCollections, renameCollection, toggleInCollection } from './collections'
import { addGames } from './addgames'
import { afterAdd, installPkg } from './convert'
import { compressGame, compressOption, decompressGame } from './compress'
import { storageInfo } from './storage'
import { describeNxm, downloadNxm, nexusKey, nxmFromArgs, registerNxm } from './nexus'
import { patchStatus, updatePatches } from './patchsets'
import { power, setWallpaper, wallpapers } from './consolefeel'
import { activeProfile, addProfile, applyProfilePaths, deleteProfile, finishInterruptedSwitch, GUEST, switchPending, listProfiles, setPin, switchProfile, updateProfile } from './profiles'
import { refreshCompat } from './compat'
import { moveGameOptions } from './gameoptions'
import { moveGameInCollections } from './collections'
import { availableOptions, gameOptions, setGameOption } from './gameoptions'
import { knownPlayers, padVars, reportPads } from './controllers'
import { checkNow, startUpdater, updateState } from './updater'
import { addMod, deleteMod, finishAdd, gamebananaGame, listMods, modSupport, setGamebananaGame, setModEnabled } from './mods'
import { gbModDetails, installGbMod, listGbMods, searchGames } from './gamebanana'
import { fetchArtwork, queueArtwork } from './artwork'
import { checkUpdates as checkPs3Updates, runUpdate, updateInfo, updatingGame } from './ps3updates'
import { listScreenshots } from './screenshots'
import { readBattery } from './battery'
import { moveStats, reattachArtwork, setCustomArt } from './library/library'
import { healthCheck } from './health'
import { checkDs3, installDs3Driver } from './ds3'
import { assignInbox, openInboxQuestions, startModInbox } from './modinbox'
import { exportReport } from './diagnostics'
import { lastUnlockCheck, raLogin, raLogout, raStatus, recentUnlocks } from './retroach'
import { listRooms, netplayArgs, netplayVars } from './netplay'
import { addToSteam, steamStatus } from './steam'
import { customConsoleForm, removeCustomConsole, saveCustomConsole } from './customconsole'
import { allEmulators } from './presets'
import { cancelTransfer, packageSize, receiveByCode, receiveFromFolder, sendByCode, buildPackage, inventory, INVENTORY_FILE, noteSent } from './packages'
import { applyModProfile, deleteModProfile, enablePending, modProfiles, saveModProfile } from './mods'
import { readJson } from './store'
import { consoleInfos } from './consoles'
import { CLOSE_TIMEOUT, closeRunning, launch, setLauncherWindow, runningGame, runningPid, stopRunning, onBeforeLaunch, onAfterExit } from './launcher'
import { keepEmulatorLog } from './emulogs'
import { hideOverlay, overlayAction, overlayOpen, overlayState, sendOverlay, setupOverlay, toggleOverlay } from './overlay'
import { audioOutputs, bluetoothDevices, bluetoothPair, bluetoothRemove, displayModes, foregroundPid, onHome, setAudioOutput, setDisplayMode, startPadHelper, stopPadHelper, xinputSnapshot, onXPads, xpadFeed } from './padhelper'
import { loadGpuDrivers, markGuideSeen, newHomeConflicts } from './system'
import { couchMark, couchStatus, saveCouchCheck, startCouchCheck } from './couchcheck'
import type { OverlayAction } from '../shared/types'
import { attachWindow, notify, send } from './notify'
import { startDownloadWatcher } from './downloads'
import type { AddGamesResult, AppState, CustomConsoleForm, EmulatorInfo, GameDetails, Inventory, NetplayRoom, PackageChoice, PackageProgress, PlayerPad, ProfileMerge, Settings, StartNotes } from '../shared/types'

// ---- before ready: keep everything inside Files\ ----
redirectElectronPaths()
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
/** Automated tests: never show a window or play sound on Hannes's screen. */
const HEADLESS = process.env.STARSTATION_HEADLESS === '1'
/** scripts/couch-test.mjs: real games on screen, everything muted (Starstation and the games). */
const COUCH_TEST = process.env.STARSTATION_COUCH_TEST === '1'
if (HEADLESS || COUCH_TEST) app.commandLine.appendSwitch('mute-audio')
// tests that must never reach the internet (e.g. the monkey test pressing every button): all requests fail fast
if (HEADLESS && process.env.STARSTATION_TEST_OFFLINE === '1') app.commandLine.appendSwitch('proxy-server', '127.0.0.1:9')
const log = logger('main')
protocol.registerSchemesAsPrivileged([
  { scheme: 'starstation-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

// Starstation already open: this copy only hands over to it (second-instance) and ends at once.
// It must not touch anything else: it once marked the open copy as crashed and started a rescue.
const primary = app.requestSingleInstanceLock()
if (!primary) app.exit(0)

let win: BrowserWindow | null = null

/**
 * Explorer windows and web pages: never from hidden test runs (they would open on the screen) — there the
 * request is only written to the log, so tests can still see it was asked for.
 */
const outside = {
  openPath: async (p: string): Promise<string> => (HEADLESS ? (log.info(`(hidden run) would open ${p}`), '') : shell.openPath(p)),
  openExternal: async (url: string): Promise<void> => (HEADLESS ? void log.info(`(hidden run) would open ${url}`) : shell.openExternal(url)),
  showItemInFolder: (p: string): void => (HEADLESS ? void log.info(`(hidden run) would show ${p}`) : shell.showItemInFolder(p))
}

// Windows dialogs: never in hidden test runs (they would pop up on the screen) — there they answer "cancelled";
// and without the menu window (closing) they open on their own instead of failing.
const owner = () => (win && !win.isDestroyed() ? win : null)
function openDialog(opts: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  if (HEADLESS) return Promise.resolve({ canceled: true, filePaths: [] })
  const w = owner()
  return w ? dialog.showOpenDialog(w, opts) : dialog.showOpenDialog(opts)
}
function saveDialog(opts: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
  if (HEADLESS) return Promise.resolve({ canceled: true, filePath: '' })
  const w = owner()
  return w ? dialog.showSaveDialog(w, opts) : dialog.showSaveDialog(opts)
}
function messageBox(opts: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  if (HEADLESS) return Promise.resolve({ response: opts.cancelId ?? 0, checkboxChecked: false })
  const w = owner()
  return w ? dialog.showMessageBox(w, opts) : dialog.showMessageBox(opts)
}

/** TV mode: the whole menu (and the PS button menu) a quarter bigger, for reading from the couch. */
function applyTvMode(): void {
  const f = getSettings().tvMode ? 1.25 : 1
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.setZoomFactor(f)
}

let lastMenuReload = 0

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
    icon: app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : path.join(app.getAppPath(), 'build', 'icon.ico'),
    show: false,
    fullscreen: (s.startFullscreen || process.argv.includes('--fullscreen')) && !HEADLESS,
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
    if (/^https?:\/\//.test(url)) outside.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  w.webContents.on('render-process-gone', (_e, d) => {
    log.error('renderer gone', d)
    if (d.reason === 'clean-exit' || w.isDestroyed()) return
    // the menu crashed: it is loaded again. A running game is never ended for it; otherwise a second crash
    // within a minute ends Starstation (counted as a crash: safe mode is offered next time)
    const since = Date.now() - lastMenuReload
    if (runningGame() || since > 60_000) {
      lastMenuReload = Date.now()
      setTimeout(() => !w.isDestroyed() && w.webContents.reload(), runningGame() ? Math.max(0, 10_000 - since) : 0)
      return
    }
    app.exit(1)
  })
  loadPage(w)
  w.webContents.on('did-finish-load', () => applyTvMode())
  return w
}

/** The menu page; the PS button menu window loads the same page with #overlay. */
function loadPage(w: BrowserWindow, hash?: string): void {
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(process.env.ELECTRON_RENDERER_URL + (hash ? `#${hash}` : ''))
  else void w.loadFile(path.join(__dirname, '../renderer/index.html'), hash ? { hash } : {})
}

function state(): AppState {
  return {
    info: { version: app.getVersion(), filesDir: filesDir(), isPackaged: app.isPackaged, safeMode: inSafeMode(), tester: isTester() },
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
        await outside.openPath(f)
      }
      return
    }
    case 'show-file': {
      // only files inside Files (e.g. the diagnostics report)
      const p = arg ? path.resolve(arg) : ''
      if (p && fs.existsSync(p)) outside.showItemInFolder(p)
      return
    }
    case 'open-path': {
      // only folders inside Files\ (e.g. one save backup)
      const p = arg ? path.resolve(arg) : ''
      if (p && p.toLowerCase().startsWith(path.resolve(filesDir()).toLowerCase() + path.sep) && fs.existsSync(p)) await outside.openPath(p)
      return
    }
    case 'rescan':
      scanAndArt()
      return
    case 'install-ds3-driver': {
      notify({ kind: 'info', title: 'Installing the PS3 controller driver', detail: 'Windows asks for permission — choose Yes.' })
      const r = await installDs3Driver()
      notify(
        r.ok
          ? { kind: 'success', title: 'PS3 controller ready', detail: 'The driver is installed. Your controller works in Starstation and every game.' }
          : { kind: r.cancelled ? 'warning' : 'error', title: 'PS3 controller driver not installed', detail: r.error ?? '', action: { label: 'Try again', command: 'install-ds3-driver' } }
      )
      return
    }
    case 'install-emulator':
      if (arg) await doInstallEmulator(arg)
      return
    case 'install-core':
      if (!arg || runningGame() || installing.has('retroarch') || (HEADLESS && process.env.STARSTATION_TEST_NETWORK !== '1')) return
      installing.add('retroarch')
      try {
        await installCore(arg, (text) => send('emulator-progress', { id: 'retroarch', text }))
        notify({ kind: 'success', title: 'Core installed', detail: arg })
        send('consoles', consoleInfos())
      } catch (e) {
        notify({ kind: 'error', title: 'Core install failed', detail: (e as Error).message })
      } finally {
        installing.delete('retroarch')
        send('emulator-progress', { id: 'retroarch', text: '' })
      }
      return
    case 'install-ps3-firmware':
      await installPs3Firmware()
      return
    case 'open-secrets': {
      const f = dir('config', 'secrets.json')
      if (!fs.existsSync(f)) writeJson(f, { screenscraper: { username: '', password: '', devid: '', devpassword: '' }, retroachievements: { username: '', password: '', webApiKey: '' } })
      await outside.openPath(f)
      return
    }
    case 'open-url':
      // only official pages from presets are passed here
      if (arg && /^https:\/\//.test(arg)) await outside.openExternal(arg)
      return
    case 'quit':
      app.quit()
      return
    default:
      log.warn(`unknown command ${command}`)
  }
}

/** Emulators being installed / updated right now (a second press doesn't start a second download). */
const installing = new Set<string>()

async function doInstallEmulator(id: string): Promise<{ ok: boolean; error?: string; info?: EmulatorInfo }> {
  // a running game has the emulator's files open: updating now would leave it half old, half new
  if (runningGame()) {
    notify({ kind: 'warning', title: 'Close the game first', detail: 'Emulators are installed and updated while no game is running.' })
    return { ok: false, error: 'Close the game first.' }
  }
  if (installing.has(id)) return { ok: false, error: 'It is being installed already.' }
  // hidden test runs never download real emulators (hundreds of MB) unless a test asks for it on purpose
  if (HEADLESS && process.env.STARSTATION_TEST_NETWORK !== '1') return { ok: false, error: 'No downloads in hidden test runs.' }
  installing.add(id)
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
    installing.delete(id)
    send('emulator-progress', { id, text: '' })
  }
}

/** Ask for PS3UPDAT.PUP (from Sony's official page) and install it into RPCS3. */
async function installPs3Firmware(): Promise<void> {
  const ps3 = getConsole('ps3')
  const e = ps3 ? getEmulator(ps3.emulator) : undefined
  if (!ps3 || !e || !fs.existsSync(emulatorExe(e))) {
    notify({ kind: 'error', title: 'RPCS3 is not installed', detail: 'Install it in Settings → Games & emulators → Emulators first.' })
    return
  }
  const choice = await messageBox({
    type: 'question',
    title: 'PS3 firmware',
    message: 'RPCS3 needs the official PS3 system software (PS3UPDAT.PUP).',
    detail: 'Download it from playstation.com, then choose the file here.',
    buttons: ['Choose PS3UPDAT.PUP…', 'Open download page', 'Cancel'],
    cancelId: 2
  })
  if (choice.response === 1 && ps3.bios?.url) await outside.openExternal(ps3.bios.url)
  if (choice.response !== 0) return
  const pick = await openDialog({
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

/**
 * Every request from the menu goes through here: a failure is written to the log with its name
 * (the menu then shows its own message), instead of disappearing without a trace.
 */
function handle(channel: string, fn: (e: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (e, ...args) => {
    // package transfers one at a time: two would share croc and the staging folders
    const exclusive = TRANSFERS.has(channel)
    if (exclusive && transferring) return { ok: false, error: 'Another package transfer is running.' }
    if (exclusive) transferring = true
    try {
      return await fn(e, ...args)
    } catch (err) {
      log.error(`${channel} failed`, err)
      throw err
    } finally {
      if (exclusive) transferring = false
    }
  })
}
const TRANSFERS = new Set(['package-send', 'package-save-folder', 'package-receive', 'package-receive-folder', 'package-finish'])
let transferring = false

function registerIpc(): void {
  handle('state', () => state())
  handle('import-scan', () =>
    findSources().map((s, index) => {
      const plan = planImport(s)
      return { index, label: s.label, summary: summarize(plan), skipped: plan.skipped }
    })
  )
  let importing = false
  handle('import-run', async (_e, index: number) => {
    const source = findSources()[index]
    if (!source) return { ok: false, copied: 0, moved: 0, conflicts: [], errors: ['Source not found'] }
    // one import at a time: two would copy and move the same files at once
    if (importing) return { ok: false, copied: 0, moved: 0, conflicts: [], errors: ['An import is already running.'] }
    importing = true
    const result = await runImport(planImport(source), (p) => send('import-progress', p)).finally(() => (importing = false))
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
  handle('emulators', () => emulatorInfos())
  handle('emulators-check', () => checkUpdates())
  handle('emulator-install', (_e, id: string) => doInstallEmulator(id))
  handle('set-setting', (_e, key: keyof Settings, value: Settings[keyof Settings]) => {
    const s = setSetting(key, value as never)
    if (key === 'showEmptyConsoles') send('consoles', consoleInfos())
    if (key === 'startWithWindows' && app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!value })
    if (key === 'tvMode') applyTvMode()
    return s
  })
  handle('rescan', () => {
    const l = rescan()
    send('consoles', consoleInfos())
    return l
  })
  handle('launch', (_e, id: string, mode?: 'fresh' | 'resume', np?: { host: true } | { join: NetplayRoom }, pads?: PlayerPad[]) => {
    const g = getGame(id)
    if (updatingGame() === id) return { ok: false, error: 'This game is being updated. It can start when the update is done.' }
    if (compressing === id) return { ok: false, error: 'This game is being compressed. It can start when that is done.' }
    if (savesBusy.has(id)) return { ok: false, error: 'Its saves are being backed up or restored. It can start in a moment.' }
    const emu = g ? getConsole(g.console)?.emulator : undefined
    if (emu && installing.has(emu)) return { ok: false, error: 'Its emulator is being installed or updated. The game can start when that is done.' }
    if (switchPending()) return { ok: false, error: 'Switching profiles didn’t finish. Close Starstation and start it again, then play.' }
    const online = np && g && getConsole(g.console)?.netplay ? np : undefined
    // controller assignment: player N → that pad, in every emulator's own way (controllers.ts)
    const order = Array.isArray(pads) ? pads.filter((p) => (p.api === 'xinput' || p.api === 'sdl') && Number.isInteger(p.index)).slice(0, 4) : []
    const vars = { ...(order.length ? padVars(order) : {}), ...(online ? netplayVars('host' in online) : {}) }
    sessionPlayers.set(id, order.length || knownPlayers())
    let args: string[] = []
    try {
      args = online ? netplayArgs(online) : []
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
    return launch(id, mode === 'resume' ? 'resume' : 'fresh', [], { args, vars })
  })
  handle('health', () => healthCheck())
  handle('export-report', async () => {
    const name = `starstation-report-${new Date().toISOString().slice(0, 10)}.zip`
    let to = dir('config', 'diagnostics', name)
    if (!HEADLESS) {
      const pick = await saveDialog({ title: 'Save diagnostics report', defaultPath: to, filters: [{ name: 'Zip', extensions: ['zip'] }] })
      if (pick.canceled || !pick.filePath) return null
      to = pick.filePath
    }
    await exportReport(to)
    notify({ kind: 'success', title: 'Report saved', detail: to, action: { label: 'Show file', command: 'show-file', arg: to } })
    return to
  })
  handle('ra-status', () => raStatus())
  handle('ra-login', async () => {
    const r = await raLogin()
    notify(r.ok ? { kind: 'achievement', title: 'Logged in to RetroAchievements', detail: raStatus().username } : { kind: 'error', title: 'RetroAchievements login failed', detail: r.error })
    return r
  })
  handle('ra-logout', () => raLogout())
  handle('netplay-rooms', (_e, id: string) => {
    const g = getGame(id)
    return g ? listRooms(g) : []
  })
  handle('steam-status', () => steamStatus())
  handle('steam-add', () => {
    const r = addToSteam()
    notify(r.ok ? { kind: 'success', title: 'Added to Steam', detail: 'Start Steam: Starstation is in your library (Non-Steam).' } : { kind: 'error', title: 'Not added to Steam', detail: r.error })
    return r
  })
  handle('custom-console', (_e, id: string) => customConsoleForm(id))
  handle('custom-console-save', (_e, form: CustomConsoleForm) => {
    const r = saveCustomConsole(form)
    if (r.ok) {
      send('library', rescan())
      send('consoles', consoleInfos())
    }
    return r
  })
  handle('custom-console-remove', (_e, id: string) => {
    removeCustomConsole(id)
    send('library', rescan())
    send('consoles', consoleInfos())
  })
  handle('pick-exe', async () => {
    const pick = await openDialog({ title: 'Choose the emulator program', properties: ['openFile'], filters: [{ name: 'Programs', extensions: ['exe'] }] })
    return pick.canceled ? null : (pick.filePaths[0] ?? null)
  })
  handle('library-clear-cache', () => {
    fs.rmSync(dir('config', 'library', 'library.json'), { force: true })
    loadLibrary()
    scanAndArt()
  })
  // ---- packages ----
  const pkgProgress = (p: PackageProgress) => send('package-progress', p)
  const pkgAskFolders = new Set<string>()
  const afterReceive = async (r: { ok: boolean; added?: number; kept?: number; error?: string; ask?: string[]; folder?: string }) => {
    if (r.ask) {
      // profiles that exist here already: ask first (nothing has been unpacked yet)
      if (r.folder) pkgAskFolders.add(path.resolve(r.folder).toLowerCase())
      send('package-ask', { profiles: r.ask, folder: r.folder })
      return r
    }
    if (!r.ok) {
      pkgProgress({ phase: 'error', pct: 0, detail: r.error })
      return r
    }
    loadPresets()
    for (const c of allConsoles()) if (getEmulator(c.emulator)) applyConsoleConfig(c)
    const lib = rescan()
    for (const g of lib.games) await enablePending(getGame(g.id)!).catch((e) => log.warn('mod re-enable failed', e))
    send('library', view())
    send('consoles', consoleInfos())
    send('collections', listCollections())
    notify({ kind: 'success', title: 'Package received', detail: `${r.added ?? 0} file(s) added${r.kept ? `, ${r.kept} already here and kept` : ''}.` })
    return r
  }
  handle('package-size', (_e, c: PackageChoice) => packageSize(c))
  handle('package-send', async (_e, c: PackageChoice) => {
    const r = await sendByCode(c, () => undefined, pkgProgress).catch((e) => ({ ok: false, error: (e as Error).message }))
    if (!r.ok) pkgProgress({ phase: 'error', pct: 0, detail: r.error })
    else notify({ kind: 'success', title: 'Package sent' })
    return r
  })
  handle('package-save-folder', async (_e, c: PackageChoice) => {
    let base = dir('backups', 'packages')
    if (!HEADLESS) {
      const pick = await openDialog({ title: 'Choose where to save the package (e.g. a USB drive)', properties: ['openDirectory', 'createDirectory'] })
      if (pick.canceled || !pick.filePaths[0]) return null
      base = pick.filePaths[0]
    }
    const folder = path.join(base, `Starstation package ${new Date().toISOString().slice(0, 10)}`)
    // the other PC put its inventory on this drive: leave out what it has (smart package)
    const have = readJson<Inventory | null>(path.join(base, INVENTORY_FILE), null)
    try {
      await buildPackage(c, folder, false, pkgProgress, have)
      if (have) noteSent(have.pcId)
      pkgProgress({ phase: 'done', pct: 1, detail: folder })
      notify({ kind: 'success', title: 'Package saved', detail: folder, action: { label: 'Open folder', command: 'open-path', arg: folder } })
      return { ok: true, folder }
    } catch (e) {
      pkgProgress({ phase: 'error', pct: 0, detail: (e as Error).message })
      return { ok: false, error: (e as Error).message }
    }
  })
  handle('package-receive', async (_e, code: string, useSettings: boolean) =>
    afterReceive(await receiveByCode(String(code), { useSettings: !!useSettings }, pkgProgress).catch((e) => ({ ok: false, error: (e as Error).message })))
  )
  handle('package-receive-folder', async (_e, useSettings: boolean, folder?: string) => {
    let f = folder
    if (!f || !HEADLESS) {
      if (HEADLESS) return null
      const pick = await openDialog({ title: 'Choose the package folder', properties: ['openDirectory'] })
      if (pick.canceled || !pick.filePaths[0]) return null
      f = pick.filePaths[0]
    }
    return afterReceive({ ...(await receiveFromFolder(f, { useSettings: !!useSettings }, pkgProgress).catch((e) => ({ ok: false, error: (e as Error).message, added: 0, kept: 0 }))), folder: f })
  })
  handle('package-cancel', () => cancelTransfer())
  // receiving PC: put "what I have" on a USB drive, so the package saved there only holds the rest
  handle('package-prepare-folder', async (_e, folder?: string) => {
    let f = HEADLESS && typeof folder === 'string' ? folder : null
    if (!f) {
      const pick = await openDialog({ title: 'Choose the drive or folder the package will be saved to', properties: ['openDirectory', 'createDirectory'] })
      if (pick.canceled || !pick.filePaths[0]) return null
      f = pick.filePaths[0]
    }
    writeJson(path.join(f, INVENTORY_FILE), inventory())
    notify({ kind: 'success', title: 'Ready for a package', detail: 'Now save the package to this drive on the other PC: only what is missing here goes on it.' })
    return f
  })
  // profiles with names that exist here: the answers (merge / replace / keep both) finish the receiving
  handle('package-finish', async (_e, folder: string, useSettings: boolean, choices: Record<string, ProfileMerge>) => {
    const f = path.resolve(String(folder))
    if (!f.toLowerCase().startsWith(dir('config', 'packages').toLowerCase()) && !(HEADLESS || pkgAskFolders.has(f.toLowerCase())))
      return { ok: false, error: 'Unknown package folder' }
    const r = await afterReceive(
      await receiveFromFolder(f, { useSettings: !!useSettings, profiles: choices }, pkgProgress).catch((e) => ({ ok: false, error: (e as Error).message, added: 0, kept: 0 }))
    )
    if (r.ok && f.toLowerCase().startsWith(dir('config', 'packages').toLowerCase())) await fs.promises.rm(f, { recursive: true, force: true })
    return r
  })
  // ---- first start ----
  handle('setup-status', () => {
    const done = !!readJson<{ done?: boolean }>(dir('config', 'setup.json'), {}).done
    // the first scan may still be running: also look into the games folders themselves
    const gamesOnDisk = allConsoles().some((c) => {
      try {
        return fs.readdirSync(dir('games', c.id)).length > 0
      } catch {
        return false
      }
    })
    const existing = gamesOnDisk || view().games.length > 0 || allEmulators().some((e) => !path.isAbsolute(e.folder) && fs.existsSync(emulatorExe(e)))
    return { done, existing, filesDir: filesDir() }
  })
  handle('setup-done', () => writeJson(dir('config', 'setup.json'), { done: true, at: new Date().toISOString() }))
  handle('update-state', () => updateState())
  handle('update-check', () => checkNow(notify))
  // ---- safe updates + safe mode (SPEC-v2 B, G) ----
  handle('start-notes', () => takeStartNotes())
  handle('guide-seen', (_e, keys: string[]) => markGuideSeen(Array.isArray(keys) ? keys.map(String) : []))
  // ---- PS button menu (SPEC-v2 A) ----
  handle('overlay-state', () => overlayState())
  handle('pad-snapshot', () => xinputSnapshot())
  handle('xpads-now', () => (HEADLESS && !REAL_PADS ? null : xpadFeed()))
  // ---- library & storage (SPEC-v2 D) ----
  handle('storage', (_e, fresh?: boolean) => storageInfo(!!fresh))
  // ---- system settings from the menu (SPEC-v2 G; Hannes allowed changing them when picked here) ----
  handle('sys-audio', () => audioOutputs())
  handle('sys-audio-set', async (_e, id: string) => {
    const ok = await setAudioOutput(String(id))
    log.info(`sound output → ${id}: ${ok}`)
    return ok
  })
  handle('sys-display', () => displayModes())
  let displayRevert: { timer: NodeJS.Timeout; back: { w: number; h: number; hz: number } } | null = null
  handle('sys-display-set', async (_e, w: number, h: number, hz: number) => {
    const before = (await displayModes()).find((m) => m.current)
    if (!(await setDisplayMode(Number(w), Number(h), Number(hz), true))) return { ok: false, error: 'This screen doesn’t take that mode.' }
    if (!(await setDisplayMode(Number(w), Number(h), Number(hz)))) return { ok: false, error: 'Windows didn’t change the screen.' }
    log.info(`screen → ${w}×${h} @ ${hz} Hz (back in 15 s unless kept)`)
    // like Windows: no answer within 15 s (a black screen, say) → back to how it was
    if (displayRevert) clearTimeout(displayRevert.timer)
    if (before)
      displayRevert = {
        back: before,
        timer: setTimeout(() => {
          void setDisplayMode(before.w, before.h, before.hz)
          displayRevert = null
          send('display-revert', null)
          log.info('screen mode not confirmed: went back')
        }, 15_000)
      }
    return { ok: true }
  })
  handle('sys-display-keep', async (_e, keep: boolean) => {
    if (!displayRevert) return
    clearTimeout(displayRevert.timer)
    if (!keep) await setDisplayMode(displayRevert.back.w, displayRevert.back.h, displayRevert.back.hz)
    displayRevert = null
  })
  handle('sys-bt', (_e, scan: boolean) => bluetoothDevices(!!scan))
  handle('sys-bt-pair', async (_e, address: string) => {
    const r = await bluetoothPair(String(address))
    log.info(`bluetooth pair ${address}: ${r.ok ? 'ok' : r.error}`)
    return r
  })
  handle('sys-bt-remove', (_e, address: string) => bluetoothRemove(String(address)))
  // ---- profiles (SPEC-v2 G) ----
  handle('profiles', () => listProfiles())
  handle('profile-add', (_e, name: string, icon?: string) => addProfile(String(name), icon ? String(icon) : undefined))
  handle('profile-update', (_e, id: string, change: { name?: string; icon?: string }) => updateProfile(String(id), { name: change?.name, icon: change?.icon }))
  handle('profile-pin', (_e, id: string, pin: string | null, oldPin?: string) => setPin(String(id), pin === null ? null : String(pin), oldPin, true))
  handle('profile-delete', (_e, id: string) => deleteProfile(String(id), trash))
  handle('profile-picture', async (_e, id: string, file?: string) => {
    let src = HEADLESS && typeof file === 'string' ? file : null
    if (!src) {
      const pick = await openDialog({ title: 'Choose a profile picture', properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg'] }] })
      if (pick.canceled || !pick.filePaths[0]) return listProfiles()
      src = pick.filePaths[0]
    }
    let img = nativeImage.createFromPath(src)
    if (img.isEmpty()) return listProfiles()
    img = img.resize({ width: 256, height: 256, quality: 'best' })
    const to = dir('media', 'profiles', `${String(id).replace(/\W/g, '')}-${Date.now()}.png`)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.writeFileSync(to, img.toPNG())
    return updateProfile(String(id), { image: to })
  })
  handle('profile-switch', async (_e, id: string, pin?: string) => {
    if (runningGame()) return { ok: false, error: 'Close the game first.' }
    const r = await switchProfile(String(id), pin === undefined ? undefined : String(pin))
    if (!r.ok) return r
    // everything that belongs to a profile is read again
    loadLibrary()
    // reload once the answer is back (reloading first could drop the answer)
    setTimeout(() => win?.webContents.reload(), 50)
    return r
  })
  // ---- console feel (SPEC-v2 C) ----
  handle('wallpapers', () => wallpapers())
  handle('wallpaper-set', async (_e, kind: string, file?: string | null) => {
    let src: string | null = HEADLESS && typeof file === 'string' ? file : null
    if (file === null) src = null
    else if (!src) {
      const pick = await openDialog({ title: 'Choose a picture', properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg'] }] })
      if (pick.canceled || !pick.filePaths[0]) return { ok: false }
      src = pick.filePaths[0]
    }
    const r = setWallpaper(String(kind), src)
    if (r.ok) send('wallpapers', wallpapers())
    return r
  })
  handle('power', (_e, action: string) => {
    // never with a game running: it would end without saving
    if (runningGame()) return
    if (action === 'sleep' || action === 'shutdown') power(action)
  })
  // ---- Nexus Mods ----
  handle('nxm-open', (_e, url: string) => openNxm(String(url)))
  handle('nexus-status', () => ({ key: !!nexusKey(), registered: registerNxm(), patches: patchStatus() }))
  handle('update-patches', async () => {
    const r = await updatePatches()
    notify(
      r.errors.length
        ? { kind: 'error', title: 'Some patches were not updated', detail: r.errors.join(' · ') }
        : { kind: 'success', title: 'Patches updated', detail: r.done.join(' · ') }
    )
    return r
  })
  handle('nexus-install', async (_e, url: string, gameId: string) => {
    const g = getGame(String(gameId))
    if (!g) return { ok: false, error: 'Game not found' }
    try {
      const req = await describeNxm(String(url))
      notify({ kind: 'info', title: 'Downloading from Nexus Mods…', detail: req.modName })
      const file = await downloadNxm(String(url))
      const r = await addMod(g, file, { name: req.modName, description: req.summary, source: { type: 'nexus', ref: String(url) } }).then(modAdded(g))
      await fs.promises.rm(file, { force: true })
      return r
    } catch (e) {
      notify({ kind: 'error', title: 'Nexus Mods mod not installed', detail: (e as Error).message })
      return { ok: false, error: (e as Error).message }
    }
  })
  handle('read-media', async (_e, p: string) => {
    // only files inside Files\ (manuals in media\artwork), and not huge ones
    const abs = path.resolve(String(p))
    if (!abs.toLowerCase().startsWith(path.resolve(filesDir()).toLowerCase() + path.sep)) return null
    try {
      if ((await fs.promises.stat(abs)).size > 300 * 1024 ** 2) return null
      return new Uint8Array(await fs.promises.readFile(abs))
    } catch {
      return null
    }
  })
  handle('compress-game', (_e, id: string) => doCompress(String(id)))
  handle('ps3-update-info', async (_e, id: string) => {
    const g = getGame(String(id))
    return g ? updateInfo(g).catch(() => null) : null
  })
  handle('ps3-update', async (_e, id: string) => {
    const g = getGame(String(id))
    if (!g) return { ok: false, error: 'Game not found' }
    if (runningGame()) return { ok: false, error: 'Close the game first.' }
    const r = await runUpdate(g, (text) => send('ps3update-progress', { gameId: g.id, text }))
    if (r.ok && r.version) notify({ kind: 'success', title: `${g.title} updated`, detail: `Now on version ${r.version}.` })
    else if (!r.ok) notify({ kind: 'error', title: `${g.title} was not updated`, detail: r.error ?? '' })
    return r
  })
  handle('couch-start', () => startCouchCheck())
  handle('couch-status', () => couchStatus())
  handle('couch-pad', () => couchMark('pad'))
  handle('couch-save', () => {
    const f = saveCouchCheck()
    notify({ kind: 'success', title: 'Couch check saved', detail: f, action: { label: 'Show file', command: 'show-file', arg: f } })
    return f
  })
  handle('overlay-action', (_e, a: OverlayAction) => overlayAction(a))
  handle('test-home', (_e, pad?: unknown) => {
    if (HEADLESS || COUCH_TEST) toggleOverlay(typeof pad === 'string' ? pad : undefined)
  })
  // couch test: who has the focus right now (the game, the PS button menu or Starstation)?
  handle('test-fg', async () => (COUCH_TEST ? { fg: await foregroundPid(), emulator: runningPid(), starstation: process.pid } : null))
  handle('undo-update', (_e, to: string) => undoUpdate(String(to)))
  handle('release-everyone', async () => {
    const r = await releaseToEveryone()
    notify(
      r.ok
        ? { kind: 'success', title: r.already ? 'Already released to everyone' : 'Released to everyone', detail: `Version ${app.getVersion()} — the other PCs update on their next start.` }
        : { kind: 'error', title: 'Not released', detail: r.error }
    )
    return r
  })
  handle('emulator-mark-tested', async (_e, id: string) => {
    const r = await markTested(String(id))
    notify(r.ok ? { kind: 'success', title: 'Marked as tested', detail: 'The other PCs are offered this version now.' } : { kind: 'error', title: 'Not marked as tested', detail: r.error })
    return r
  })
  handle('safe-mode', async (_e, on: boolean) => {
    if (runningGame()) return { ok: false, error: 'Close the game first.' }
    if (on) enterSafeMode()
    else await leaveSafeMode()
    // start the menu again so everything is read the safe (or normal) way
    win?.webContents.reload()
    return { ok: true }
  })
  handle('licenses', () =>
    allEmulators()
      .filter((e) => !path.isAbsolute(e.folder))
      .map((e) => {
        const d = emulatorDir(e)
        const f = ['LICENSE.txt', 'LICENSE', 'COPYING', 'COPYING.txt', 'LICENSE.md'].map((n) => path.join(d, n)).find((p) => fs.existsSync(p))
        return { id: e.id, name: e.name, license: e.license ?? 'see the emulator', file: f }
      })
  )
  handle('game-details', (_e, id: string): GameDetails | null => {
    const g = getGame(id)
    if (!g) return null
    // each part on its own: one that fails (a save file gone between listing and reading) leaves the rest
    const safe = <T>(what: string, fn: () => T, fallback: T): T => {
      try {
        return fn()
      } catch (e) {
        log.warn(`${id}: ${what} could not be read`, e)
        return fallback
      }
    }
    const ml = safe('mods', () => listMods(g), [])
    return {
      mods: { total: ml.length, on: ml.filter((m) => m.enabled).length, supported: safe('mod support', () => modSupport(g).targets.length > 0, false) },
      options: safe('options', () => gameOptions(g), { graphics: getSettings().graphicsDefault, crt: getSettings().crtDefault, patches: {} }),
      available: safe('available options', () => availableOptions(g), { graphics: false, crt: false, patches: [] }),
      resume: safe('resume state', () => resumeInfo(g), null),
      backups: safe('backups', () => listBackups(g), []),
      ownSaves: safe('own saves', () => ownSaves(g).length, 0),
      canBackup: !!getConsole(g.console)?.backup?.length,
      previousResume: safe('earlier resume state', () => previousResume(g)?.savedAt ?? null, null),
      compress: safe('compress option', () => compressOption(g) ?? undefined, undefined)
    }
  })
  handle('backup-now', async (_e, id: string) => {
    const g = getGame(id)
    if (!g || savesBusy.has(id)) return null
    savesBusy.add(id)
    const o = await backupOutcome(g, 'manual').finally(() => savesBusy.delete(id))
    if (o.status === 'made') await pruneBackups(g)
    const say = {
      made: { kind: 'save', title: 'Saves backed up' },
      unchanged: { kind: 'info', title: 'Saves unchanged since the last backup' },
      'no-saves': { kind: 'info', title: 'No saves found yet' },
      'too-big': { kind: 'warning', title: 'Saves too big to back up (over 1 GB)' },
      failed: { kind: 'error', title: 'Backup failed' }
    } as const
    notify({ ...say[o.status], detail: o.status === 'failed' ? `${g.title}: ${o.error}` : g.title })
    return o.status === 'made' ? o.backup : null
  })
  handle('backup-restore', async (_e, id: string, backupId: string) => {
    const g = getGame(id)
    if (!g) return { ok: false, error: 'Game not found' }
    if (runningGame()) return { ok: false, error: 'Close the game first.' }
    if (savesBusy.has(id)) return { ok: false, error: 'Its saves are being restored right now.' }
    savesBusy.add(id)
    try {
      await restoreBackup(g, backupId)
      notify({ kind: 'save', title: 'Saves restored', detail: g.title })
      return { ok: true }
    } catch (e) {
      notify({ kind: 'error', title: 'Restore failed', detail: (e as Error).message })
      return { ok: false, error: (e as Error).message }
    } finally {
      savesBusy.delete(id)
    }
  })
  handle('resume-restore-previous', async (_e, id: string) => {
    const g = getGame(id)
    if (!g) return { ok: false, error: 'Game not found' }
    if (runningGame()) return { ok: false, error: 'Close the game first.' }
    if (savesBusy.has(id)) return { ok: false, error: 'Its saves are being restored right now.' }
    savesBusy.add(id)
    try {
      await restorePreviousResume(g)
      notify({ kind: 'save', title: 'Earlier resume point is back', detail: g.title })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    } finally {
      savesBusy.delete(id)
    }
  })
  handle('game-option-set', (_e, id: string, key: 'graphics' | 'crt' | 'patch', value: string | boolean, patchId?: string) => {
    const g = getGame(id)
    return g ? setGameOption(g, key, value, patchId) : null
  })
  handle('report-pads', (_e, ids: string[]) => reportPads(Array.isArray(ids) ? ids.map(String) : []))
  handle('screenshots', () => listScreenshots())
  handle('refresh-artwork', async (_e, id: string) => {
    const g = getGame(id)
    if (!g) return false
    const got = await fetchArtwork(g, true)
    if (reattachArtwork() || got) send('library', view())
    if (!got) notify({ kind: 'info', title: 'No new artwork found', detail: g.title })
    return got
  })
  handle('custom-art', async (_e, id: string, kind: string, file?: string) => {
    const g = getGame(id)
    if (!g) return { ok: false, error: 'Game not found' }
    if (kind === 'reset') {
      setCustomArt(g, 'icon', null)
      setCustomArt(g, 'background', null)
      send('library', view())
      return { ok: true }
    }
    if (kind !== 'icon' && kind !== 'background') return { ok: false, error: 'Unknown picture' }
    let src = HEADLESS && typeof file === 'string' ? file : null
    if (!src) {
      const pick = await openDialog({
        title: `${kind === 'icon' ? 'Choose a cover' : 'Choose a background'} for ${g.title}`,
        properties: ['openFile'],
        filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg'] }]
      })
      if (pick.canceled || !pick.filePaths[0]) return { ok: false }
      src = pick.filePaths[0]
    }
    let img = nativeImage.createFromPath(src)
    if (img.isEmpty()) {
      // Electron is stricter than the menu: a real PNG/JPG it can't read is kept as it is
      const raw = fs.readFileSync(src)
      const isPic = raw.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) || (raw[0] === 0xff && raw[1] === 0xd8)
      if (!isPic) return { ok: false, error: 'Starstation can only use PNG or JPG pictures.' }
      setCustomArt(g, kind, raw)
    } else {
      // keep the saved copy small: covers up to 1024 px wide, backgrounds up to 2560 px
      const max = kind === 'icon' ? 1024 : 2560
      if (img.getSize().width > max) img = img.resize({ width: max, quality: 'best' })
      setCustomArt(g, kind, img.toPNG())
    }
    send('library', view())
    return { ok: true }
  })
  // ---- mods ----
  const withGame = <T>(id: string, fn: (g: NonNullable<ReturnType<typeof getGame>>) => T): T | { ok: false; error: string } => {
    const g = getGame(id)
    return g ? fn(g) : { ok: false, error: 'Game not found' }
  }
  const notRunning = (id: string) => (runningGame()?.gameId === id ? { ok: false as const, error: 'Close the game first.' } : null)
  handle('mods', (_e, id: string) => {
    const g = getGame(id)
    return g ? { mods: listMods(g), ...modSupport(g), ...modProfiles(g) } : null
  })
  handle('mod-profile-save', (_e, id: string, name: string) => withGame(id, (g) => void saveModProfile(g, String(name))))
  handle('mod-profile-delete', (_e, id: string, pid: string) => withGame(id, (g) => deleteModProfile(g, String(pid))))
  handle('mod-profile-apply', (_e, id: string, pid: string) => notRunning(id) ?? withGame(id, (g) => applyModProfile(g, String(pid))))
  // the menu (re)loaded (start, safe mode, profile switch, after a crash): it asks for questions still open
  handle('mod-inbox-open', () => openInboxQuestions())
  handle('mod-inbox-assign', (_e, id: string, gameId: string) => assignInbox(String(id), String(gameId ?? '')))
  handle('mod-add', (_e, id: string, p: string) => withGame(id, (g) => addMod(g, p).then(modAdded(g))))
  handle('mod-add-dialog', async (_e, id: string, folder: boolean) => {
    const g = getGame(id)
    if (!g) return null
    const pick = await openDialog({
      title: folder ? 'Choose a mod folder' : 'Choose a mod file',
      properties: [folder ? 'openDirectory' : 'openFile'],
      ...(folder ? {} : { filters: [{ name: 'Mods', extensions: ['zip', '7z', 'rar', 'pnach', 'png', 'dds', 'ips', 'bps', 'ppf', 'xdelta', 'vcdiff'] }, { name: 'All files', extensions: ['*'] }] })
    })
    if (pick.canceled || !pick.filePaths[0]) return null
    return addMod(g, pick.filePaths[0]).then(modAdded(g))
  })
  handle('mod-place', (_e, id: string, pending: string, target: string) => withGame(id, (g) => finishAdd(g, pending, target).then(modAdded(g))))
  handle('mod-toggle', (_e, id: string, modId: string, on: boolean, winner?: 'this' | 'other') =>
    notRunning(id) ?? withGame(id, (g) => setModEnabled(g, modId, !!on, winner === 'this' || winner === 'other' ? winner : undefined))
  )
  handle('mod-delete', (_e, id: string, modId: string) => notRunning(id) ?? withGame(id, (g) => deleteMod(g, modId)))
  handle('gb-search', async (_e, id: string, name?: string) => {
    const g = getGame(id)
    if (!g) return { games: [] }
    return { games: await searchGames(name ?? g.title), chosen: gamebananaGame(g) }
  })
  handle('gb-choose', (_e, id: string, gbId: number) => {
    const g = getGame(id)
    if (g) setGamebananaGame(g, Number(gbId))
  })
  handle('gb-mods', (_e, gbId: number, page: number) => listGbMods(Number(gbId), Number(page) || 1))
  handle('gb-mod', (_e, modId: number) => gbModDetails(Number(modId)))
  handle('gb-install', (_e, id: string, modId: number, fileId: number) =>
    withGame(id, (g) => installGbMod(g, Number(modId), Number(fileId)).then(modAdded(g)))
  )
  handle('delete-game', (_e, id: string, withSaves: boolean) => deleteGame(id, !!withSaves))
  handle('collection-create', (_e, name: string, first?: string) => pushCollections(createCollection(name, first)))
  handle('collection-rename', (_e, id: string, name: string) => pushCollections(renameCollection(id, name)))
  handle('collection-delete', (_e, id: string) => pushCollections(deleteCollection(id)))
  handle('collection-toggle', (_e, id: string, gameId: string) => pushCollections(toggleInCollection(id, gameId)))
  handle('add-games', (_e, paths: string[], consoleId?: string) => doAddGames(paths, consoleId))
  handle('add-games-dialog', async () => {
    const pick = await openDialog({ title: 'Add games', properties: ['openFile', 'multiSelections'] })
    if (pick.canceled || !pick.filePaths.length) return null
    return doAddGames(pick.filePaths)
  })
  handle('toggle-favorite', (_e, id: string) => toggleFavorite(id))
  handle('open-folder', (_e, kind: string, arg?: string) => runCommand('open-folder', arg ? `${kind}:${arg}` : kind))
  handle('run-command', (_e, command: string, arg?: string) => runCommand(command, arg))
  handle('toggle-fullscreen', () => {
    if (!win) return false
    win.setFullScreen(!win.isFullScreen())
    return win.isFullScreen()
  })
  handle('quit', () => app.quit())
  handle('renderer-error', (_e, where: string, message: string) => log.error(`menu error (${String(where).slice(0, 40)})`, String(message).slice(0, 4000)))
}

/** Compress or decompress one game (only one at a time; never while it runs). */
let compressing: string | null = null
async function doCompress(id: string): Promise<{ ok: boolean; error?: string }> {
  const g = getGame(id)
  if (!g) return { ok: false, error: 'Game not found' }
  if (compressing) return { ok: false, error: 'Another game is being compressed right now.' }
  if (runningGame()) return { ok: false, error: 'Close the game first.' }
  const opt = compressOption(g)
  if (!opt) return { ok: false, error: 'This game can’t be compressed.' }
  compressing = id
  const progress = (text: string) => send('compress-progress', { gameId: id, text })
  try {
    const r = opt.action === 'compress' ? await compressGame(g, progress, trash) : await decompressGame(g, progress, trash)
    if (!r.ok) {
      notify({ kind: 'error', title: opt.action === 'compress' ? 'Not compressed' : 'Not decompressed', detail: r.error })
      return r
    }
    // the file has a new name: play time, favorite, collections and game options follow it
    const lib = rescan()
    const next = lib.games.find((x) => x.path.toLowerCase() === r.path.toLowerCase())
    if (next && next.id !== id) {
      moveStats(id, next.id)
      moveGameOptions(id, next.id)
      send('collections', moveGameInCollections(id, next.id))
    }
    send('library', view())
    send('consoles', consoleInfos())
    notify({ kind: 'success', title: opt.action === 'compress' ? 'Game compressed' : 'Game decompressed', detail: `${g.title}: ${path.basename(r.path)}. The old file is in the Recycle Bin.` })
    return { ok: true }
  } finally {
    compressing = null
    progress('')
  }
}

/** Notification after a mod was added (or why not). */
function modAdded(g: { title: string }) {
  return <T extends { ok: boolean; mod?: { name: string }; error?: string; ask?: unknown }>(r: T): T => {
    if (r.ok && r.mod) {
      notify({ kind: 'mod', title: 'Mod installed', detail: `${r.mod.name} · ${g.title}` })
    } else if (!r.ok && r.error && r.error !== 'Cancelled.') notify({ kind: 'error', title: 'Mod not added', detail: r.error })
    return r
  }
}

function pushCollections<T>(list: T): T {
  send('collections', list)
  return list
}

async function doAddGames(paths: string[], consoleId?: string): Promise<AddGamesResult> {
  // PS3 packages aren't games in a folder: they are installed into RPCS3
  const pkgs = paths.filter((p) => /\.pkg$/i.test(p) && (!consoleId || consoleId === 'ps3'))
  for (const p of pkgs) {
    notify({ kind: 'info', title: 'Installing a PS3 package…', detail: `${path.basename(p)} — RPCS3 shows its progress.` })
    notify(await installPkg(p, trash).catch((e) => ({ kind: 'error' as const, title: 'PS3 package not installed', detail: (e as Error).message })))
  }
  const r = await addGames(
    paths.filter((p) => !pkgs.includes(p)),
    consoleId
  )
  if (pkgs.length && !r.added.length) send('library', rescan())
  // conversion on import: Xbox → XISO, multi-disc playlists, 3DS encryption check
  if (r.added.length) for (const n of await afterAdd(r.added, trash).catch((e) => (log.warn('conversion after adding failed', e), []))) notify(n)
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
/** Games whose saves are being backed up or restored right now: no second restore, no start meanwhile. */
const savesBusy = new Set<string>()

/** Games being deleted right now (a second press while the first is binning the files does nothing). */
const deleting = new Set<string>()

async function deleteGame(id: string, withSaves: boolean): Promise<{ ok: boolean; error?: string }> {
  if (deleting.has(id)) return { ok: true }
  deleting.add(id)
  try {
    return await deleteGameNow(id, withSaves)
  } finally {
    deleting.delete(id)
  }
}

async function deleteGameNow(id: string, withSaves: boolean): Promise<{ ok: boolean; error?: string }> {
  const g = getGame(id)
  if (!g) return { ok: false, error: 'Game not found' }
  if (runningGame()?.gameId === id) return { ok: false, error: 'Close the game first.' }
  if (compressing === id) return { ok: false, error: 'This game is being compressed. Delete it when that is done.' }
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

/**
 * After every scan: fetch missing artwork in the background and show it as it arrives.
 * atStart: look again for every game that still has none, even if nothing was found last time.
 */
function scanAndArt(atStart = false): void {
  const lib = rescan()
  send('library', lib)
  send('consoles', consoleInfos())
  // PS3 game updates: only Sony's small update lists, once a day per game
  void checkPs3Updates(lib.games)
  // PS3 / Xbox 360 compatibility labels, looked up slowly in the background
  void refreshCompat(lib.games, () => send('library', view()))
  queueArtwork(
    lib.games,
    () => {
      if (reattachArtwork()) send('library', view())
    },
    atStart
  )
}

/** Battery of controller 1, about once a minute while the menu is shown. */
function startBatteryPolling(): void {
  if (HEADLESS) return
  const tick = async () => {
    if (!win || win.isDestroyed() || !win.isVisible() || runningGame()) return
    send('battery', await readBattery())
  }
  setTimeout(() => void tick(), 4000)
  setInterval(() => void tick(), 60_000)
}

function registerHooks(): void {
  onBeforeLaunch(async (id) => {
    const g = getGame(id)
    if (!g) return
    const o = await backupOutcome(g, 'launch')
    if (o.status === 'made') await pruneBackups(g)
    // the game still starts (the saves are where they were), but nobody should believe there is a fresh backup
    if (o.status === 'failed') notify({ kind: 'warning', title: 'Saves could not be backed up before starting', detail: `${g.title}: ${o.error}` })
  })
  onAfterExit(async (id, seconds) => {
    const g = getGame(id)
    if (!g || !getConsole(g.console)?.achievements || !raStatus().hasApiKey || seconds < 30) return
    const since = Math.max(lastUnlockCheck(), Date.now() - seconds * 1000)
    const list = await recentUnlocks((Date.now() - since) / 60000 + 1)
    lastUnlockCheck(Date.now())
    for (const a of list.slice(0, 3)) notify({ kind: 'achievement', title: `Achievement unlocked: ${a.title}`, detail: a.description })
    if (list.length > 3) notify({ kind: 'achievement', title: `${list.length - 3} more achievements unlocked`, detail: g.title })
  })
  onAfterExit(() => {
    // Nexus links that came in during the game
    const waiting = nxmWaiting
    nxmWaiting = []
    for (const u of waiting) void openNxm(u)
  })
  onAfterExit((id, _s, _c, startedAt) => {
    // the emulator's log, before the next game overwrites it (and its fatal error as a notice)
    void keepEmulatorLog(id, startedAt).catch((e) => log.warn('could not keep the emulator log', e))
  })
  onAfterExit(() => {
    // the game is gone: so is its menu
    if (overlayOpen()) void hideOverlay(false)
  })
  onAfterExit(() => {
    // new screenshots from the session show up in the Photo column
    send('screenshots', listScreenshots())
  })
  onAfterExit((id, _s, _c, startedAt) => {
    const v = noteResumeVersion(id, startedAt)
    // a resume state written this session: note the emulator version and how many controllers the game knew
    if (v) updateStats(id, (s) => ({ ...s, resumeVersion: v, resumePlayers: sessionPlayers.get(id) ?? knownPlayers() }))
  })
}

/** Players each game was started with (the game only looks for controllers when it boots). */
const sessionPlayers = new Map<string, number>()

/** A hidden run that still reads the real controllers through the pad helper (to measure the menu's input cost). */
const REAL_PADS = process.env.STARSTATION_REAL_PADS === '1'

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

/** What the menu shows once after starting. Taken once: a reload (safe mode) doesn't show it again. */
let startNotes: StartNotes | null = null
let session: StartInfo | null = null
function takeStartNotes(): StartNotes {
  if (!startNotes) {
    const fresh = takeNewVersion()
    const w = fresh ? whatsNewFor(app.getVersion(), compareVersions) : null
    const rescued = takeRescueNote()
    startNotes = {
      safeMode: inSafeMode(),
      // after a rescue the rescue note explains it; no safe-mode question on top
      crashed: !!session?.crashedLastTime && !inSafeMode() && !rescued,
      rescued,
      whatsNew: w ?? undefined,
      homeConflicts: HEADLESS && !process.env.STARSTATION_TEST_CONFLICTS ? [] : newHomeConflicts(),
      // like the PS3: with more than one profile, ask who is playing (the guest doesn't count)
      whoIsPlaying: listProfiles().filter((p) => !p.guest).length > 1
    }
    return startNotes
  }
  return { safeMode: inSafeMode(), crashed: false }
}

app.on('second-instance', (_e, argv) => {
  // a Nexus Mods "Download with mod manager" click starts a second Starstation with an nxm:// link
  const nxm = nxmFromArgs(argv)
  if (nxm) return void openNxm(nxm)
  if (win && !win.isDestroyed() && !runningGame()) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

/** Ask which game a Nexus mod is for (after the game, if one is running: never over it). */
let nxmWaiting: string[] = []
async function openNxm(url: string): Promise<void> {
  if (runningGame()) {
    nxmWaiting.push(url)
    return
  }
  try {
    const req = await describeNxm(url)
    send('nexus-request', req)
    if (win && !HEADLESS) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  } catch (e) {
    notify({ kind: 'error', title: 'Nexus Mods download not started', detail: (e as Error).message })
  }
}

async function start(): Promise<void> {
  if (!primary) return
  ensureDataDirs()
  log.info(`Starstation ${app.getVersion()} starting; Files=${filesDir()}${inSafeMode() ? ' (safe mode)' : ''}`)
  // crashed twice right after an update? then go back to the version before, before anything else
  session = startSession(app.getVersion())
  if (session.crashedLastTime) log.warn(`last run ended unexpectedly (${session.crashesInARow} in a row)`)
  if (await maybeRescue(session).catch((e) => (log.error('rescue failed', e), false))) return
  loadPresets()
  // profiles: a switch cut off half-way is finished, then saves / play time / favorites point at the active profile
  await finishInterruptedSwitch().catch((e) => log.error('could not finish the profile switch', e))
  applyProfilePaths()
  loadLibrary()
  // mods that safe mode set aside come back at every normal start (also after a crash in safe mode)
  if (!inSafeMode()) void restoreSuspended().catch((e) => log.warn('could not switch mods on again', e))
  registerIpc()
  registerHooks()
  registerMediaProtocol()
  win = createWindow()
  // closing the menu closes Starstation, also while the hidden PS button menu window is still there
  win.on('closed', () => {
    win = null
    quitAll()
  })
  win.on('session-end', onWindowsEnding)
  attachWindow(win)
  setLauncherWindow(win)
  // the PS button menu window comes after the menu has loaded (keeps start-up fast)
  win.webContents.once('did-finish-load', () => setupOverlay(path.join(__dirname, '../preload/index.js'), (w) => loadPage(w, 'overlay')))
  startPadHelper()
  loadGpuDrivers()
  // one press = one toggle: presses closer than this are a bounce or mashing (2026-11-07 log: the menu opened
  // again 90 ms after it closed, over and over)
  // the menus read Xbox-style controllers from the pad helper (renderer pads.ts)
  if (!HEADLESS || REAL_PADS)
    onXPads((f) => {
      send('xpads', f)
      sendOverlay('xpads', f)
    })
  let lastHome = 0
  onHome((pad) => {
    const now = Date.now()
    if (now - lastHome < 400) return
    lastHome = now
    couchMark('home')
    toggleOverlay(pad)
  })
  // scan after the window is up so startup stays fast (cache is shown first)
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => scanAndArt(true), 50)
    startBatteryPolling()
    // a PS3 controller needs a driver (Starstation brings it): offer it when one is plugged in
    if (!HEADLESS || process.env.STARSTATION_TEST_DS3) watchDs3()
    startUpdater(notify, () => !!runningGame())
    // Nexus Mods: nxm:// links open Starstation (only with an API key); a link it was started with
    registerNxm()
    const startNxm = nxmFromArgs(process.argv)
    if (startNxm) void openNxm(startNxm)
    // mods put into Files\mods (or mods\<console>) are added to their game by themselves
    startModInbox({
      notify,
      trash,
      ask: (q) => {
        send('mod-inbox-ask', q)
        if (win && !win.isDestroyed() && !HEADLESS) win.focus()
      },
      added: (gameId, r) => {
        send('mod-result', { gameId, result: r })
      },
      paused: () => !!runningGame()
    })
    startDownloadWatcher({
      addGames: (paths) => doAddGames(paths),
      trash,
      notify,
      ask: (items) => send('add-ask', items),
      paused: () => !getSettings().sortDownloads || !!runningGame()
    })
  })
}

/**
 * Starting failed before the menu could show: say so and end (counted as a crash, so safe mode is offered next
 * time). Before, Starstation stayed running without a window, and starting it again only handed over to it.
 */
app.whenReady().then(() =>
  start().catch((e) => {
    log.error('start failed', e)
    if (!HEADLESS)
      dialog.showErrorBox(
        'Starstation could not start',
        `${(e as Error).message}\n\nStart Starstation again. The log in ${dir('config', 'logs')} has the details.`
      )
    app.exit(1)
  })
)

/** PS3 controller plugged in without its driver: offer to install it (once per plug-in). Checked every 20 s. */
function watchDs3(): void {
  let offered = false
  const check = async () => {
    if (runningGame()) return
    const st = await checkDs3().catch(() => null)
    if (!st) return
    if (st.state !== 'needs-driver') offered = false
    else if (!offered) {
      offered = true
      log.info(`PS3 controller connected without its driver (${st.service ?? 'none'})`)
      notify({
        kind: 'controller',
        title: 'PS3 controller found',
        detail: 'It needs a driver to work, and Starstation brings it. Windows will ask for permission once.',
        action: { label: 'Install driver', command: 'install-ds3-driver' }
      })
    }
  }
  void check()
  setInterval(() => void check(), 20_000).unref()
}

function quitAll(): void {
  app.quit()
}
app.on('window-all-closed', quitAll)
let guestCleared = false
let closingGameForQuit = false
let gaveUpWaiting = false
/** Windows is shutting down: it closes the emulator itself, Starstation doesn't wait. */
let windowsEnding = false
app.on('before-quit', (e) => {
  // a game is running: it is saved and closed first, like "Save and quit" — never cut off mid-save
  if (runningGame() && !windowsEnding && !gaveUpWaiting) {
    e.preventDefault()
    if (closingGameForQuit) return
    closingGameForQuit = true
    log.info('closing Starstation: the running game is saved and closed first')
    void closeRunning(true)
    // closeRunning ends the emulator by itself if it hasn't closed within its time limit; should even that never
    // be noticed, Starstation still closes a little later (quitting must never hang)
    const deadline = Date.now() + CLOSE_TIMEOUT + 10_000
    const t = setInterval(() => {
      if (runningGame() && Date.now() < deadline) return
      clearInterval(t)
      if (runningGame()) {
        log.warn('the game did not close in time: Starstation closes anyway')
        gaveUpWaiting = true
      }
      app.quit()
    }, 200)
    return
  }
  // the guest session ends when Starstation closes: back to the first profile first (the guest's things go)
  if (guestCleared || activeProfile() !== GUEST) return
  e.preventDefault()
  guestCleared = true
  void switchProfile(listProfiles().find((p) => p.main)!.id)
    .catch((err) => log.error('could not end the guest session', err))
    .finally(() => app.quit())
})
app.on('will-quit', () => {
  stopRunning()
  stopPadHelper()
  // a normal close is not a crash
  endSession()
})
/** Windows is logging off / shutting down (a window event: `app` has none). Not a crash. */
function onWindowsEnding(): void {
  windowsEnding = true
  endSession()
}

process.on('uncaughtException', (e) => log.error('uncaught', e))
process.on('unhandledRejection', (e) => log.error('unhandled rejection', e))
