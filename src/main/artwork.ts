import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { net } from 'electron'
import { dir } from './paths'
import { readJson, writeJson } from './store'
import { getSecrets, getSettings } from './settings'
import { artKey } from './library/library'
import { logger } from './log'
import type { Game } from '../shared/types'

/**
 * Box art (icon) and in-game screenshot (background) for games without their own.
 * PS3 discs bring a banner (ICON0) and a background (PIC1): the background stays, the banner is only used
 * until a real box cover is found (Hannes, 2026-11-07: "show the game cover like PS2 and Xbox").
 * 1. Xbox 360 only: Microsoft's own Xbox image server, by the title ID read from the game file.
 * 1. PS3 only: GameTDB (no account), front cover by game code (BLUS30443) — libretro has only ~70 PS3 covers.
 * 2. libretro thumbnails (no account): GitHub mirror first, thumbnails.libretro.com second.
 * 3. ScreenScraper, only if developer + user credentials are in config\secrets.json.
 * Saved as media\artwork\<console>\<game>\icon.png / background.png.
 */

const log = logger('artwork')

const LIBRETRO_SYSTEM: Record<string, string> = {
  nes: 'Nintendo - Nintendo Entertainment System',
  snes: 'Nintendo - Super Nintendo Entertainment System',
  n64: 'Nintendo - Nintendo 64',
  gc: 'Nintendo - GameCube',
  wii: 'Nintendo - Wii',
  '3ds': 'Nintendo - Nintendo 3DS',
  ps1: 'Sony - PlayStation',
  ps2: 'Sony - PlayStation 2',
  ps3: 'Sony - PlayStation 3',
  xbox: 'Microsoft - Xbox',
  xbox360: 'Microsoft - Xbox 360'
}
const SCREENSCRAPER_SYSTEM: Record<string, number> = { nes: 3, snes: 4, n64: 14, gc: 13, wii: 16, '3ds': 17, ps1: 57, ps2: 58, ps3: 59, xbox: 32, xbox360: 33 }

/** Hidden tests point this at a local fake; otherwise the real hosts. */
function libretroBases(system: string): string[] {
  if (process.env.STARSTATION_ARTWORK_BASE) return [`${process.env.STARSTATION_ARTWORK_BASE}/${encodeURIComponent(system)}`]
  return [
    `https://raw.githubusercontent.com/libretro-thumbnails/${system.replace(/ /g, '_')}/master`,
    `https://thumbnails.libretro.com/${encodeURIComponent(system)}`
  ]
}

/** Microsoft's Xbox 360 image server (http only). Tests point it at a local fake. */
const XBOX_IMAGES = () => process.env.STARSTATION_XBOX_ART_BASE ?? 'http://download.xbox.com/content/images'

/** Xbox 360: box art / background by title ID, English first (US, then UK). */
async function fromXbox(g: Game, name: 'boxartlg.jpg' | 'background.jpg', file: string): Promise<boolean> {
  if (g.console !== 'xbox360' || !/^[0-9A-F]{8}$/.test(g.serial ?? '')) return false
  for (const locale of ['1033', '2057']) {
    if (await fetchTo(`${XBOX_IMAGES()}/66acd000-77fe-1000-9115-d802${g.serial!.toLowerCase()}/${locale}/${name}`, file)) return true
  }
  return false
}

/** GameTDB (art.gametdb.com). Tests point it at a local fake. */
const GAMETDB = () => process.env.STARSTATION_GAMETDB_BASE ?? 'https://art.gametdb.com'

/** GameTDB cover regions to try for a PS3 game code: its own region first (BLUS → US, BLES → EN …). */
function gametdbRegions(serial: string): string[] {
  const r = serial[2]
  const first = r === 'U' ? ['US'] : r === 'E' ? ['EN', 'GB', 'FR', 'DE', 'ES', 'IT', 'AU'] : r === 'J' ? ['JA'] : r === 'A' || r === 'H' ? ['ZH', 'KO', 'JA'] : r === 'K' ? ['KO'] : []
  return [...new Set([...first, 'US', 'EN', 'JA', 'other'])]
}

/** PS3: front cover by game code — the big one first (928×1080), then the smaller sizes. */
async function fromGameTdb(g: Game, file: string): Promise<boolean> {
  const serial = (g.serial ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (g.console !== 'ps3' || !/^[A-Z]{4}\d{5}$/.test(serial)) return false
  for (const region of gametdbRegions(serial)) {
    for (const size of ['coverHQ', 'coverM', 'cover']) {
      for (const ext of ['jpg', 'png']) {
        if (await fetchTo(`${GAMETDB()}/ps3/${size}/${region}/${serial}.${ext}`, file)) return true
      }
    }
  }
  return false
}

/** A PS3 game still showing its disc banner (ICON0) instead of a box cover. */
export function wantsCover(g: Game): boolean {
  return g.console === 'ps3' && !!g.icon && /ICON0\.PNG$/i.test(g.icon)
}

export function artDir(g: Game): string {
  return dir('media', 'artwork', g.console, artKey(g))
}

/** libretro file names: these characters are replaced by "_". */
function libretroName(name: string): string {
  return name.replace(/[&*/:`<>?\\|"]/g, '_')
}

function candidateNames(g: Game): string[] {
  const base = g.kind === 'file' ? path.basename(g.path, path.extname(g.path)) : path.basename(g.path)
  const regions = ['USA', 'Europe', 'USA, Europe', 'World', 'Japan', 'Europe, Australia']
  return [...new Set([base, ...regions.map((r) => `${g.title} (${r})`), g.title])].map(libretroName)
}

async function fetchTo(url: string, file: string): Promise<boolean> {
  try {
    const r = await net.fetch(url, { headers: { 'User-Agent': 'Starstation' } })
    if (!r.ok) return false
    const buf = Buffer.from(await r.arrayBuffer())
    // must really be an image (PNG/JPEG), not an error page
    const png = buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const jpg = buf[0] === 0xff && buf[1] === 0xd8
    if (!png && !jpg) return false
    await fsp.mkdir(path.dirname(file), { recursive: true })
    await fsp.writeFile(file, buf)
    return true
  } catch {
    return false
  }
}

async function fromLibretro(g: Game, kind: 'Named_Boxarts' | 'Named_Snaps', file: string): Promise<boolean> {
  const system = LIBRETRO_SYSTEM[g.console]
  if (!system) return false
  for (const base of libretroBases(system)) {
    for (const name of candidateNames(g)) {
      if (await fetchTo(`${base}/${kind}/${encodeURIComponent(name)}.png`, file)) return true
    }
  }
  return false
}

interface SsMedia {
  type: string
  url: string
  region?: string
}

/**
 * ScreenScraper login: the user's own (secrets.json), and the developer ID either from secrets.json or the one
 * built into the installer (resources\screenscraper.json, made from Hannes's secrets at build time).
 */
export function screenScraperLogin(): { devid: string; devpassword: string; username: string; password: string } | null {
  const s = getSecrets().screenscraper ?? {}
  let dev = { devid: s.devid ?? '', devpassword: s.devpassword ?? '' }
  if (!dev.devid || !dev.devpassword) {
    const built = readJson<{ devid?: string; devpassword?: string }>(path.join(process.resourcesPath ?? '', 'screenscraper.json'), {})
    if (built.devid && built.devpassword) dev = { devid: built.devid, devpassword: built.devpassword }
  }
  if (!dev.devid || !dev.devpassword) return null
  return { ...dev, username: s.username ?? '', password: s.password ?? '' }
}

const ssBase = () => process.env.STARSTATION_SCREENSCRAPER_BASE ?? 'https://api.screenscraper.fr/api2'
const ssCache = new Map<string, Promise<SsMedia[]>>()

/** All media ScreenScraper has for a game (one request per game and session). */
function ssMedias(g: Game): Promise<SsMedia[]> {
  const hit = ssCache.get(g.id)
  if (hit) return hit
  const p = ssLookup(g)
  ssCache.set(g.id, p)
  return p
}

async function ssLookup(g: Game): Promise<SsMedia[]> {
  const s = screenScraperLogin()
  const system = SCREENSCRAPER_SYSTEM[g.console]
  if (!s || !system) return []
  const q = new URLSearchParams({
    devid: s.devid,
    devpassword: s.devpassword,
    softname: 'Starstation',
    output: 'json',
    ssid: s.username ?? '',
    sspassword: s.password ?? '',
    systemeid: String(system),
    romtype: 'rom',
    romnom: path.basename(g.path),
    romtaille: String(Math.max(0, g.size))
  })
  if (g.serial) q.set('serialnum', g.serial)
  try {
    const r = await net.fetch(`${ssBase()}/jeuInfos.php?${q}`, { headers: { 'User-Agent': 'Starstation' } })
    if (!r.ok) return []
    return ((await r.json()) as { response?: { jeu?: { medias?: SsMedia[] } } }).response?.jeu?.medias ?? []
  } catch (e) {
    log.warn(`screenscraper failed for ${g.id}`, e)
    return []
  }
}

function pickMedia(medias: SsMedia[], ...types: string[]): SsMedia | undefined {
  for (const type of types) {
    const m = medias.find((x) => x.type === type && ['wor', 'us', 'eu', 'ss'].includes(x.region ?? 'wor')) ?? medias.find((x) => x.type === type)
    if (m) return m
  }
  return undefined
}

async function fromScreenScraper(g: Game, want: { icon: boolean; background: boolean }, d: string): Promise<{ icon: boolean; background: boolean }> {
  const got = { icon: false, background: false }
  try {
    const medias = await ssMedias(g)
    const pick = (type: string) => pickMedia(medias, type)
    const box = pick('box-2D')
    const ss = pick('ss')
    if (want.icon && box) got.icon = await fetchTo(box.url, path.join(d, 'icon.png'))
    if (want.background && ss) got.background = await fetchTo(ss.url, path.join(d, 'background.png'))
  } catch (e) {
    log.warn(`screenscraper failed for ${g.id}`, e)
  }
  return got
}

interface Tried {
  at: number
}

/** Download a file and check what it is (a PDF manual, an MP4 clip): error pages are not kept. */
async function fetchFile(url: string, file: string, looksRight: (b: Buffer) => boolean): Promise<boolean> {
  try {
    const r = await net.fetch(url, { headers: { 'User-Agent': 'Starstation' } })
    if (!r.ok) return false
    const buf = Buffer.from(await r.arrayBuffer())
    if (!looksRight(buf)) return false
    await fsp.mkdir(path.dirname(file), { recursive: true })
    await fsp.writeFile(file, buf)
    return true
  } catch {
    return false
  }
}

/**
 * Manual (scanned booklet, PDF) and gameplay clip (MP4) from ScreenScraper (SPEC-v2 C + D), next to the
 * artwork: manual.pdf / video.mp4. Only with a ScreenScraper login; nothing found → asked again after a week.
 */
export async function fetchExtras(g: Game): Promise<boolean> {
  if (!screenScraperLogin()) return false
  const d = artDir(g)
  const manual = path.join(d, 'manual.pdf')
  const video = path.join(d, 'video.mp4')
  const tried = path.join(d, 'extras-tried.json')
  if (fs.existsSync(manual) && fs.existsSync(video)) return false
  const t = readJson<Tried | null>(tried, null)
  if (t && Date.now() - t.at < 7 * 24 * 3600_000) return false
  const medias = await ssMedias(g)
  let got = false
  const m = !fs.existsSync(manual) && pickMedia(medias, 'manuel')
  if (m) got = (await fetchFile(m.url, manual, (b) => b.subarray(0, 5).toString('latin1') === '%PDF-')) || got
  const v = !fs.existsSync(video) && pickMedia(medias, 'video-normalized', 'video')
  if (v) got = (await fetchFile(v.url, video, (b) => b.subarray(4, 8).toString('latin1') === 'ftyp')) || got
  if (!fs.existsSync(manual) || !fs.existsSync(video)) writeJson(tried, { at: Date.now() } satisfies Tried)
  if (got) log.info(`${g.id}: manual / video from ScreenScraper`)
  return got
}

/**
 * Download missing artwork. Returns true if something new was saved.
 * force: look again right now (Refresh artwork). retry: ignore the one-week wait (app start).
 */
export async function fetchArtwork(g: Game, force = false, retry = false): Promise<boolean> {
  const d = artDir(g)
  const icon = path.join(d, 'icon.png')
  const bg = path.join(d, 'background.png')
  const triedFile = path.join(d, 'tried.json')
  const wantIcon = !g.icon || g.icon === icon || wantsCover(g)
  const wantBg = !g.background || g.background === bg
  if (!wantIcon && !wantBg) return false
  if (!force) {
    const tried = readJson<Tried | null>(triedFile, null)
    // nothing found last time: try again after a week
    if (!retry && tried && Date.now() - tried.at < 7 * 24 * 3600_000) return false
    if ((!wantIcon || fs.existsSync(icon)) && (!wantBg || fs.existsSync(bg))) return false
  }
  let gotIcon = false
  let gotBg = false
  if (wantIcon) gotIcon = (await fromXbox(g, 'boxartlg.jpg', icon)) || (await fromGameTdb(g, icon)) || (await fromLibretro(g, 'Named_Boxarts', icon))
  if (wantBg) gotBg = (await fromXbox(g, 'background.jpg', bg)) || (await fromLibretro(g, 'Named_Snaps', bg))
  if ((wantIcon && !gotIcon) || (wantBg && !gotBg)) {
    const ss = await fromScreenScraper(g, { icon: wantIcon && !gotIcon, background: wantBg && !gotBg }, d)
    gotIcon ||= ss.icon
    gotBg ||= ss.background
  }
  if ((wantIcon && !gotIcon && !fs.existsSync(icon)) || (wantBg && !gotBg && !fs.existsSync(bg))) writeJson(triedFile, { at: Date.now() } satisfies Tried)
  else await fsp.rm(triedFile, { force: true })
  if (gotIcon || gotBg) log.info(`${g.id}: artwork ${gotIcon ? 'icon ' : ''}${gotBg ? 'background' : ''}`)
  return gotIcon || gotBg
}

let queue: { g: Game; retry: boolean }[] = []
let busy = false

/**
 * Fetch artwork for games that have none, a few at a time, in the background.
 * retry (app start): also look again for games where nothing was found before.
 */
export function queueArtwork(games: Game[], onChange: () => void, retry = false): void {
  if (process.env.STARSTATION_HEADLESS === '1' && !process.env.STARSTATION_ARTWORK_BASE) return // hidden tests stay offline
  if (!getSettings().artworkAuto) return // "download artwork later" in the setup wizard
  const known = new Set(queue.map((q) => q.g.id))
  // missing pictures — or, with a ScreenScraper login, a missing manual / clip
  const ss = !!screenScraperLogin()
  queue.push(...games.filter((g) => !known.has(g.id) && (!g.icon || wantsCover(g) || !g.background || (ss && (!g.manual || !g.video)))).map((g) => ({ g, retry })))
  if (busy) return
  busy = true
  void (async () => {
    let changed = false
    let last = Date.now()
    while (queue.length) {
      const batch = queue.splice(0, 3)
      const res = await Promise.all(
        batch.map(async (q) => {
          const art = await fetchArtwork(q.g, false, q.retry).catch(() => false)
          const extras = await fetchExtras(q.g).catch(() => false)
          return art || extras
        })
      )
      if (res.some(Boolean)) changed = true
      if (changed && Date.now() - last > 1500) {
        onChange()
        changed = false
        last = Date.now()
      }
    }
    if (changed) onChange()
    busy = false
  })()
}
