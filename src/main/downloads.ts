import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { dir } from './paths'
import { NEW_DOWNLOADS, detectConsoles, gameExtensions } from './addgames'
import { unpack } from './emulators'
import { moveFile, partsOf } from './fsutil'
import { logger } from './log'
import type { AddGamesResult, Notice } from '../shared/types'

/**
 * games\New downloads: Hannes saves downloaded games here. While Starstation runs (not during a game)
 * it looks at the folder every few seconds. Once a download has finished, archives are unpacked into
 * Files\config\downloads, the games are sorted into games\<console> like drag & drop, and the archive
 * goes to the Recycle Bin — only when every game in it was added. Anything unclear stays and is reported.
 */

const log = logger('downloads')

const ARCHIVE = /\.(zip|7z|rar)$|\.7z\.001$/i
/** Later parts of a split .7z: 7-Zip reads them together with .001. */
const SPLIT_7Z_REST = /\.7z\.(?!001$)\d{3}$/i
/** Split archives 7zr / tar can't read. */
const SPLIT_OTHER = /\.(part\d+\.rar|r\d\d|z\d\d|zip\.\d{3})$/i
/** Browsers and download tools write to these until the download is complete. */
const PARTIAL = /\.(crdownload|part|partial|download|opdownload|tmp|!ut|aria2)$/i
const IGNORE = /^(desktop\.ini|thumbs\.db)$|^[.~]/i
/** Files that come with downloads and are never games: ignored without a message. */
const EXTRAS = /\.(txt|nfo|url|html?|pdf|jpe?g|png|gif|webp|sfv|md5|sha1|dat|xml|ini|log|diz|lnk)$/i

const POLL = Number(process.env.STARSTATION_DOWNLOADS_POLL) || 4000
/** A download counts as finished when it hasn't changed for this long (and between two looks). */
const SETTLE = Math.min(3000, POLL)

export interface DownloadHooks {
  /** Sort files into games\<console> (drag & drop logic, with notifications and rescan). */
  addGames(paths: string[]): Promise<AddGamesResult>
  /** Recycle Bin. */
  trash(p: string): Promise<void>
  notify(n: Omit<Notice, 'id'>): void
  /** Ask which console these files are for. */
  ask(items: AddGamesResult['ask']): void
  /** Setting off or a game running. */
  paused(): boolean
}

export function downloadsDir(): string {
  return dir('games', NEW_DOWNLOADS)
}

interface Sig {
  id: string
  mtime: number
}

/** name → signature at the previous look */
const seen = new Map<string, string>()
/** items already handled this session that are still there (asked, not a game, failed): not again until they change */
const done = new Set<string>()
let busy = false

export function signature(p: string): Sig | null {
  try {
    const st = fs.statSync(p)
    if (st.isFile()) return { id: `${st.size}:${st.mtimeMs}`, mtime: st.mtimeMs }
    if (!st.isDirectory()) return null
    let size = 0
    let count = 0
    let mtime = st.mtimeMs
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const q = path.join(d, e.name)
        const s = fs.statSync(q)
        mtime = Math.max(mtime, s.mtimeMs)
        count++
        if (e.isDirectory()) walk(q)
        else size += s.size
      }
    }
    walk(p)
    return { id: `d${count}:${size}:${mtime}`, mtime }
  } catch {
    return null
  }
}

function markDone(p: string): void {
  const s = signature(p)
  if (s) done.add(`${path.basename(p)}|${s.id}`)
}

/** Game files and game folders (PS3 / Xbox dumps) inside a folder. */
function collect(root: string): string[] {
  const exts = gameExtensions()
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (detectConsoles(p).length) out.push(p)
        else walk(p)
      } else if (exts.has(path.extname(e.name).toLowerCase()) && !ARCHIVE.test(e.name)) out.push(p)
    }
  }
  walk(root)
  return out
}

/**
 * Sort the games in `root`. Files whose console is unclear are moved into New downloads and asked
 * about. ok = at least one game and every one of them was added or asked about.
 */
async function sortTree(h: DownloadHooks, root: string): Promise<{ ok: boolean; found: number; added: number; dup: number }> {
  const candidates = collect(root)
  if (!candidates.length) return { ok: false, found: 0, added: 0, dup: 0 }
  const r = await h.addGames(candidates)
  const asked: AddGamesResult['ask'] = []
  // a game that is already there is not a failure (2026-11-05: a second Mario Kart 7 download was kept and
  // tried again at every start)
  const dup = r.errors.filter((e) => / is already in the /.test(e)).length
  let failed = r.errors.length - dup
  for (const a of r.ask) {
    const target = path.join(downloadsDir(), path.basename(a.path))
    if (path.dirname(a.path) === downloadsDir()) {
      asked.push(a)
      continue
    }
    try {
      for (const part of partsOf(a.path)) {
        const dest = path.join(downloadsDir(), path.relative(path.dirname(a.path), part))
        if (!fs.existsSync(dest)) await moveFile(part, dest)
      }
      await moveFile(a.path, target)
      markDone(target)
      asked.push({ ...a, path: target })
    } catch (e) {
      failed++
      h.notify({ kind: 'warning', title: 'Download not sorted', detail: `${path.basename(a.path)}: ${(e as Error).message}` })
    }
  }
  if (asked.length) h.ask(asked)
  return { ok: failed === 0 && r.added.length + asked.length + dup > 0, found: candidates.length, added: r.added.length + asked.length, dup }
}

async function handleArchive(h: DownloadHooks, p: string): Promise<void> {
  const name = path.basename(p)
  const size = fs.statSync(p).size
  const work = dir('config', 'downloads')
  await fsp.mkdir(work, { recursive: true })
  // disc images pack well: leave room for about 4× the archive
  const fsInfo = await fsp.statfs(work)
  if (fsInfo.bavail * fsInfo.bsize < size * 4 + 512 * 1024 * 1024) {
    h.notify({ kind: 'error', title: 'Not enough space to unpack', detail: `${name} needs about ${Math.ceil((size * 4) / 1e9)} GB free.` })
    return
  }
  h.notify({ kind: 'info', title: 'Unpacking a download', detail: name })
  const tmp = path.join(work, `unpack-${Date.now()}`)
  try {
    await unpack(p, tmp)
  } catch (e) {
    log.warn(`unpack ${name} failed`, e)
    h.notify({ kind: 'error', title: 'Could not unpack a download', detail: `${name} may be damaged or not fully downloaded. It stays in New downloads.` })
    return
  }
  try {
    const r = await sortTree(h, tmp)
    if (r.ok) {
      const parts = /\.7z\.001$/i.test(name)
        ? fs.readdirSync(path.dirname(p)).filter((n) => n.toLowerCase().startsWith(name.slice(0, -3).toLowerCase()) && /\.\d{3}$/.test(n))
        : [name]
      for (const n of parts) await h.trash(path.join(path.dirname(p), n))
      log.info(`${name}: unpacked, games sorted, archive in the Recycle Bin${r.dup ? ` (${r.dup} already in the library)` : ""}`)
      if (!r.added && r.dup) h.notify({ kind: "info", title: "Already in your library", detail: `${name} went to the Recycle Bin.` })
    } else if (!r.found) {
      h.notify({ kind: 'warning', title: 'No game found in a download', detail: `${name} stays in New downloads.` })
    } else {
      log.warn(`${name}: not every game could be added; archive kept`)
    }
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true })
  }
}

/** A folder that isn't a game dump itself (e.g. unpacked by hand): sort what's inside, then bin the leftovers. */
async function handleFolder(h: DownloadHooks, p: string): Promise<void> {
  const r = await sortTree(h, p)
  if (!r.found) {
    h.notify({ kind: 'warning', title: 'No game found in a folder', detail: `${path.basename(p)} stays in New downloads.` })
    return
  }
  if (r.ok && fs.existsSync(p) && !collect(p).length) await h.trash(p)
}

/** One look at the folder. Exported for tests; normally called by the watcher. */
export async function checkDownloads(h: DownloadHooks): Promise<void> {
  if (busy || h.paused()) return
  busy = true
  try {
    const root = downloadsDir()
    fs.mkdirSync(root, { recursive: true })
    const names = fs.readdirSync(root)
    for (const k of [...seen.keys()]) if (!names.includes(k)) seen.delete(k)
    const ready: string[] = []
    for (const n of names) {
      if (IGNORE.test(n) || PARTIAL.test(n) || SPLIT_7Z_REST.test(n)) continue
      // Firefox keeps the final name next to a .part file until it's done
      if (names.some((o) => o !== n && o.startsWith(n) && PARTIAL.test(o))) continue
      const p = path.join(root, n)
      const sig = signature(p)
      if (!sig || done.has(`${n}|${sig.id}`)) continue
      const prev = seen.get(n)
      seen.set(n, sig.id)
      if (prev !== sig.id || Date.now() - sig.mtime < SETTLE) continue
      ready.push(n)
    }

    const plain: string[] = []
    for (const n of ready) {
      const p = path.join(root, n)
      const isDir = fs.statSync(p).isDirectory()
      if (!isDir && EXTRAS.test(n)) {
        markDone(p)
        continue
      }
      if (SPLIT_OTHER.test(n)) {
        markDone(p)
        h.notify({ kind: 'warning', title: 'Split archive', detail: `${n}: Starstation unpacks .zip, .7z (also .7z.001) and .rar. Unpack this one yourself; the game is then sorted.` })
        continue
      }
      try {
        if (!isDir && ARCHIVE.test(n)) await handleArchive(h, p)
        else if (isDir && !detectConsoles(p).length) await handleFolder(h, p)
        else plain.push(p)
      } catch (e) {
        log.error(`could not handle ${n}`, e)
        h.notify({ kind: 'error', title: 'Download not sorted', detail: `${n}: ${(e as Error).message}` })
      }
      if (fs.existsSync(p)) markDone(p)
    }
    // single game files together, so a .cue brings its .bin tracks
    if (plain.length) {
      const r = await h.addGames(plain)
      if (r.ask.length) h.ask(r.ask)
      for (const p of plain) if (fs.existsSync(p)) markDone(p)
    }
  } catch (e) {
    log.error('checking New downloads failed', e)
  } finally {
    busy = false
  }
}

export function startDownloadWatcher(h: DownloadHooks): void {
  fs.mkdirSync(downloadsDir(), { recursive: true })
  // leftovers from an unpack that was cut short (Starstation closed): the archive is still in New downloads
  const work = dir('config', 'downloads')
  if (fs.existsSync(work)) for (const n of fs.readdirSync(work)) if (n.startsWith('unpack-')) fs.rmSync(path.join(work, n), { recursive: true, force: true })
  setInterval(() => void checkDownloads(h), POLL)
  setTimeout(() => void checkDownloads(h), Math.min(1500, POLL))
}
