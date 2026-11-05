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
import { backupGame, gameFiles, listBackups, noteResumeVersion, ownSaves, previousResume, pruneBackups, restoreBackup, restorePreviousResume, resumeInfo, saveEntries } from './gamedata'
import { createCollection, deleteCollection, listCollections, removeGameFromCollections, renameCollection, toggleInCollection } from './collections'
import { addGames } from './addgames'
import { afterAdd, installPkg } from './convert'
import { availableOptions, gameOptions, setGameOption } from './gameoptions'
import { padVars, reportPads } from './controllers'
import { checkNow, startUpdater, updateState } from './updater'
import { addMod, deleteMod, finishAdd, gamebananaGame, listMods, modSupport, setGamebananaGame, setModEnabled } from './mods'
import { gbModDetails, installGbMod, listGbMods, searchGames } from './gamebanana'
import { fetchArtwork, queueArtwork } from './artwork'
import { listScreenshots } from './screenshots'
import { readBattery } from './battery'
import { reattachArtwork, setCustomArt } from './library/library'
import { healthCheck } from './health'
import { exportReport } from './diagnostics'
import { lastUnlockCheck, raLogin, raLogout, raStatus, recentUnlocks } from './retroach'
import { listRooms, netplayArgs, netplayVars } from './netplay'
import { addToSteam, steamStatus } from './steam'
import { customConsoleForm, removeCustomConsole, saveCustomConsole } from './customconsole'
import { allEmulators } from './presets'
import { cancelTransfer, packageSize, receiveByCode, receiveFromFolder, sendByCode, buildPackage } from './packages'
import { enablePending } from './mods'
import { readJson } from './store'
import { consoleInfos } from './consoles'
import { launch, setLauncherWindow, runningGame, stopRunning, onBeforeLaunch, onAfterExit } from './launcher'
import { hideOverlay, overlayAction, overlayOpen, overlayState, setupOverlay, toggleOverlay } from './overlay'
import { onHome, startPadHelper, stopPadHelper } from './padhelper'
import { loadGpuDrivers, markGuideSeen, newHomeConflicts } from './system'
import type { OverlayAction } from '../shared/types'
import { attachWindow, notify, send } from './notify'
import { startDownloadWatcher } from './downloads'
import type { AddGamesResult, AppState, CustomConsoleForm, EmulatorInfo, GameDetails, NetplayRoom, PackageChoice, PackageProgress, PlayerPad, Settings, StartNotes } from '../shared/types'

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
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  w.webContents.on('render-process-gone', (_e, d) => {
    log.error('renderer gone', d)
    // the menu crashed: that counts as a Starstation crash (safe mode is offered next time)
    if (d.reason !== 'clean-exit') app.exit(1)
  })
  loadPage(w)
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
        await shell.openPath(f)
      }
      return
    }
    case 'show-file': {
      // only files inside Files (e.g. the diagnostics report)
      const p = arg ? path.resolve(arg) : ''
      if (p && fs.existsSync(p)) shell.showItemInFolder(p)
      return
    }
    case 'open-path': {
      // only folders inside Files\ (e.g. one save backup)
      const p = arg ? path.resolve(arg) : ''
      if (p && p.toLowerCase().startsWith(path.resolve(filesDir()).toLowerCase() + path.sep) && fs.existsSync(p)) await shell.openPath(p)
      return
    }
    case 'rescan':
      scanAndArt()
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
    case 'open-secrets': {
      const f = dir('config', 'secrets.json')
      if (!fs.existsSync(f)) writeJson(f, { screenscraper: { username: '', password: '', devid: '', devpassword: '' }, retroachievements: { username: '', password: '', webApiKey: '' } })
      await shell.openPath(f)
      return
    }
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
  ipcMain.handle('launch', (_e, id: string, mode?: 'fresh' | 'resume', np?: { host: true } | { join: NetplayRoom }, pads?: PlayerPad[]) => {
    const g = getGame(id)
    const online = np && g && getConsole(g.console)?.netplay ? np : undefined
    // controller assignment: player N → that pad, in every emulator's own way (controllers.ts)
    const order = Array.isArray(pads) ? pads.filter((p) => (p.api === 'xinput' || p.api === 'sdl') && Number.isInteger(p.index)).slice(0, 4) : []
    const vars = { ...(order.length ? padVars(order) : {}), ...(online ? netplayVars('host' in online) : {}) }
    return launch(id, mode === 'resume' ? 'resume' : 'fresh', [], { args: online ? netplayArgs(online) : [], vars })
  })
  ipcMain.handle('health', () => healthCheck())
  ipcMain.handle('export-report', async () => {
    const name = `starstation-report-${new Date().toISOString().slice(0, 10)}.zip`
    let to = dir('config', 'diagnostics', name)
    if (!HEADLESS) {
      const pick = await dialog.showSaveDialog(win!, { title: 'Save diagnostics report', defaultPath: to, filters: [{ name: 'Zip', extensions: ['zip'] }] })
      if (pick.canceled || !pick.filePath) return null
      to = pick.filePath
    }
    await exportReport(to)
    notify({ kind: 'success', title: 'Report saved', detail: to, action: { label: 'Show file', command: 'show-file', arg: to } })
    return to
  })
  ipcMain.handle('ra-status', () => raStatus())
  ipcMain.handle('ra-login', async () => {
    const r = await raLogin()
    notify(r.ok ? { kind: 'achievement', title: 'Logged in to RetroAchievements', detail: raStatus().username } : { kind: 'error', title: 'RetroAchievements login failed', detail: r.error })
    return r
  })
  ipcMain.handle('ra-logout', () => raLogout())
  ipcMain.handle('netplay-rooms', (_e, id: string) => {
    const g = getGame(id)
    return g ? listRooms(g) : []
  })
  ipcMain.handle('steam-status', () => steamStatus())
  ipcMain.handle('steam-add', () => {
    const r = addToSteam()
    notify(r.ok ? { kind: 'success', title: 'Added to Steam', detail: 'Start Steam: Starstation is in your library (Non-Steam).' } : { kind: 'error', title: 'Not added to Steam', detail: r.error })
    return r
  })
  ipcMain.handle('custom-console', (_e, id: string) => customConsoleForm(id))
  ipcMain.handle('custom-console-save', (_e, form: CustomConsoleForm) => {
    const r = saveCustomConsole(form)
    if (r.ok) {
      send('library', rescan())
      send('consoles', consoleInfos())
    }
    return r
  })
  ipcMain.handle('custom-console-remove', (_e, id: string) => {
    removeCustomConsole(id)
    send('library', rescan())
    send('consoles', consoleInfos())
  })
  ipcMain.handle('pick-exe', async () => {
    const pick = await dialog.showOpenDialog(win!, { title: 'Choose the emulator program', properties: ['openFile'], filters: [{ name: 'Programs', extensions: ['exe'] }] })
    return pick.canceled ? null : (pick.filePaths[0] ?? null)
  })
  ipcMain.handle('library-clear-cache', () => {
    fs.rmSync(dir('config', 'library', 'library.json'), { force: true })
    loadLibrary()
    scanAndArt()
  })
  // ---- packages ----
  const pkgProgress = (p: PackageProgress) => send('package-progress', p)
  const afterReceive = async (r: { ok: boolean; added?: number; kept?: number; error?: string }) => {
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
  ipcMain.handle('package-size', (_e, c: PackageChoice) => packageSize(c))
  ipcMain.handle('package-send', async (_e, c: PackageChoice) => {
    const r = await sendByCode(c, () => undefined, pkgProgress).catch((e) => ({ ok: false, error: (e as Error).message }))
    if (!r.ok) pkgProgress({ phase: 'error', pct: 0, detail: r.error })
    else notify({ kind: 'success', title: 'Package sent' })
    return r
  })
  ipcMain.handle('package-save-folder', async (_e, c: PackageChoice) => {
    let base = dir('backups', 'packages')
    if (!HEADLESS) {
      const pick = await dialog.showOpenDialog(win!, { title: 'Choose where to save the package (e.g. a USB drive)', properties: ['openDirectory', 'createDirectory'] })
      if (pick.canceled || !pick.filePaths[0]) return null
      base = pick.filePaths[0]
    }
    const folder = path.join(base, `Starstation package ${new Date().toISOString().slice(0, 10)}`)
    try {
      await buildPackage(c, folder, false, pkgProgress)
      pkgProgress({ phase: 'done', pct: 1, detail: folder })
      notify({ kind: 'success', title: 'Package saved', detail: folder, action: { label: 'Open folder', command: 'open-path', arg: folder } })
      return { ok: true, folder }
    } catch (e) {
      pkgProgress({ phase: 'error', pct: 0, detail: (e as Error).message })
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('package-receive', async (_e, code: string, useSettings: boolean) =>
    afterReceive(await receiveByCode(String(code), { useSettings: !!useSettings }, pkgProgress).catch((e) => ({ ok: false, error: (e as Error).message })))
  )
  ipcMain.handle('package-receive-folder', async (_e, useSettings: boolean, folder?: string) => {
    let f = folder
    if (!f || !HEADLESS) {
      if (HEADLESS) return null
      const pick = await dialog.showOpenDialog(win!, { title: 'Choose the package folder', properties: ['openDirectory'] })
      if (pick.canceled || !pick.filePaths[0]) return null
      f = pick.filePaths[0]
    }
    return afterReceive(await receiveFromFolder(f, { useSettings: !!useSettings }, pkgProgress).catch((e) => ({ ok: false, error: (e as Error).message, added: 0, kept: 0 })))
  })
  ipcMain.handle('package-cancel', () => cancelTransfer())
  // ---- first start ----
  ipcMain.handle('setup-status', () => {
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
  ipcMain.handle('setup-done', () => writeJson(dir('config', 'setup.json'), { done: true, at: new Date().toISOString() }))
  ipcMain.handle('update-state', () => updateState())
  ipcMain.handle('update-check', () => checkNow(notify))
  // ---- safe updates + safe mode (SPEC-v2 B, G) ----
  ipcMain.handle('start-notes', () => takeStartNotes())
  ipcMain.handle('guide-seen', (_e, keys: string[]) => markGuideSeen(Array.isArray(keys) ? keys.map(String) : []))
  // ---- PS button menu (SPEC-v2 A) ----
  ipcMain.handle('overlay-state', () => overlayState())
  ipcMain.handle('overlay-action', (_e, a: OverlayAction) => overlayAction(a))
  ipcMain.handle('test-home', () => {
    if (HEADLESS) toggleOverlay()
  })
  ipcMain.handle('undo-update', (_e, to: string) => undoUpdate(String(to)))
  ipcMain.handle('release-everyone', async () => {
    const r = await releaseToEveryone()
    notify(
      r.ok
        ? { kind: 'success', title: r.already ? 'Already released to everyone' : 'Released to everyone', detail: `Version ${app.getVersion()} — the other PCs update on their next start.` }
        : { kind: 'error', title: 'Not released', detail: r.error }
    )
    return r
  })
  ipcMain.handle('emulator-mark-tested', async (_e, id: string) => {
    const r = await markTested(String(id))
    notify(r.ok ? { kind: 'success', title: 'Marked as tested', detail: 'The other PCs are offered this version now.' } : { kind: 'error', title: 'Not marked as tested', detail: r.error })
    return r
  })
  ipcMain.handle('safe-mode', async (_e, on: boolean) => {
    if (runningGame()) return { ok: false, error: 'Close the game first.' }
    if (on) enterSafeMode()
    else await leaveSafeMode()
    // start the menu again so everything is read the safe (or normal) way
    win?.webContents.reload()
    return { ok: true }
  })
  ipcMain.handle('licenses', () =>
    allEmulators()
      .filter((e) => !path.isAbsolute(e.folder))
      .map((e) => {
        const d = emulatorDir(e)
        const f = ['LICENSE.txt', 'LICENSE', 'COPYING', 'COPYING.txt', 'LICENSE.md'].map((n) => path.join(d, n)).find((p) => fs.existsSync(p))
        return { id: e.id, name: e.name, license: e.license ?? 'see the emulator', file: f }
      })
  )
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
  ipcMain.handle('screenshots', () => listScreenshots())
  ipcMain.handle('refresh-artwork', async (_e, id: string) => {
    const g = getGame(id)
    if (!g) return false
    const got = await fetchArtwork(g, true)
    if (reattachArtwork() || got) send('library', view())
    if (!got) notify({ kind: 'info', title: 'No new artwork found', detail: g.title })
    return got
  })
  ipcMain.handle('custom-art', async (_e, id: string, kind: string, file?: string) => {
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
      const pick = await dialog.showOpenDialog(win!, {
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

/**
 * After every scan: fetch missing artwork in the background and show it as it arrives.
 * atStart: look again for every game that still has none, even if nothing was found last time.
 */
function scanAndArt(atStart = false): void {
  const lib = rescan()
  send('library', lib)
  send('consoles', consoleInfos())
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
    const b = await backupGame(g, 'launch')
    if (b) await pruneBackups(g)
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
    // the game is gone: so is its menu
    if (overlayOpen()) void hideOverlay(false)
  })
  onAfterExit(() => {
    // new screenshots from the session show up in the Photo column
    send('screenshots', listScreenshots())
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
      homeConflicts: HEADLESS && !process.env.STARSTATION_TEST_CONFLICTS ? [] : newHomeConflicts()
    }
    return startNotes
  }
  return { safeMode: inSafeMode(), crashed: false }
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(async () => {
  ensureDataDirs()
  log.info(`Starstation ${app.getVersion()} starting; Files=${filesDir()}${inSafeMode() ? ' (safe mode)' : ''}`)
  // crashed twice right after an update? then go back to the version before, before anything else
  session = startSession(app.getVersion())
  if (session.crashedLastTime) log.warn(`last run ended unexpectedly (${session.crashesInARow} in a row)`)
  if (await maybeRescue(session).catch((e) => (log.error('rescue failed', e), false))) return
  loadPresets()
  loadLibrary()
  // mods that safe mode set aside come back at every normal start (also after a crash in safe mode)
  if (!inSafeMode()) void restoreSuspended().catch((e) => log.warn('could not switch mods on again', e))
  registerIpc()
  registerHooks()
  registerMediaProtocol()
  win = createWindow()
  attachWindow(win)
  setLauncherWindow(win)
  // the PS button menu window comes after the menu has loaded (keeps start-up fast)
  win.webContents.once('did-finish-load', () => setupOverlay(path.join(__dirname, '../preload/index.js'), (w) => loadPage(w, 'overlay')))
  startPadHelper()
  loadGpuDrivers()
  onHome(() => toggleOverlay())
  // scan after the window is up so startup stays fast (cache is shown first)
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => scanAndArt(true), 50)
    startBatteryPolling()
    startUpdater(notify)
    startDownloadWatcher({
      addGames: (paths) => doAddGames(paths),
      trash,
      notify,
      ask: (items) => send('add-ask', items),
      paused: () => !getSettings().sortDownloads || !!runningGame()
    })
  })
})

app.on('window-all-closed', () => {
  stopRunning()
  stopPadHelper()
  app.quit()
})
// a normal close or Windows shutting down is not a crash
app.on('will-quit', () => endSession())
app.on('session-end' as 'will-quit', () => endSession())

process.on('uncaughtException', (e) => log.error('uncaught', e))
process.on('unhandledRejection', (e) => log.error('unhandled rejection', e))
