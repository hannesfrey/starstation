import fs from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { binDir } from './paths'
import { logger } from './log'

/**
 * The pad helper (native\padhelper.cs): sees the PS / Home button while a game has focus,
 * and closes / focuses / sends keys to the emulator window. One helper for the whole session.
 * Hidden tests don't start it (STARSTATION_PADHELPER=1 forces it).
 */

const log = logger('padhelper')
let proc: ChildProcess | null = null
let homeListeners: ((pad: string) => void)[] = []
let padsListeners: ((pads: string[]) => void)[] = []
let lastPads: string[] = []
/** Waiting commands; an answer goes to the oldest one with its command name (a late answer can't land on another). */
const waiting: { cmd: string; done: (line: string) => void }[] = []

/** "ok keys" / "err keys …" → keys; "audio […]" → audio; "fg 123" → fg. */
function answerTo(line: string): string {
  const [a, b] = line.split(' ')
  return a === 'ok' || a === 'err' ? b : a
}

/** Starstation is closing: the helper is meant to stop now (no restart). */
let stopping = false
/** Restarts after the helper stopped by itself (times), so a helper that keeps crashing isn't restarted forever. */
let restarts: number[] = []

export function startPadHelper(): void {
  if (proc) return
  stopping = false
  if (process.env.STARSTATION_HEADLESS === '1' && process.env.STARSTATION_PADHELPER !== '1') return
  const exe = path.join(binDir(), 'padhelper.exe')
  if (!fs.existsSync(exe)) {
    log.warn(`missing ${exe}: the PS button menu is off`)
    return
  }
  const p = spawn(exe, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
  proc = p
  // writing to a helper that just died must not throw
  p.stdin?.on('error', () => undefined)
  p.once('exit', (code) => gone(p, `code ${code}`))
  p.once('error', (e) => {
    log.error('helper failed to start', e)
    gone(p, e.message)
  })
  createInterface({ input: p.stdout! }).on('line', (line) => {
    if (line.startsWith('home ')) {
      const pad = line.slice(5)
      log.info(`home button on ${pad}`)
      for (const l of homeListeners) l(pad)
    } else if (line.startsWith('pads ')) {
      lastPads = line.slice(5).split(',').filter(Boolean)
      for (const l of padsListeners) l(lastPads)
    } else if (line === 'ready') log.info('helper ready')
    else {
      const cmd = answerTo(line)
      const i = waiting.findIndex((w) => w.cmd === cmd)
      if (i >= 0) waiting.splice(i, 1)[0].done(line)
    }
  })
}

/**
 * The helper ended. Asked to (Starstation closing): fine. By itself (crash): it is started again — without it
 * the PS button does nothing and "Save and quit" can't close the game window — at most 5 times in 10 minutes.
 */
function gone(p: ChildProcess, why: string): void {
  if (proc !== p) return
  proc = null
  for (const w of waiting.splice(0)) w.done('err gone')
  if (stopping) {
    log.info(`helper stopped (${why})`)
    return
  }
  const now = Date.now()
  restarts = restarts.filter((t) => now - t < 10 * 60_000)
  if (restarts.length >= 5) {
    log.error(`helper stopped (${why}) and keeps stopping: the PS button menu is off until Starstation starts again`)
    return
  }
  restarts.push(now)
  log.warn(`helper stopped (${why}); starting it again`)
  setTimeout(() => {
    if (!stopping) startPadHelper()
  }, 1000).unref()
}

export function stopPadHelper(): void {
  stopping = true
  proc?.stdin?.write('quit\n')
  proc = null
}

export function onHome(fn: (pad: string) => void): () => void {
  homeListeners.push(fn)
  return () => (homeListeners = homeListeners.filter((l) => l !== fn))
}

export function onPads(fn: (pads: string[]) => void): () => void {
  padsListeners.push(fn)
  return () => (padsListeners = padsListeners.filter((l) => l !== fn))
}

/** Pads the helper sees right now ("xinput:0", "hid:1" = number of DS4/DualSense read directly). */
export function helperPads(): string[] {
  return lastPads
}

function ask(cmd: string, timeoutMs = 5000): Promise<string> {
  if (!proc?.stdin) return Promise.resolve('err no helper')
  const name = cmd.split(' ')[0]
  return new Promise((resolve) => {
    const w = {
      cmd: name,
      done: (line: string) => {
        clearTimeout(t)
        resolve(line)
      }
    }
    const t = setTimeout(() => {
      const i = waiting.indexOf(w)
      if (i >= 0) waiting.splice(i, 1)
      resolve('err timeout')
    }, timeoutMs)
    waiting.push(w)
    proc!.stdin!.write(`${cmd}\n`)
  })
}

// ---------------- system settings (SPEC-v2 G) ----------------

function jsonAnswer<T>(line: string, prefix: string, fallback: T): T {
  if (!line.startsWith(`${prefix} `)) return fallback
  try {
    return JSON.parse(line.slice(prefix.length + 1)) as T
  } catch {
    return fallback
  }
}

export async function audioOutputs(): Promise<{ id: string; name: string; default: boolean }[]> {
  return jsonAnswer(await ask('audio'), 'audio', [])
}
export async function setAudioOutput(id: string): Promise<boolean> {
  if (!/^\{[\w.-]+\}\.\{[\w-]+\}$/.test(id)) return false
  return (await ask(`audioset ${id}`)).startsWith('ok')
}
export async function displayModes(): Promise<{ w: number; h: number; hz: number; current: boolean }[]> {
  return jsonAnswer(await ask('display'), 'display', [])
}
/** test: only ask Windows whether it would work. */
export async function setDisplayMode(w: number, h: number, hz: number, test = false): Promise<boolean> {
  if (![w, h, hz].every((n) => Number.isInteger(n) && n > 0 && n < 10000)) return false
  return (await ask(`${test ? 'displaytest' : 'displayset'} ${w} ${h} ${hz}`)).startsWith('ok')
}
export async function bluetoothDevices(scan: boolean): Promise<{ address: string; name: string; connected: boolean; paired: boolean; cod: number }[]> {
  return jsonAnswer(await ask(scan ? 'bt scan' : 'bt', scan ? 20_000 : 5000), 'bt', [])
}
export async function bluetoothPair(address: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^[0-9A-F]{12}$/i.test(address)) return { ok: false, error: 'Bad address' }
  const r = await ask(`btpair ${address}`, 30_000)
  return r.startsWith('ok') ? { ok: true } : { ok: false, error: r.replace(/^err btpair /, '') }
}
export async function bluetoothRemove(address: string): Promise<boolean> {
  if (!/^[0-9A-F]{12}$/i.test(address)) return false
  return (await ask(`btremove ${address}`)).startsWith('ok')
}

/** Like clicking the emulator window's X: it saves its resume state (where set up) and closes. */
export async function closeWindow(pid: number): Promise<boolean> {
  return (await ask(`close ${pid}`)).startsWith('ok')
}

export async function focusWindow(pid: number): Promise<boolean> {
  return (await ask(`focus ${pid}`)).startsWith('ok')
}

/** Focus the emulator and press a key combo there (e.g. "SHIFT+F1"). */
export async function sendKeys(pid: number, combo: string): Promise<boolean> {
  if (!/^[A-Z0-9+]+$/i.test(combo)) return false
  return (await ask(`keys ${pid} ${combo}`)).startsWith('ok')
}

export function helperRunning(): boolean {
  return !!proc
}

/** Mute / unmute a process like the Windows volume mixer does (couch test: games stay silent). */
export async function muteProcess(pid: number, mute = true): Promise<boolean> {
  return (await ask(`mute ${pid} ${mute ? 1 : 0}`)).startsWith('ok')
}

/** Which process owns the window in front (couch test: does the game / Starstation have focus?). */
export async function foregroundPid(): Promise<number | null> {
  const line = await ask('fg')
  return line.startsWith('fg ') ? Number(line.slice(3)) : null
}

/** Give a window of Starstation itself the focus (the PS button menu over a running game). */
export async function focusHwnd(handle: Buffer): Promise<boolean> {
  const hwnd = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0))
  return (await ask(`focushwnd ${hwnd}`)).startsWith('ok')
}
