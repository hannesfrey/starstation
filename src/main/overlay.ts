import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, desktopCapturer, screen } from 'electron'
import { dir } from './paths'
import { getConsole, getEmulator } from './presets'
import { getGame } from './library/library'
import { closeRunning, runningClosing, runningGame, runningPid, setMenuOpenCheck } from './launcher'
import { focusHwnd, focusWindow, sendKeys } from './padhelper'
import { notify } from './notify'
import { couchMark } from './couchcheck'
import { logger } from './log'
import type { OverlayAction, OverlayState } from '../shared/types'

/**
 * PS button menu (SPEC-v2 A): a small XMB-style menu on top of the running game.
 * Its own always-on-top, see-through window (same page as the menu, #overlay). Emulators run borderless
 * fullscreen, so a window can appear over them; most pause while the menu has focus.
 */

const log = logger('overlay')
const HEADLESS = process.env.STARSTATION_HEADLESS === '1'
let win: BrowserWindow | null = null
let open = false
let loader: ((w: BrowserWindow) => void) | null = null
let preloadPath = ''

export function setupOverlay(preload: string, load: (w: BrowserWindow) => void): void {
  preloadPath = preload
  setMenuOpenCheck(() => open)
  loader = load
  ensure()
}

function ensure(): BrowserWindow {
  if (win && !win.isDestroyed()) return win
  const b = screen.getPrimaryDisplay().bounds
  win = new BrowserWindow({
    ...b,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    hasShadow: false,
    webPreferences: { preload: preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  if (HEADLESS) win.webContents.setAudioMuted(true)
  win.on('closed', () => (win = null))
  // its page crashed: throw the window away, the next PS button press builds a new one
  const w = win
  w.webContents.on('render-process-gone', (_e, d) => {
    if (d.reason === 'clean-exit') return
    log.error('PS button menu page gone', d)
    if (win === w) {
      win = null
      open = false
    }
    if (!w.isDestroyed()) w.destroy()
  })
  loader?.(win)
  return win
}

export function overlayState(): OverlayState {
  const r = runningGame()
  const g = r ? getGame(r.gameId) : undefined
  const c = g ? getConsole(g.console) : undefined
  const e = c ? getEmulator(c.emulator) : undefined
  return {
    open,
    title: r?.title ?? '',
    console: c?.short ?? '',
    canSaveState: !!e?.overlay?.saveState,
    canLoadState: !!e?.overlay?.loadState,
    quickResume: !!c?.quickResume,
    closing: runningClosing()
  }
}

function push(): void {
  if (win && !win.isDestroyed()) win.webContents.send('overlay', overlayState())
}

export function overlayOpen(): boolean {
  return open
}

/** PS button: open the menu over the game, or close it again (= Resume). */
export function toggleOverlay(): void {
  if (runningClosing()) return // "Closing…" stays until the game is gone
  if (open) void hideOverlay(true)
  else showOverlay()
}

export function showOverlay(): void {
  if (!runningGame()) return
  const w = ensure()
  // the display the game is on is usually the primary one
  w.setBounds(screen.getPrimaryDisplay().bounds)
  open = true
  couchMark('menu')
  push()
  if (!HEADLESS) {
    w.show()
    w.setAlwaysOnTop(true, 'screen-saver')
    w.focus()
    // Windows doesn't let a background app take the focus from the game: the pad helper hands it over,
    // so the controller drives the menu (and the emulator pauses / stops reading the pad)
    // a moment after showing, so Windows has the window ready to take the focus
    setTimeout(() => void focusHwnd(w.getNativeWindowHandle()), 80)
  }
  log.info('opened')
}

/** Close the menu; resume = give the game its focus back. */
export async function hideOverlay(resume: boolean): Promise<void> {
  open = false
  push()
  const pid = runningPid()
  // the game gets the focus first, then the menu goes: hiding it first would let Windows hand the focus to
  // Starstation's own main window instead
  if (resume && pid && !HEADLESS) await focusWindow(pid)
  if (win && !win.isDestroyed() && !HEADLESS) win.hide()
  if (resume && pid && !HEADLESS) {
    await focusWindow(pid)
    await closeEmulatorMenu(pid)
  }
}

/** Emulators that open their own menu on the PS / Guide button too (xemu can't be told not to): close it. */
async function closeEmulatorMenu(pid: number): Promise<void> {
  const r = runningGame()
  const g = r ? getGame(r.gameId) : undefined
  const keys = g ? getEmulator(getConsole(g.console)?.emulator ?? '')?.overlay?.resumeKeys : undefined
  if (keys) await sendKeys(pid, keys)
}

/** Picture of the whole screen with the menu hidden, saved where the Photo column finds it. */
async function screenshot(): Promise<string | null> {
  const r = runningGame()
  const g = r ? getGame(r.gameId) : undefined
  if (!g) return null
  await new Promise((res) => setTimeout(res, 350)) // let the menu disappear first
  const d = screen.getPrimaryDisplay()
  const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })
  const src = sources.find((s) => s.display_id === String(d.id)) ?? sources[0]
  if (!src || src.thumbnail.isEmpty()) return null
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const file = dir('media', 'screenshots', g.console, `${g.title.replace(/[\\/:*?"<>|]/g, '')}_${stamp}.png`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, src.thumbnail.toPNG())
  return file
}

export async function overlayAction(action: OverlayAction): Promise<{ ok: boolean; error?: string }> {
  const r = runningGame()
  const pid = runningPid()
  if (!r || !pid) return { ok: false, error: 'No game is running.' }
  const g = getGame(r.gameId)
  const e = g ? getEmulator(getConsole(g.console)?.emulator ?? '') : undefined
  log.info(`action ${action}`)
  switch (action) {
    case 'resume':
      couchMark('resume')
      await hideOverlay(true)
      return { ok: true }
    case 'save-state':
    case 'load-state': {
      const combo = action === 'save-state' ? e?.overlay?.saveState : e?.overlay?.loadState
      if (!combo) return { ok: false, error: 'This emulator has no save states.' }
      await hideOverlay(false)
      const ok = HEADLESS || (await sendKeys(pid, combo))
      if (ok) notify({ kind: 'save', title: action === 'save-state' ? 'State saved' : 'State loaded', detail: r.title })
      return ok ? { ok: true } : { ok: false, error: 'The emulator window could not be reached.' }
    }
    case 'screenshot': {
      await hideOverlay(false)
      if (!HEADLESS) await closeEmulatorMenu(pid) // (xemu's own menu would be in the picture)
      const file = HEADLESS ? null : await screenshot().catch((err) => (log.warn('screenshot failed', err), null))
      if (!HEADLESS) await focusWindow(pid)
      if (file) notify({ kind: 'info', title: 'Screenshot saved', detail: r.title })
      return { ok: HEADLESS || !!file }
    }
    case 'save-quit':
    case 'quit':
      if (action === 'save-quit') couchMark('savequit')
      // the menu stays up showing "Closing…" until the emulator is gone (a stuck or slow emulator would
      // otherwise sit there frozen, inviting a second "Save and quit"); index.ts hides it on exit
      await closeRunning(action === 'save-quit')
      push()
      return { ok: true }
  }
  return { ok: false, error: 'Unknown action' }
}
