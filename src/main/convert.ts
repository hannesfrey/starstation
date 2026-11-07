import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { binDir, dir } from './paths'
import { emulatorDir, emulatorExe, getConsole, getEmulator } from './presets'
import { xboxImageKind } from './formats/xdvdfs'
import { n3dsEncrypted } from './formats/gameid'
import { logger } from './log'
import type { Notice } from '../shared/types'

/**
 * Conversion on import (SPEC-v2 A), right after a game was added:
 * - Xbox: full disc dumps → XISO (what xemu runs), with extract-xiso; the original goes to the Recycle Bin
 *   only after the new image checks out
 * - PS3: .pkg files are installed into RPCS3 (then the .pkg goes to the Recycle Bin)
 * - multi-disc games get a playlist (.m3u), so they show up once and discs can be swapped in the emulator
 * - 3DS: encrypted cartridge dumps get a clear message (Azahar only runs decrypted games)
 */

const log = logger('convert')
type Note = Omit<Notice, 'id'>
type Trash = (p: string) => Promise<void>

function run(exe: string, args: string[], cwd: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(exe, args, { cwd, windowsHide: true, stdio: 'ignore' })
    const t = setTimeout(() => p.kill(), timeoutMs)
    p.once('error', () => resolve(-1))
    p.once('exit', (code) => {
      clearTimeout(t)
      resolve(code ?? -1)
    })
  })
}

function freeBytes(p: string): number {
  try {
    const s = fs.statfsSync(p)
    return s.bavail * s.bsize
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}

/** Xbox full disc dump → XISO in the same place, same name. */
export async function toXiso(file: string, trash: Trash): Promise<Note | null> {
  if (xboxImageKind(file) !== 'full') return null
  const name = path.basename(file)
  const size = fs.statSync(file).size
  if (freeBytes(path.dirname(file)) < size + 512 * 1024 ** 2)
    return { kind: 'warning', title: `${name} was not converted`, detail: 'Not enough free disk space to make the Xbox (XISO) version. xemu may not start the full disc image.' }
  const tmp = dir('config', 'downloads', `xiso-${Date.now()}`)
  const outDir = path.join(tmp, 'out')
  await fsp.mkdir(outDir, { recursive: true })
  try {
    log.info(`converting ${file} to XISO`)
    // extract-xiso renames the file it reads to ".old" (even on failure): give it a hard link, so the
    // game itself is never touched until the new image checks out (same drive: no extra space)
    const link = path.join(tmp, 'disc.iso')
    await fsp.link(file, link)
    const code = await run(path.join(binDir(), 'extract-xiso.exe'), ['-r', '-d', outDir, link], tmp, 60 * 60_000)
    const out = path.join(outDir, 'disc.iso')
    if (code !== 0 || !fs.existsSync(out) || xboxImageKind(out) !== 'xiso') throw new Error(`extract-xiso failed (code ${code})`)
    // checked: now the original can go (Recycle Bin), and the XISO takes its place
    await trash(file)
    await fsp.rename(out, file)
    log.info(`${name}: XISO ${Math.round(size / 1024 ** 2)} MB → ${Math.round(fs.statSync(file).size / 1024 ** 2)} MB`)
    return { kind: 'success', title: 'Xbox game converted', detail: `${name} is now an XISO image (what xemu runs). The original is in the Recycle Bin.` }
  } catch (e) {
    log.warn(`XISO conversion of ${file} failed`, e)
    return { kind: 'warning', title: `${name} was not converted`, detail: 'The Xbox disc image could not be turned into an XISO. It stays as it is.' }
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true })
  }
}

/**
 * RPCS3 installs a package without a window and then exits (`--headless`; with its window it asks
 * "Install?" and stays open afterwards). Returns the dev_hdd0\game folders that changed.
 */
export async function rpcs3InstallPkg(file: string): Promise<{ code: number; changed: string[] }> {
  const ps3 = getConsole('ps3')
  const e = ps3 ? getEmulator(ps3.emulator) : undefined
  if (!e || !fs.existsSync(emulatorExe(e))) return { code: -1, changed: [] }
  const games = path.join(emulatorDir(e), 'dev_hdd0', 'game')
  const snapshot = () => {
    try {
      // an update overwrites files inside an existing folder: its PARAM.SFO tells, not the folder's date
      const sfo = (n: string) => {
        try {
          return fs.statSync(path.join(games, n, 'PARAM.SFO')).mtimeMs
        } catch {
          return 0
        }
      }
      return new Map(fs.readdirSync(games).map((n) => [n, `${fs.statSync(path.join(games, n)).mtimeMs}/${sfo(n)}`]))
    } catch {
      return new Map<string, string>()
    }
  }
  const before = snapshot()
  log.info(`installing PS3 package ${file}`)
  const code = await run(emulatorExe(e), ['--headless', '--installpkg', file], emulatorDir(e), 60 * 60_000)
  const changed = [...snapshot()].filter(([n, t]) => before.get(n) !== t).map(([n]) => n)
  log.info(`RPCS3 --installpkg ${path.basename(file)}: code ${code}, changed ${changed.join(', ') || 'nothing'}`)
  return { code, changed }
}

/** PS3 package → installed into RPCS3's virtual hard disk (shows up as an installed game). */
export async function installPkg(file: string, trash: Trash): Promise<Note> {
  const name = path.basename(file)
  const head = Buffer.alloc(4)
  const fd = fs.openSync(file, 'r')
  fs.readSync(fd, head, 0, 4, 0)
  fs.closeSync(fd)
  if (head.toString('latin1') !== '\x7fPKG') return { kind: 'warning', title: `${name} is not a PS3 package`, detail: 'It was left where it is.' }
  const ps3 = getConsole('ps3')
  const e = ps3 ? getEmulator(ps3.emulator) : undefined
  if (!e || !fs.existsSync(emulatorExe(e))) return { kind: 'error', title: `${name} was not installed`, detail: 'Install RPCS3 first (Settings → Emulators), then add the package again.' }
  const { code, changed } = await rpcs3InstallPkg(file)
  if (!changed.length) {
    log.warn(`RPCS3 --installpkg ${name}: code ${code}, nothing installed`)
    return { kind: 'error', title: `${name} was not installed`, detail: 'RPCS3 could not install the package (it may need a license file, .rap, in RPCS3’s exdata folder). The package was kept.' }
  }
  await trash(file)
  log.info(`installed ${name} → ${changed.join(', ')}`)
  return { kind: 'success', title: 'PS3 package installed', detail: `${name} is installed in RPCS3. The package is in the Recycle Bin.` }
}

const DISC = /\s*[([]\s*Disc\s*(\d+)(?:\s*of\s*\d+)?\s*[)\]]/i

/** Games with "(Disc 1)", "(Disc 2)" … in a console folder → one playlist each (only consoles that read .m3u). */
export async function makePlaylists(consoleId: string): Promise<string[]> {
  const c = getConsole(consoleId)
  if (!c?.extensions.includes('.m3u')) return []
  const folder = dir('games', consoleId)
  let names: string[] = []
  try {
    names = await fsp.readdir(folder)
  } catch {
    return []
  }
  // the file the emulator opens: a .cue brings its tracks; .bin files belong to a .cue
  const launchable = names.filter((n) => /\.(cue|chd|pbp|ccd|iso|img)$/i.test(n) && DISC.test(n))
  const groups = new Map<string, { disc: number; name: string }[]>()
  for (const n of launchable) {
    const disc = Number(DISC.exec(n)![1])
    const base = path.basename(n, path.extname(n)).replace(DISC, '').trim()
    groups.set(base, [...(groups.get(base) ?? []), { disc, name: n }])
  }
  const made: string[] = []
  for (const [base, discs] of groups) {
    if (discs.length < 2) continue
    const m3u = path.join(folder, `${base}.m3u`)
    if (fs.existsSync(m3u)) continue
    const lines = discs.sort((a, b) => a.disc - b.disc).map((d) => d.name)
    await fsp.writeFile(m3u, lines.join('\r\n') + '\r\n')
    made.push(m3u)
    log.info(`playlist ${m3u}: ${lines.join(', ')}`)
  }
  return made
}

/** Everything that happens after games were added. Returns messages for the user. */
export async function afterAdd(added: { path: string; console: string }[], trash: Trash): Promise<Note[]> {
  const notes: Note[] = []
  for (const a of added) {
    if (a.console === 'xbox' && /\.iso$/i.test(a.path)) {
      const n = await toXiso(a.path, trash)
      if (n) notes.push(n)
    }
    if (a.console === '3ds' && n3dsEncrypted(a.path))
      notes.push({
        kind: 'warning',
        title: `${path.basename(a.path)} is encrypted`,
        detail: 'Azahar only runs decrypted 3DS games. Decrypt it on your own 3DS (e.g. with GodMode9), then add it again.'
      })
  }
  for (const id of new Set(added.map((a) => a.console))) {
    const made = await makePlaylists(id)
    if (made.length) notes.push({ kind: 'info', title: made.length === 1 ? 'Discs grouped' : `${made.length} games' discs grouped`, detail: made.map((m) => path.basename(m, '.m3u')).join(', ') })
  }
  return notes
}

