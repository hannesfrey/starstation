import fs from 'node:fs'
import path from 'node:path'
import { dir } from '../paths'
import { readJson, writeJson } from '../store'
import { allConsoles, fill, vars, type ConsolePreset } from '../presets'
import { cleanTitle, discSerial, nintendoDiscId, ps3FromFolder, ps3FromIso } from '../formats/gameid'
import { parseSfo } from '../formats/sfo'
import { loadSerialDb, stripDisc } from './titledb'
import { folderSize, scanConsole, type ScanEntry } from './scan'
import { logger } from '../log'
import type { Game, GameStats, LibraryView } from '../../shared/types'

const log = logger('library')
const CACHE_VERSION = 1

interface CacheFile {
  version: number
  games: (Game & { mtime: number })[]
}

let games: (Game & { mtime: number })[] = []
let stats: Record<string, GameStats> = {}
const cacheFile = () => dir('config', 'library', 'library.json')
const statsFile = () => dir('config', 'library', 'stats.json')

export function loadLibrary(): void {
  const c = readJson<CacheFile>(cacheFile(), { version: 0, games: [] })
  games = c.version === CACHE_VERSION ? c.games : []
  stats = readJson<Record<string, GameStats>>(statsFile(), {})
}

export function view(): LibraryView {
  return { games: games.map(({ mtime: _m, ...g }) => g), stats }
}

export function getGame(id: string): Game | undefined {
  return games.find((g) => g.id === id)
}

export function gameCount(consoleId: string): number {
  return games.filter((g) => g.console === consoleId).length
}

/** Rescan all consoles. Unchanged games keep their cached identity; new ones are identified. */
export function rescan(): LibraryView {
  const t0 = Date.now()
  const prev = new Map(games.map((g) => [g.id, g]))
  const next: (Game & { mtime: number })[] = []
  let added = 0
  for (const c of allConsoles()) {
    let entries: ScanEntry[]
    try {
      entries = scanConsole(c)
    } catch (e) {
      log.error(`scan failed for ${c.id}`, e)
      continue
    }
    for (const e of entries) {
      const old = prev.get(e.id)
      if (old && old.mtime === e.mtime && (e.size < 0 || old.size === e.size)) {
        next.push(old)
        continue
      }
      try {
        const g = identify(c, e, old?.addedAt)
        if (g) {
          next.push(g)
          if (!old) added++
        }
      } catch (err) {
        log.warn(`could not identify ${e.path}`, err)
        next.push(basicGame(c, e, old?.addedAt))
      }
    }
  }
  games = dedupeInstalled(next)
  writeJson(cacheFile(), { version: CACHE_VERSION, games } satisfies CacheFile)
  log.info(`scan: ${games.length} games (${added} new) in ${Date.now() - t0} ms`)
  return view()
}

/** A disc game in games\ps3 and its installed update in dev_hdd0 share a serial: keep the disc. */
function dedupeInstalled(list: (Game & { mtime: number })[]): (Game & { mtime: number })[] {
  const discSerials = new Set(list.filter((g) => g.kind !== 'installed' && g.serial).map((g) => `${g.console}:${g.serial}`))
  return list.filter((g) => g.kind !== 'installed' || !discSerials.has(`${g.console}:${g.serial}`))
}

function basicGame(c: ConsolePreset, e: ScanEntry, addedAt?: number): Game & { mtime: number } {
  const base = e.kind === 'file' ? path.basename(e.path, path.extname(e.path)) : path.basename(e.path)
  return {
    id: e.id,
    console: c.id,
    path: e.path,
    launchPath: e.launchPath,
    kind: e.kind,
    title: cleanTitle(base),
    size: e.size >= 0 ? e.size : folderSize(e.path),
    addedAt: addedAt ?? Date.now(),
    mtime: e.mtime
  }
}

function identify(c: ConsolePreset, e: ScanEntry, addedAt?: number): (Game & { mtime: number }) | null {
  const g = basicGame(c, e, addedAt)
  const method = c.gameId?.method ?? 'filename'
  const db = c.gameId?.titleDb ? loadSerialDb(fill(c.gameId.titleDb.file, vars(c))) : null

  if (method === 'ps1-serial' || method === 'ps2-serial') {
    const serial = discSerial(e.path)
    if (serial) {
      g.serial = serial
      const hit = db?.get(serial)
      if (hit?.name) {
        g.title = stripDisc(hit.name)
        g.year = hit.year
        g.genre = hit.genre
        g.players = hit.players
      }
    }
    if (path.extname(e.path).toLowerCase() === '.m3u') {
      g.discs = fs.readFileSync(e.path, 'latin1').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')).length
    }
  } else if (method === 'ps3-sfo') {
    if (e.kind === 'folder') {
      const info = ps3FromFolder(e.path)
      if (info?.title) g.title = info.title
      if (info?.serial) g.serial = info.serial
      const icon = path.join(e.path, 'PS3_GAME', 'ICON0.PNG')
      const bg = path.join(e.path, 'PS3_GAME', 'PIC1.PNG')
      if (fs.existsSync(icon)) g.icon = icon
      if (fs.existsSync(bg)) g.background = bg
    } else if (e.kind === 'installed') {
      const sfo = parseSfo(fs.readFileSync(path.join(e.path, 'PARAM.SFO')))
      if (sfo.CATEGORY === 'GD') return null // patch/update data, not a game
      g.title = String(sfo.TITLE ?? g.title).replace(/\s+/g, ' ').trim()
      g.serial = String(sfo.TITLE_ID ?? path.basename(e.path))
      for (const [k, f] of [
        ['icon', 'ICON0.PNG'],
        ['background', 'PIC1.PNG']
      ] as const) {
        const p = path.join(e.path, f)
        if (fs.existsSync(p)) g[k] = p
      }
    } else {
      const info = ps3FromIso(e.path)
      if (info) {
        if (info.title) g.title = info.title
        if (info.serial) g.serial = info.serial
        const art = dir('media', 'artwork', c.id, (info.serial || path.basename(e.path)).replace(/[^\w.-]/g, '_'))
        fs.mkdirSync(art, { recursive: true })
        if (info.icon) {
          g.icon = path.join(art, 'ICON0.PNG')
          fs.writeFileSync(g.icon, info.icon)
        }
        if (info.background) {
          g.background = path.join(art, 'PIC1.PNG')
          fs.writeFileSync(g.background, info.background)
        }
      }
    }
  } else if (method === 'gc-header') {
    const h = nintendoDiscId(e.path)
    if (h) {
      g.serial = h.id
      // File names are usually better titles; use the disc header only when the name is just an ID.
      if (h.title && /^[A-Z0-9]{4,6}$/i.test(g.title)) g.title = h.title
    }
  }
  attachLocalArtwork(g)
  return g
}

/** Artwork downloaded earlier (media\artwork\<console>\<id>\icon.png / background.png). */
function attachLocalArtwork(g: Game): void {
  const key = artKey(g)
  for (const [k, f] of [
    ['icon', 'icon.png'],
    ['background', 'background.png']
  ] as const) {
    if (g[k]) continue
    const p = dir('media', 'artwork', g.console, key, f)
    if (fs.existsSync(p)) g[k] = p
  }
}

export function artKey(g: Game): string {
  return (g.serial || g.title).replace(/[^\w.-]+/g, '_')
}

// ---------- stats ----------

export function getStats(id: string): GameStats {
  return stats[id] ?? { playTime: 0, playCount: 0 }
}

export function updateStats(id: string, fn: (s: GameStats) => GameStats): GameStats {
  stats = { ...stats, [id]: fn(getStats(id)) }
  writeJson(statsFile(), stats)
  return stats[id]
}

export function toggleFavorite(id: string): GameStats {
  return updateStats(id, (s) => ({ ...s, favorite: !s.favorite }))
}
