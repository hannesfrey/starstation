import fs from 'node:fs'
import path from 'node:path'
import { dir } from './paths'
import { allConsoles } from './presets'
import type { Screenshot } from '../shared/types'

/** Every emulator saves its screenshots into media\screenshots\<console>\…; the Photo column shows them newest first. */
export function listScreenshots(limit = 400): Screenshot[] {
  const root = dir('media', 'screenshots')
  const names = new Map(allConsoles().map((c) => [c.id, c.short]))
  const out: Screenshot[] = []
  const walk = (d: string, depth: number, consoleId?: string) => {
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      const p = path.join(d, e.name)
      // folders may be links into an emulator (e.g. screenshots\3ds\azahar)
      let isDir = e.isDirectory()
      if (e.isSymbolicLink()) {
        try {
          isDir = fs.statSync(p).isDirectory()
        } catch {
          continue
        }
      }
      if (isDir && depth < 3) walk(p, depth + 1, consoleId ?? e.name)
      else if (!isDir && /\.(png|jpe?g|bmp|webp)$/i.test(e.name)) {
        const st = fs.statSync(p)
        out.push({
          path: p,
          console: consoleId ?? '',
          consoleName: names.get(consoleId ?? '') ?? '',
          // emulators put the game name first: "Midnight Club 3 - DUB Edition Remix_SLES-53717_20261102212127.png"
          title: e.name.replace(/\.[^.]+$/, '').replace(/[_ ]?\(?\d{8,14}\)?$/, '').replace(/_[A-Z]{4}-\d{5}$/, '').replace(/_/g, ' ').trim(),
          takenAt: st.mtimeMs
        })
      }
    }
  }
  walk(root, 0)
  return out.sort((a, b) => b.takenAt - a.takenAt).slice(0, limit)
}
