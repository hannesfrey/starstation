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
/** Answers come back in order: one waiting promise per command. */
const waiting: ((line: string) => void)[] = []

export function startPadHelper(): void {
  if (proc) return
  if (process.env.STARSTATION_HEADLESS === '1' && process.env.STARSTATION_PADHELPER !== '1') return
  const exe = path.join(binDir(), 'padhelper.exe')
  if (!fs.existsSync(exe)) {
    log.warn(`missing ${exe}: the PS button menu is off`)
    return
  }
  proc = spawn(exe, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
  proc.once('exit', (code) => {
    log.warn(`helper stopped (code ${code})`)
    proc = null
    for (const w of waiting.splice(0)) w('err gone')
  })
  proc.once('error', (e) => log.error('helper failed to start', e))
  createInterface({ input: proc.stdout! }).on('line', (line) => {
    if (line.startsWith('home ')) {
      const pad = line.slice(5)
      log.info(`home button on ${pad}`)
      for (const l of homeListeners) l(pad)
    } else if (line.startsWith('pads ')) {
      lastPads = line.slice(5).split(',').filter(Boolean)
      for (const l of padsListeners) l(lastPads)
    } else if (line === 'ready') log.info('helper ready')
    else waiting.shift()?.(line)
  })
}

export function stopPadHelper(): void {
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

function ask(cmd: string): Promise<string> {
  if (!proc?.stdin) return Promise.resolve('err no helper')
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve('err timeout'), 5000)
    waiting.push((line) => {
      clearTimeout(t)
      resolve(line)
    })
    proc!.stdin!.write(`${cmd}\n`)
  })
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
