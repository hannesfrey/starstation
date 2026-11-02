import fs from 'node:fs'
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
          const st = fs.statSync(full)
          const launch = c.games?.folderMarker === 'PS3_GAME/PARAM.SFO' ? path.join(full, 'PS3_GAME', 'USRDIR', 'EBOOT.BIN') : full
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
    const st = fs.statSync(f)
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
      out.push({
        id: gameIdFor(c.id, `installed/${e.name}`),
        console: c.id,
        path: g,
        launchPath: eboot,
        kind: 'installed',
        size: -1,
        mtime: fs.statSync(g).mtimeMs
      })
    }
  }
  return out
}
