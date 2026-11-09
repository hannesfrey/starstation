import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { dir } from './paths'
import { emulatorDir, getConsole, getEmulator, vars, type ConsolePreset } from './presets'
import { readJson, writeJson } from './store'
import { artKey, getGame, getStats } from './library/library'
import { partsOf, renameRetry, verifyTree } from './fsutil'
import { activeProfile, profileRoot } from './profiles'
import { knownPlayers } from './controllers'
import { logger } from './log'
import type { BackupInfo, Game, ResumeInfo } from '../shared/types'

/**
 * Per-game data: save backups (before every launch, last 5 kept), quick resume states and
 * the files that belong to a game when it is deleted.
 */

const log = logger('gamedata')
export const KEEP_BACKUPS = 5
/** Bigger save folders (e.g. a whole virtual SD card with installed games) are not copied. */
const MAX_BACKUP_BYTES = 1024 * 1024 * 1024

export function gameVars(g: Game, extra: Record<string, string> = {}): Record<string, string> {
  const c = getConsole(g.console)!
  const basename = g.kind === 'file' ? path.basename(g.path, path.extname(g.path)) : path.basename(g.path)
  return vars(c, {
    launch: g.launchPath,
    game: g.path,
    gamedir: path.dirname(g.path),
    basename,
    serial: g.serial ?? '',
    titleid: g.serial ?? '',
    romname: g.romName ?? '',
    ...extra
  })
}

/**
 * Fill placeholders, but refuse (null) if any placeholder is unknown or empty — an empty {serial}
 * must never turn "savedata/{serial}*" into "savedata/*".
 */
export function fillStrict(template: string, v: Record<string, string>): string | null {
  let ok = true
  const out = template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)(:\/)?\}/g, (_m, key: string, fwd?: string) => {
    const val = v[key]
    if (!val) {
      ok = false
      return ''
    }
    // game names may contain glob characters: only '*' written in the preset is a wildcard
    const plain = ['basename', 'serial', 'titleid', 'romname'].includes(key) ? val.replace(/\*/g, '_') : val
    return fwd ? plain.replace(/\\/g, '/') : plain
  })
  return ok ? path.normalize(out) : null
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Expand a path whose last part may contain '*'. */
export function expandGlob(p: string): string[] {
  const base = path.basename(p)
  if (!base.includes('*')) return fs.existsSync(p) ? [p] : []
  const d = path.dirname(p)
  const re = new RegExp('^' + base.split('*').map(escapeRe).join('.*') + '$', 'i')
  try {
    return fs
      .readdirSync(d)
      .filter((n) => re.test(n))
      .map((n) => path.join(d, n))
  } catch {
    return []
  }
}

export interface SaveEntry {
  path: string
  shared: boolean
}

/** The save files/folders of a game that exist right now. */
export function saveEntries(g: Game): SaveEntry[] {
  const c = getConsole(g.console)
  if (!c?.backup) return []
  const v = gameVars(g)
  const out: SaveEntry[] = []
  for (const b of c.backup) {
    const p = fillStrict(b.path, v)
    if (!p) continue
    for (const hit of expandGlob(p)) {
      // never treat the game itself (RetroArch: saves next to nothing, but be safe) as a save
      if (hit.toLowerCase() === g.path.toLowerCase()) continue
      out.push({ path: hit, shared: !!b.shared })
    }
  }
  return out
}

// ---------------- backups ----------------

interface Manifest {
  createdAt: number
  title: string
  reason: BackupInfo['reason']
  fingerprint: string
  bytes: number
  items: { source: string; stored: string; dir: boolean }[]
}

/**
 * Backups and kept resume points belong to the profile that is playing (#02): the first profile keeps the old
 * place (Files\backups), the others keep theirs in their profile folder — a sibling's restore can never put
 * another sibling's saves back.
 */
function backupRoot(g: Game): string {
  const root = profileRoot(activeProfile())
  return root ? path.join(root, 'backups', g.console, artKey(g)) : dir('backups', g.console, artKey(g))
}

function walkFiles(p: string, out: { rel: string; size: number; mtime: number }[], rel = '', depth = 0): void {
  // links are followed (save folders can be junctions): one pointing back up its own tree must not go on for ever
  if (depth > 24) return
  let st: fs.Stats
  try {
    st = fs.statSync(p) // follows links (saves folders can be junctions)
  } catch {
    return
  }
  if (st.isFile()) {
    out.push({ rel, size: st.size, mtime: Math.round(st.mtimeMs) })
    return
  }
  if (!st.isDirectory()) return
  for (const n of fs.readdirSync(p)) walkFiles(path.join(p, n), out, rel ? `${rel}/${n}` : n, depth + 1)
}

function fingerprint(entries: SaveEntry[]): { hash: string; bytes: number; files: number } {
  const h = crypto.createHash('sha1')
  let bytes = 0
  let files = 0
  for (const e of entries) {
    const list: { rel: string; size: number; mtime: number }[] = []
    walkFiles(e.path, list)
    h.update(e.path.toLowerCase())
    for (const f of list.sort((a, b) => a.rel.localeCompare(b.rel))) {
      h.update(`${f.rel}|${f.size}|${f.mtime}\n`)
      bytes += f.size
      files++
    }
  }
  return { hash: h.digest('hex'), bytes, files }
}

export function listBackups(g: Game): BackupInfo[] {
  const root = backupRoot(g)
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root)
    .filter((id) => id !== PREVIOUS_RESUME)
    .map((id) => {
      const m = readJson<Manifest | null>(path.join(root, id, 'manifest.json'), null)
      return m ? { id, createdAt: m.createdAt, reason: m.reason, bytes: m.bytes, folder: path.join(root, id) } : null
    })
    .filter((b): b is BackupInfo => !!b)
    .sort((a, b) => b.createdAt - a.createdAt)
}

function latestFingerprint(g: Game): string | null {
  const b = listBackups(g)[0]
  return b ? (readJson<Manifest | null>(path.join(b.folder, 'manifest.json'), null)?.fingerprint ?? null) : null
}

/** What a backup really did (#23): only "made", "unchanged" and "no-saves" mean nothing is at risk. */
export type BackupOutcome =
  | { status: 'made'; backup: BackupInfo }
  | { status: 'unchanged' | 'no-saves' }
  | { status: 'too-big'; bytes: number }
  | { status: 'failed'; error: string }

export const backupIsSafe = (o: BackupOutcome): boolean => o.status === 'made' || o.status === 'unchanged' || o.status === 'no-saves'

/** Like backupGame, but says what happened instead of returning null or throwing. */
export async function backupOutcome(g: Game, reason: BackupInfo['reason']): Promise<BackupOutcome> {
  try {
    const entries = saveEntries(g)
    const fp = entries.length ? fingerprint(entries) : null
    if (!fp?.files) return { status: 'no-saves' }
    if (fp.bytes > MAX_BACKUP_BYTES) return { status: 'too-big', bytes: fp.bytes }
    const b = await backupGame(g, reason)
    return b ? { status: 'made', backup: b } : { status: 'unchanged' }
  } catch (e) {
    log.error(`${g.id}: backup (${reason}) failed`, e)
    return { status: 'failed', error: (e as Error).message }
  }
}

/** Copy the game's saves into backups\<console>\<game>\<time>. Skips if nothing changed since the last backup. */
export async function backupGame(g: Game, reason: BackupInfo['reason']): Promise<BackupInfo | null> {
  const entries = saveEntries(g)
  if (!entries.length) return null
  const fp = fingerprint(entries)
  if (!fp.files) return null
  if (fp.bytes > MAX_BACKUP_BYTES) {
    log.warn(`${g.id}: saves are ${Math.round(fp.bytes / 1e6)} MB, too big to back up before every launch`)
    return null
  }
  if (fp.hash === latestFingerprint(g)) return null
  const root = backupRoot(g)
  const stamp = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  // local time, e.g. 2026-11-02_21-05-30
  let id = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}_${pad(stamp.getHours())}-${pad(stamp.getMinutes())}-${pad(stamp.getSeconds())}`
  while (fs.existsSync(path.join(root, id))) id += '_'
  const folder = path.join(root, id)
  const tmp = `${folder}.partial`
  await fsp.mkdir(tmp, { recursive: true })
  const items: Manifest['items'] = []
  try {
    for (const [i, e] of entries.entries()) {
      const stored = `${i}-${path.basename(e.path)}`
      const isDir = fs.statSync(e.path).isDirectory()
      await fsp.cp(e.path, path.join(tmp, stored), { recursive: true, dereference: true, preserveTimestamps: true })
      items.push({ source: e.path, stored, dir: isDir })
    }
    writeJson(path.join(tmp, 'manifest.json'), {
      createdAt: stamp.getTime(),
      title: g.title,
      reason,
      fingerprint: fp.hash,
      bytes: fp.bytes,
      items
    } satisfies Manifest)
    await renameRetry(tmp, folder)
  } catch (err) {
    await fsp.rm(tmp, { recursive: true, force: true })
    throw err
  }
  log.info(`${g.id}: backup ${id} (${reason}, ${fp.files} files)`)
  return { id, createdAt: stamp.getTime(), reason, bytes: fp.bytes, folder }
}

/** Keep the newest `keep` backups of a game. */
export async function pruneBackups(g: Game, keep = KEEP_BACKUPS): Promise<void> {
  for (const b of listBackups(g).slice(keep)) await fsp.rm(b.folder, { recursive: true, force: true })
}

/**
 * Restore a backup. The current saves are backed up first, so a restore can always be undone; if that backup
 * can't be made, nothing is changed (#23). Every item is first copied next to its place and checked, and only
 * then swapped in (#05): a broken or unreadable backup leaves the current saves exactly as they were.
 */
export async function restoreBackup(g: Game, id: string): Promise<void> {
  const b = listBackups(g).find((x) => x.id === id)
  if (!b) throw new Error('That backup no longer exists.')
  const m = readJson<Manifest | null>(path.join(b.folder, 'manifest.json'), null)
  if (!m || !Array.isArray(m.items)) throw new Error('The backup is damaged (manifest missing).')
  for (const it of m.items)
    if (!fs.existsSync(path.join(b.folder, it.stored))) throw new Error(`The backup is incomplete (${it.stored} is missing). Nothing was changed.`)
  const before = await backupOutcome(g, 'before-restore')
  if (before.status === 'too-big') throw new Error(`The current saves are too big to back up first (${Math.round(before.bytes / 1e6)} MB), so nothing was changed.`)
  if (before.status === 'failed') throw new Error(`The current saves could not be backed up first (${before.error}), so nothing was changed.`)

  // 1) stage: a checked copy of every item right next to its place
  const staged: { dir: boolean; live: string; stage: string }[] = []
  try {
    for (const it of m.items) {
      const from = path.join(b.folder, it.stored)
      let live = it.source
      if (it.dir) {
        await fsp.mkdir(it.source, { recursive: true })
        live = fs.realpathSync(it.source) // keep the folder itself (it may be a link into the emulator)
      } else await fsp.mkdir(path.dirname(it.source), { recursive: true })
      const stage = `${live}.ss-restore`
      staged.push({ dir: it.dir, live, stage })
      await fsp.rm(stage, { recursive: true, force: true })
      await fsp.cp(from, stage, { recursive: true, preserveTimestamps: true })
      const bad = await verifyTree(from, stage, true)
      if (bad.length) throw new Error(`The backup could not be read back correctly (${path.basename(bad[0])}). Nothing was changed.`)
    }
  } catch (e) {
    for (const s of staged) await fsp.rm(s.stage, { recursive: true, force: true }).catch(() => undefined)
    throw e
  }
  // 2) swap: the current contents step aside, the checked ones move in; the old ones go only at the very end
  for (const { dir: isDir, live, stage } of staged) {
    const old = `${live}.ss-old`
    await fsp.rm(old, { recursive: true, force: true })
    if (isDir) {
      await fsp.mkdir(old, { recursive: true })
      for (const n of await fsp.readdir(live)) await renameRetry(path.join(live, n), path.join(old, n))
      for (const n of await fsp.readdir(stage)) await renameRetry(path.join(stage, n), path.join(live, n))
      await fsp.rm(stage, { recursive: true, force: true })
    } else {
      if (fs.existsSync(live)) await renameRetry(live, old)
      await renameRetry(stage, live)
    }
    await fsp.rm(old, { recursive: true, force: true })
  }
  log.info(`${g.id}: restored backup ${id}`)
}

// ---------------- quick resume ----------------

/** "Start fresh" overwrites the resume state when the game closes, so the previous one is kept here first. */
const PREVIOUS_RESUME = 'previous-resume'

export async function keepPreviousResume(g: Game): Promise<void> {
  const state = resumeStatePath(g)
  if (!state) return
  const d = path.join(backupRoot(g), PREVIOUS_RESUME)
  await fsp.rm(d, { recursive: true, force: true })
  await fsp.mkdir(d, { recursive: true })
  const copy = path.join(d, path.basename(state))
  await fsp.copyFile(state, copy)
  await fsp.utimes(copy, new Date(), fs.statSync(state).mtime)
  writeJson(path.join(d, 'source.json'), { source: state })
}

export function previousResume(g: Game): { file: string; source: string; savedAt: number } | null {
  const d = path.join(backupRoot(g), PREVIOUS_RESUME)
  const src = readJson<{ source?: string }>(path.join(d, 'source.json'), {}).source
  if (!src) return null
  const file = path.join(d, path.basename(src))
  return fs.existsSync(file) ? { file, source: src, savedAt: fs.statSync(file).mtimeMs } : null
}

/** Put the kept resume state back (the current one is kept in its place, so this can be undone). */
export async function restorePreviousResume(g: Game): Promise<void> {
  const p = previousResume(g)
  if (!p) throw new Error('There is no earlier resume state.')
  const tmp = path.join(backupRoot(g), `${path.basename(p.file)}.swap`)
  const mtime = fs.statSync(p.file).mtime
  await fsp.copyFile(p.file, tmp)
  if (fs.existsSync(p.source)) await keepPreviousResume(g)
  await fsp.mkdir(path.dirname(p.source), { recursive: true })
  await fsp.copyFile(tmp, p.source)
  await fsp.utimes(p.source, new Date(), mtime)
  await fsp.rm(tmp, { force: true })
}

function emulatorVersion(c: ConsolePreset): string | undefined {
  const e = getEmulator(c.emulator)
  if (!e) return undefined
  return readJson<{ version?: string }>(path.join(emulatorDir(e), '.starstation.json'), {}).version
}

/** Path of the game's resume state, if one exists (newest match). */
export function resumeStatePath(g: Game): string | null {
  const c = getConsole(g.console)
  if (!c?.quickResume || !c.resume) return null
  const p = fillStrict(c.resume.state, gameVars(g))
  if (!p) return null
  // a state file can vanish between listing and reading it (the emulator replacing it): skip it
  const hits = expandGlob(p)
    .flatMap((f) => {
      const st = fs.statSync(f, { throwIfNoEntry: false })
      return st ? [{ f, t: st.mtimeMs }] : []
    })
    .sort((a, b) => b.t - a.t)
  return hits[0]?.f ?? null
}

const SESSION_START = 'session-start'

/** When a game starts: copy its resume state, so "Quit" (PS button menu) can leave it as it was. */
export async function snapshotResume(g: Game): Promise<void> {
  const d = path.join(backupRoot(g), SESSION_START)
  await fsp.rm(d, { recursive: true, force: true })
  const state = resumeStatePath(g)
  if (!state) return
  await fsp.mkdir(d, { recursive: true })
  const copy = path.join(d, path.basename(state))
  await fsp.copyFile(state, copy)
  await fsp.utimes(copy, new Date(), fs.statSync(state).mtime)
  writeJson(path.join(d, 'source.json'), { source: state })
}

/**
 * "Quit" without saving a state: the emulator wrote a resume state while closing (it always does);
 * put the one from before this session back, or remove the new one if there was none.
 */
export async function discardSessionResume(g: Game, startedAt: number): Promise<void> {
  const d = path.join(backupRoot(g), SESSION_START)
  const src = readJson<{ source?: string }>(path.join(d, 'source.json'), {}).source
  const now = resumeStatePath(g)
  if (now && fs.statSync(now).mtimeMs >= startedAt - 2000 && now !== src) await fsp.rm(now, { force: true })
  if (src) {
    const copy = path.join(d, path.basename(src))
    if (fs.existsSync(copy)) {
      await fsp.copyFile(copy, src)
      await fsp.utimes(src, new Date(), fs.statSync(copy).mtime)
    }
  }
  await fsp.rm(d, { recursive: true, force: true })
}

export function resumeInfo(g: Game): ResumeInfo | null {
  const state = resumeStatePath(g)
  if (!state) return null
  const c = getConsole(g.console)!
  const saved = getStats(g.id).resumeVersion
  const now = emulatorVersion(c)
  const e = getEmulator(c.emulator)
  const notes: string[] = []
  if (saved && now && saved !== now) notes.push(`${e?.name ?? 'The emulator'} was updated since this was saved (${saved} → ${now}). If resuming fails, start fresh.`)
  // a game only looks for controllers when it starts: resumed, it still knows only the players from back then
  // (Hannes, 2026-11-08: Midnight Club 3 resumed from a 1-player point, one controller drove both cars)
  const was = getStats(g.id).resumePlayers
  const players = knownPlayers()
  if (was && players > was) notes.push(`This was saved with ${was === 1 ? '1 controller' : `${was} controllers`}. To play with ${players}, start fresh, or the game won’t see the new ones.`)
  return { savedAt: fs.statSync(state).mtimeMs, warning: notes.length ? notes.join(' ') : undefined }
}

/** Extra launch arguments and config values for Resume / Start fresh. */
export function resumeLaunch(g: Game, mode: 'resume' | 'fresh'): { args: string[]; at: number; vars: Record<string, string> } {
  const c = getConsole(g.console)
  if (!c?.quickResume || !c.resume) return { args: [], at: 0, vars: {} }
  if (mode === 'fresh') return { args: [], at: 0, vars: { resume: 'false' } }
  const state = resumeStatePath(g)
  if (!state) return { args: [], at: 0, vars: { resume: 'false' } }
  const v = { ...gameVars(g), state }
  return { args: c.resume.args.map((a) => fillStrict(a, v) ?? a), at: c.resume.at ?? c.launch.insertAt ?? 0, vars: { resume: 'true', state } }
}

/** After the emulator closed: remember which version wrote the resume state. */
export function noteResumeVersion(gameId: string, startedAt: number): string | undefined {
  const g = getGame(gameId)
  if (!g) return undefined
  const state = resumeStatePath(g)
  if (!state || fs.statSync(state).mtimeMs < startedAt - 2000) return undefined
  return emulatorVersion(getConsole(g.console)!) ?? 'unknown'
}

// ---------------- delete ----------------

/** Files that make up the game itself (disc tracks of a .cue/.m3u included). */
export function gameFiles(g: Game): string[] {
  return g.kind === 'file' ? [g.path, ...partsOf(g.path)] : [g.path]
}

/** Save data that belongs only to this game (shared memory cards are never included). */
export function ownSaves(g: Game): string[] {
  const own = saveEntries(g)
    .filter((e) => !e.shared)
    .map((e) => e.path)
  const state = resumeStatePath(g)
  return state ? [...own, state] : own
}
