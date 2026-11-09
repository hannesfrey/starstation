import fs from 'node:fs'
import path from 'node:path'
import { dir } from '../paths'
import { readJson, writeJson } from '../store'
import { allConsoles, fill, vars, type ConsolePreset } from '../presets'
import { cleanTitle, discSerial, n3dsTitleId, n64Header, nintendoDiscId, ps3FromFolder, ps3FromIso } from '../formats/gameid'
import { parseSfo } from '../formats/sfo'
import { x360TitleId } from '../formats/xdvdfs'
import { compatFor } from '../compat'
import { profileFile } from '../profiles'
import { loadSerialDb, stripDisc } from './titledb'
import { folderSize, scanConsoleAsync, UnreachableError, type ScanEntry } from './scan'
import { logger } from '../log'
import type { Game, GameStats, LibraryView } from '../../shared/types'

const log = logger('library')
const CACHE_VERSION = 4 // 2: 3DS title IDs, N64 ROM names; 3: titles without .xiso; 4: Xbox 360 title IDs

interface CacheFile {
  version: number
  games: (Game & { mtime: number })[]
}

let games: (Game & { mtime: number })[] = []
let stats: Record<string, GameStats> = {}
const cacheFile = () => dir('config', 'library', 'library.json')
// play time, favorites and recently played belong to the active profile
const statsFile = () => profileFile(dir('config', 'library', 'stats.json'), 'stats.json')

export function loadLibrary(): void {
  const c = readJson<CacheFile>(cacheFile(), { version: 0, games: [] })
  // only a cache of this version with a real game list (anything else is rebuilt by the next scan)
  games = c && c.version === CACHE_VERSION && Array.isArray(c.games) ? c.games.filter((g) => g && typeof g.id === 'string' && typeof g.console === 'string' && typeof g.path === 'string') : []
  const raw = readJson<Record<string, Partial<GameStats>> | null>(statsFile(), {})
  stats = Object.fromEntries(Object.entries(raw && typeof raw === 'object' ? raw : {}).map(([id, s]) => [id, cleanStats(s)]))
}

export function view(): LibraryView {
  return {
    games: games.map(({ mtime: _m, ...g }) => {
      const compat = compatFor(g)
      const withCompat = compat ? { ...g, compat } : g
      // your own cover / background wins over found artwork, without replacing it
      const own = customArt(g)
      if (!own.icon && !own.background) return withCompat
      return { ...withCompat, icon: own.icon ?? g.icon, background: own.background ?? g.background, customArt: true }
    }),
    stats
  }
}

export function getGame(id: string): Game | undefined {
  return games.find((g) => g.id === id)
}

export function gameCount(consoleId: string): number {
  return games.filter((g) => g.console === consoleId).length
}

let scanQueue: Promise<unknown> = Promise.resolve()

/**
 * Rescan all consoles. Unchanged games keep their cached identity; new ones are identified. #28: the folders are
 * read without blocking (the menu keeps answering), one scan at a time, and a console whose folder can't be
 * reached keeps its games.
 */
export function rescan(): Promise<LibraryView> {
  const job = scanQueue.then(scanNow)
  scanQueue = job.catch(() => undefined)
  return job
}

async function scanNow(): Promise<LibraryView> {
  const t0 = Date.now()
  const before = games
  const prev = new Map(before.map((g) => [g.id, g]))
  const next: (Game & { mtime: number })[] = []
  let added = 0
  let identified = 0
  for (const c of allConsoles()) {
    let entries: ScanEntry[]
    try {
      entries = await scanConsoleAsync(c)
    } catch (e) {
      // keep what was known: a failed look (a drive that is gone) must not make the console's games disappear
      if (e instanceof UnreachableError) log.warn(`scan: ${e.message}; its games are kept`)
      else log.error(`scan failed for ${c.id}`, e)
      next.push(...before.filter((g) => g.console === c.id))
      continue
    }
    for (const e of entries) {
      if (++identified % 25 === 0) await new Promise<void>((r) => setImmediate(r))
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
  saveCache()
  log.info(`scan: ${games.length} games (${added} new) in ${Date.now() - t0} ms`)
  return view()
}

/** A disc game in games\ps3 and its installed update in dev_hdd0 share a serial: keep the disc. */
/** The cache only makes the next start faster: if it can't be written (full disk), the menu still gets the games. */
function saveCache(): void {
  try {
    writeJson(cacheFile(), { version: CACHE_VERSION, games } satisfies CacheFile)
  } catch (e) {
    log.warn('library cache not saved', e)
  }
}

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
  } else if (method === '3ds-header') {
    const id = n3dsTitleId(e.path)
    if (id) g.serial = id
  } else if (method === 'n64-header') {
    const h = n64Header(e.path)
    if (h) {
      g.romName = h.name
      if (h.code.trim()) g.serial = h.code
    }
  } else if (method === 'x360-xex') {
    const id = x360TitleId(e.path)
    if (id) g.serial = id
  }
  attachLocalArtwork(g)
  return g
}

/** After artwork was downloaded: pick up new images for games that had none. Returns true if anything changed. */
export function reattachArtwork(): boolean {
  let changed = false
  for (const g of games) {
    const before = `${g.icon}|${g.background}|${g.manual}|${g.video}`
    attachLocalArtwork(g)
    if (`${g.icon}|${g.background}|${g.manual}|${g.video}` !== before) changed = true
  }
  if (changed) saveCache()
  return changed
}

/** Artwork downloaded earlier (media\artwork\<console>\<id>\icon.png / background.png). */
function attachLocalArtwork(g: Game): void {
  const key = artKey(g)
  for (const [k, f] of [
    ['icon', 'icon.png'],
    ['background', 'background.png'],
    ['manual', 'manual.pdf'],
    ['video', 'video.mp4']
  ] as const) {
    const p = dir('media', 'artwork', g.console, key, f)
    // a PS3 box cover replaces the disc's own banner (ICON0); everything else only fills gaps
    const banner = k === 'icon' && g.console === 'ps3' && !!g.icon && /ICON0\.PNG$/i.test(g.icon)
    if (g[k] && !banner) continue
    if (fs.existsSync(p)) g[k] = p
  }
}

export function artKey(g: Game): string {
  return (g.serial || g.title).replace(/[^\w.-]+/g, '_')
}

// ---------- your own artwork ----------
// media\artwork\<console>\<game>\custom-icon-<time>.png: the time in the name makes the menu show a new pick right away

type OwnArt = { icon?: string; background?: string }
const ownArt = new Map<string, OwnArt>()

function customArt(g: Game): OwnArt {
  const d = dir('media', 'artwork', g.console, artKey(g))
  let own = ownArt.get(d)
  if (!own) {
    own = {}
    try {
      for (const n of fs.readdirSync(d)) {
        const m = /^custom-(icon|background)-\d+\.png$/.exec(n)
        if (m) own[m[1] as keyof OwnArt] = path.join(d, n)
      }
    } catch {
      // no artwork folder yet
    }
    ownArt.set(d, own)
  }
  return own
}

/** Save your own cover or background (PNG), or remove it again with null. */
export function setCustomArt(g: Game, kind: 'icon' | 'background', png: Buffer | null): void {
  const d = dir('media', 'artwork', g.console, artKey(g))
  fs.mkdirSync(d, { recursive: true })
  for (const n of fs.readdirSync(d)) if (n.startsWith(`custom-${kind}-`)) fs.rmSync(path.join(d, n), { force: true })
  if (png) fs.writeFileSync(path.join(d, `custom-${kind}-${Date.now()}.png`), png)
  ownArt.delete(d)
}

// ---------- stats ----------

/** A hand-edited or old file may miss or garble a number: count on from 0 instead of staying NaN forever. */
function cleanStats(s: Partial<GameStats> | null | undefined): GameStats {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
  return { ...(s ?? {}), playTime: n(s?.playTime), playCount: n(s?.playCount), lastPlayed: n(s?.lastPlayed) || undefined }
}

export function getStats(id: string): GameStats {
  return cleanStats(stats[id])
}

export function updateStats(id: string, fn: (s: GameStats) => GameStats): GameStats {
  stats = { ...stats, [id]: fn(getStats(id)) }
  writeJson(statsFile(), stats)
  return stats[id]
}

/** A deleted game: drop its play time / favorite. */
export function forgetGame(id: string): void {
  const { [id]: _gone, ...rest } = stats
  stats = rest
  writeJson(statsFile(), stats)
}

export function toggleFavorite(id: string): GameStats {
  return updateStats(id, (s) => ({ ...s, favorite: !s.favorite }))
}

/** The game's file changed (compressed / decompressed): its play time and favorite move to the new id. */
export function moveStats(oldId: string, newId: string): void {
  if (oldId === newId || !stats[oldId]) return
  const { [oldId]: s, ...rest } = stats
  stats = { ...rest, [newId]: { ...s, ...(rest[newId] ?? {}) } }
  writeJson(statsFile(), stats)
}
