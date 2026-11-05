import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { nativeImage } from 'electron'
import { dir } from './paths'
import { readJson, writeJson } from './store'
import { inSafeMode } from './safeflag'
import { logger } from './log'
import type { Wallpapers } from '../shared/types'

/**
 * Console feel (SPEC-v2 C): wallpapers (the user's own picture, or one per console) and the power menu
 * (Sleep / Turn off PC). Themes and TV mode are settings; the menu draws them.
 */

const log = logger('feel')
const file = () => dir('config', 'wallpapers.json')

/** The wallpapers that exist (none in safe mode: themes are off there). */
export function wallpapers(): Wallpapers {
  if (inSafeMode()) return { consoles: {} }
  const w = readJson<Wallpapers>(file(), { consoles: {} })
  const ok = (p?: string) => (p && fs.existsSync(p) ? p : undefined)
  return { own: ok(w.own), consoles: Object.fromEntries(Object.entries(w.consoles ?? {}).filter(([, p]) => ok(p))) }
}

/** Save a picture as the own background ("own") or a console's wallpaper ("console:<id>"); null removes it. */
export function setWallpaper(kind: string, src: string | null): { ok: boolean; error?: string } {
  const w = readJson<Wallpapers>(file(), { consoles: {} })
  const old = kind === 'own' ? w.own : w.consoles?.[kind.slice(8)]
  if (old && old.startsWith(dir('media', 'wallpapers'))) fs.rmSync(old, { force: true })
  let to: string | undefined
  if (src) {
    let img = nativeImage.createFromPath(src)
    if (img.isEmpty()) return { ok: false, error: 'Starstation can only use PNG or JPG pictures.' }
    if (img.getSize().width > 2560) img = img.resize({ width: 2560, quality: 'best' })
    to = dir('media', 'wallpapers', `${kind.replace(/[^\w-]/g, '_')}-${Date.now()}.png`)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.writeFileSync(to, img.toPNG())
  }
  if (kind === 'own') w.own = to
  else if (kind.startsWith('console:')) {
    w.consoles = { ...(w.consoles ?? {}) }
    if (to) w.consoles[kind.slice(8)] = to
    else delete w.consoles[kind.slice(8)]
  } else return { ok: false, error: 'Unknown wallpaper' }
  writeJson(file(), w)
  return { ok: true }
}

/** Sleep or turn off the PC (from the XMB). Hidden tests only note it. */
export function power(action: 'sleep' | 'shutdown'): void {
  log.info(`power: ${action}`)
  if (process.env.STARSTATION_HEADLESS === '1') {
    writeJson(dir('config', 'test-power.json'), { action, at: Date.now() })
    return
  }
  const sys = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
  if (action === 'shutdown') execFile(path.join(sys, 'shutdown.exe'), ['/s', '/t', '0'], { windowsHide: true })
  // sleep (not hibernate): the Forms call asks for "Suspend" directly
  else
    execFile(
      path.join(sys, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-Command', "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)"],
      { windowsHide: true }
    )
}
