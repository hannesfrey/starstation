import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { dir } from '../paths'
import { fill, vars, type ConsolePreset } from '../presets'
import { referencedFiles } from '../formats/gameid'

export interface ScanEntry {
  id: string
  console: string
  path: string
  launchPath: string
  kind: 'file' | 'folder' | 'installed'
  size: number
  mtime: number
}

const SKIP_DIRS = new Set(['shortcuts', 'media', 'images', 'manuals', 'videos', '$recycle.bin', 'system volume information'])
const MAX_DEPTH = 4

/** A file or folder that vanished between listing and looking (moved, being downloaded) is just skipped. */
function statOrNull(p: string): fs.Stats | null {
  try {
    return fs.statSync(p)
  } catch {
    return null
  }
}

export function gameIdFor(consoleId: string, rel: string): string {
  return `${consoleId}:${rel.replace(/\\/g, '/').toLowerCase()}`
}

export function folderSize(p: string, limit = 200_000): number {
  let total = 0
  let seen = 0
  const stack = [p]
  while (stack.length && seen < limit) {
    const d = stack.pop()!
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of ents) {
      seen++
      const f = path.join(d, e.name)
      if (e.isDirectory()) stack.push(f)
      else if (e.isFile()) {
        try {
          total += fs.statSync(f).size
        } catch {
          /* skip */
        }
      }
    }
  }
  return total
}

/** The games folder can't be read right now (a linked folder on a USB drive that is unplugged). */
export class UnreachableError extends Error {}

/**
 * #28 the folder is there as a link but can't be opened (its drive is gone): its games must not disappear from
 * the library — the scan reports it, and the games already known stay.
 */
async function checkReachable(root: string): Promise<boolean> {
  const link = await fsp.lstat(root).catch(() => null)
  if (!link) return false // simply not there: no games
  try {
    await fsp.readdir(root)
    return true
  } catch (e) {
    throw new UnreachableError(`${root} can't be read (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`)
  }
}

/** Give the main process a moment for the menu between bits of work (a big library mustn't freeze it). */
const breathe = () => new Promise<void>((r) => setImmediate(r))

/**
 * Like scanConsole, without blocking (#28): every folder read waits for the disk without holding up the main
 * process, so the menu keeps answering while a big library or a slow USB drive is scanned.
 */
export async function scanConsoleAsync(c: ConsolePreset): Promise<ScanEntry[]> {
  const root = dir('games', c.id)
  const exts = new Set(c.extensions.map((e) => e.toLowerCase()))
  const marker = c.games?.folderMarker
  const out: ScanEntry[] = []
  const files: string[] = []
  let n = 0
  const statQ = (p: string) => fsp.stat(p).catch(() => null)

  const walk = async (d: string, depth: number): Promise<void> => {
    let ents: fs.Dirent[]
    try {
      ents = await fsp.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    if (++n % 50 === 0) await breathe()
    for (const e of ents) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name.toLowerCase()) || e.name.startsWith('.')) continue
        if (marker && (await statQ(path.join(full, marker)))) {
          const st = await statQ(full)
          if (!st) continue
          const launch = c.games?.folderLaunch ? path.join(full, ...c.games.folderLaunch.split('/')) : full
          out.push({ id: gameIdFor(c.id, path.relative(root, full)), console: c.id, path: full, launchPath: launch, kind: 'folder', size: -1, mtime: st.mtimeMs })
          continue
        }
        if (depth < MAX_DEPTH) await walk(full, depth + 1)
      } else if (e.isFile() && exts.has(path.extname(e.name).toLowerCase())) files.push(full)
    }
  }
  if (await checkReachable(root)) await walk(root, 0)

  const hidden = new Set<string>()
  for (const f of files) {
    const ext = path.extname(f).toLowerCase()
    if (ext === '.m3u' || ext === '.cue') for (const r of referencedFiles(f)) if (r !== f.toLowerCase()) hidden.add(r)
  }
  for (const f of files) {
    if (hidden.has(f.toLowerCase())) continue
    const st = await statQ(f)
    if (!st) continue
    if (++n % 200 === 0) await breathe()
    out.push({ id: gameIdFor(c.id, path.relative(root, f)), console: c.id, path: f, launchPath: f, kind: 'file', size: st.size, mtime: st.mtimeMs })
  }

  if (c.games?.installedDir) {
    const inst = fill(c.games.installedDir, vars(c))
    const ents = await fsp.readdir(inst, { withFileTypes: true }).catch(() => [] as fs.Dirent[])
    for (const e of ents) {
      if (!e.isDirectory()) continue
      const g = path.join(inst, e.name)
      const eboot = path.join(g, 'USRDIR', 'EBOOT.BIN')
      if (!(await statQ(path.join(g, 'PARAM.SFO'))) || !(await statQ(eboot))) continue
      const st = await statQ(g)
      if (!st) continue
      out.push({ id: gameIdFor(c.id, `installed/${e.name}`), console: c.id, path: g, launchPath: eboot, kind: 'installed', size: -1, mtime: st.mtimeMs })
    }
  }
  return out
}

/** Find all games of one console in Files\games\<console> (+ installed games, e.g. PS3 HDD). */
export function scanConsole(c: ConsolePreset, rootOverride?: string): ScanEntry[] {
  const root = rootOverride ?? dir('games', c.id)
  const exts = new Set(c.extensions.map((e) => e.toLowerCase()))
  const marker = c.games?.folderMarker
  const out: ScanEntry[] = []
  const files: string[] = []

  const walk = (d: string, depth: number): void => {
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name.toLowerCase()) || e.name.startsWith('.')) continue
        if (marker && fs.existsSync(path.join(full, marker))) {
          const st = statOrNull(full)
          if (!st) continue
          const launch = c.games?.folderLaunch ? path.join(full, ...c.games.folderLaunch.split('/')) : full
          out.push({
            id: gameIdFor(c.id, path.relative(root, full)),
            console: c.id,
            path: full,
            launchPath: launch,
            kind: 'folder',
            size: -1,
            mtime: st.mtimeMs
          })
          continue
        }
        if (depth < MAX_DEPTH) walk(full, depth + 1)
      } else if (e.isFile() && exts.has(path.extname(e.name).toLowerCase())) {
        files.push(full)
      }
    }
  }
  if (fs.existsSync(root)) walk(root, 0)

  // Files referenced by a .cue or .m3u are parts of another game, not games themselves.
  const hidden = new Set<string>()
  for (const f of files) {
    const ext = path.extname(f).toLowerCase()
    if (ext === '.m3u' || ext === '.cue') for (const r of referencedFiles(f)) if (r !== f.toLowerCase()) hidden.add(r)
  }
  for (const f of files) {
    if (hidden.has(f.toLowerCase())) continue
    const st = statOrNull(f)
    if (!st) continue
    out.push({
      id: gameIdFor(c.id, path.relative(root, f)),
      console: c.id,
      path: f,
      launchPath: f,
      kind: 'file',
      size: st.size,
      mtime: st.mtimeMs
    })
  }

  // Installed games (PS3 PKG installs in dev_hdd0\game)
  if (c.games?.installedDir && !rootOverride) {
    const inst = fill(c.games.installedDir, vars(c))
    let ents: fs.Dirent[] = []
    try {
      ents = fs.readdirSync(inst, { withFileTypes: true })
    } catch {
      /* none */
    }
    for (const e of ents) {
      if (!e.isDirectory()) continue
      const g = path.join(inst, e.name)
      const eboot = path.join(g, 'USRDIR', 'EBOOT.BIN')
      if (!fs.existsSync(path.join(g, 'PARAM.SFO')) || !fs.existsSync(eboot)) continue
      const st = statOrNull(g)
      if (!st) continue
      out.push({
        id: gameIdFor(c.id, `installed/${e.name}`),
        console: c.id,
        path: g,
        launchPath: eboot,
        kind: 'installed',
        size: -1,
        mtime: st.mtimeMs
      })
    }
  }
  return out
}
