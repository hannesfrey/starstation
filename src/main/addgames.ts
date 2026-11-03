import fs from 'node:fs'
import path from 'node:path'
import { dir } from './paths'
import { allConsoles } from './presets'
import { cueDataFile, discImage } from './formats/gameid'
import { withIso } from './formats/iso9660'
import { moveFile, partsOf } from './fsutil'
import { logger } from './log'
import type { AddGamesResult } from '../shared/types'

/**
 * "Add games" / drag & drop: find the console of each file and move it into games\<console>.
 * Ambiguous files (.chd, .zip, …) are returned in `ask` so the menu can let Hannes pick.
 */

const log = logger('addgames')

/** games\New downloads: Hannes downloads games here and Starstation sorts them (downloads.ts). */
export const NEW_DOWNLOADS = 'New downloads'

/** Every file extension some console's games use (lower case, with dot). */
export function gameExtensions(): Set<string> {
  return new Set(allConsoles().flatMap((c) => c.extensions.map((e) => e.toLowerCase())))
}

function readAt(file: string, pos: number, len: number): Buffer | null {
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const b = Buffer.alloc(len)
    const n = fs.readSync(fd, b, 0, len, pos)
    return n === len ? b : null
  } catch {
    return null
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}

const XBOX_MAGIC = 'MICROSOFT*XBOX*MEDIA'

/** Original Xbox or Xbox 360 from the XDVDFS file system (plain xiso, XGD1/2/3 redumps). */
function sniffXbox(file: string): string | null {
  const bases: [number, string | null][] = [
    [0, null], // rebuilt xiso: decide by the boot file
    [0x18300000, 'xbox'], // XGD1 full dump
    [0xfd90000, 'xbox360'], // XGD2
    [0x2080000, 'xbox360'] // XGD3
  ]
  for (const [base, known] of bases) {
    const vd = readAt(file, base + 0x10000, 0x20)
    if (!vd || vd.toString('latin1', 0, 20) !== XBOX_MAGIC) continue
    if (known) return known
    const rootSector = vd.readUInt32LE(0x14)
    const rootSize = Math.min(vd.readUInt32LE(0x18), 256 * 1024)
    const root = readAt(file, base + rootSector * 2048, rootSize)
    const names = root?.toString('latin1').toLowerCase() ?? ''
    if (names.includes('default.xex')) return 'xbox360'
    if (names.includes('default.xbe')) return 'xbox'
    return null
  }
  return null
}

/** Which console a disc image belongs to, from its contents. */
export function sniffDisc(file: string): string | null {
  const ext = path.extname(file).toLowerCase()
  const img = ext === '.cue' ? cueDataFile(file) : ext === '.m3u' ? discImage(file) : file
  if (!img || !fs.existsSync(img)) return null
  const head = readAt(img, 0, 0x20)
  if (head) {
    if (head.readUInt32BE(0x1c) === 0xc2339f3d) return 'gc'
    if (head.readUInt32BE(0x18) === 0x5d1c9ea3) return 'wii'
  }
  const fromIso = withIso(img, (iso) => {
    const cnf = iso.readFile('SYSTEM.CNF', 4096)?.toString('latin1')
    if (cnf) return /BOOT2\s*=/i.test(cnf) ? 'ps2' : /BOOT\s*=/i.test(cnf) ? 'ps1' : null
    if (iso.readFile('PS3_GAME/PARAM.SFO', 64 * 1024)) return 'ps3'
    if (iso.readFile('PSX.EXE', 16)) return 'ps1'
    return null
  })
  if (fromIso) return fromIso
  return sniffXbox(img)
}

/** Consoles a file or folder could belong to (one = sure). */
export function detectConsoles(p: string): string[] {
  const ids = new Set(allConsoles().map((c) => c.id))
  let st: fs.Stats
  try {
    st = fs.statSync(p)
  } catch {
    return []
  }
  if (st.isDirectory()) {
    const has = (rel: string) => fs.existsSync(path.join(p, rel))
    if (has('PS3_GAME/PARAM.SFO') || has('PARAM.SFO')) return ['ps3']
    if (has('default.xex')) return ['xbox360']
    if (has('default.xbe')) return ['xbox']
    return []
  }
  const ext = path.extname(p).toLowerCase()
  const candidates = allConsoles()
    .filter((c) => c.extensions.includes(ext))
    .map((c) => c.id)
  if (candidates.length <= 1) return candidates
  const sniffed = sniffDisc(p)
  if (sniffed && ids.has(sniffed) && candidates.includes(sniffed)) return [sniffed]
  return candidates
}

function inside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** Playlists first (they bring their discs), then cue sheets (they bring their tracks), then the rest. */
function rank(p: string): number {
  const ext = path.extname(p).toLowerCase()
  return ext === '.m3u' ? 0 : ext === '.cue' ? 1 : 2
}

export async function addGames(paths: string[], consoleId?: string): Promise<AddGamesResult> {
  const res: AddGamesResult = { added: [], ask: [], errors: [] }
  const gamesRoot = dir('games')
  for (const p of [...paths].sort((a, b) => rank(a) - rank(b))) {
    const name = path.basename(p)
    if (!fs.existsSync(p)) continue // already moved as part of a .cue / .m3u
    if (inside(p, gamesRoot) && !inside(p, path.join(gamesRoot, NEW_DOWNLOADS))) {
      res.errors.push(`${name} is already in the games folder.`)
      continue
    }
    const options = consoleId ? [consoleId] : detectConsoles(p)
    if (!options.length) {
      res.errors.push(`Starstation doesn't know which console ${name} is for.`)
      continue
    }
    if (options.length > 1) {
      res.ask.push({ path: p, options })
      continue
    }
    const c = options[0]
    const targetDir = dir('games', c)
    const to = path.join(targetDir, name)
    if (fs.existsSync(to)) {
      res.errors.push(`${name} is already in the ${c.toUpperCase()} games folder.`)
      continue
    }
    try {
      const isFile = fs.statSync(p).isFile()
      for (const part of isFile ? partsOf(p) : []) {
        const rel = path.relative(path.dirname(p), part)
        const dest = rel.startsWith('..') || path.isAbsolute(rel) ? path.join(targetDir, path.basename(part)) : path.join(targetDir, rel)
        if (!fs.existsSync(dest)) await moveFile(part, dest)
      }
      await moveFile(p, to)
      res.added.push({ path: to, console: c })
      log.info(`added ${p} → ${to}`)
    } catch (e) {
      log.error(`could not add ${p}`, e)
      res.errors.push(`${name}: ${(e as Error).message}`)
    }
  }
  return res
}
