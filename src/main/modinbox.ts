import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { dir } from './paths'
import { readJson, writeJson } from './store'
import { getConsole } from './presets'
import { unpack } from './emulators'
import { view } from './library/library'
import { addMod, modsRoot, setModEnabled, type AddModResult } from './mods'
import { signature, stillWriting } from './downloads'
import { logger } from './log'
import { guessGame } from './formats/modguess'
import type { Game, Notice } from '../shared/types'

/**
 * Mods dropped into Files\mods (or a console folder like mods\ps2) are added by themselves (Hannes, 2026-11-07:
 * "the mod adding process is pretty miserable from my side"). Like New downloads for games:
 * wait until the copy has finished → unpack once → work out the game (game codes in the readme, then the name;
 * asks when unsure) → install → switch on → the original goes to the Recycle Bin.
 * Game mod folders (mods\<console>\<game>\ with mods.json) are Starstation's own and never looked at.
 */

const log = logger('mod-inbox')
const ARCHIVE = /\.(zip|7z|rar)$/i
const LOOSE = /\.(pnach|ips|bps|ppf|xdelta|vcdiff)$/i
const PARTIAL = /\.(crdownload|part|partial|download|opdownload|tmp|!ut|aria2)$/i
const DOCS = /\.(txt|md|nfo)$/i
const POLL = Number(process.env.STARSTATION_MODS_POLL) || 5000

export interface InboxHooks {
  notify(n: Omit<Notice, 'id'>): void
  trash(p: string): Promise<void>
  /** Which game is this mod for? (the answer comes back through assignInbox) */
  ask(q: InboxQuestion): void
  /** The add result for the menu (a "where does this go?" question, instructions to show). */
  added(gameId: string, r: AddModResult): void
  paused(): boolean
}

export interface InboxQuestion {
  id: string
  name: string
  /** Game ids, most likely first. */
  games: string[]
}

interface Waiting {
  id: string
  path: string
  console?: string
  name: string
  /** Unpacked copy (archives), so it isn't unpacked twice. */
  staged?: string
  sig: string
  /** The question as it was asked (asked again if the menu was reloaded meanwhile). */
  question?: InboxQuestion
}

/** Items handled already (failed or refused): not again until they change. */
const stateFile = () => dir('config', 'mods-inbox.json')
const seen = new Map<string, string>()
/** "Not now": asked again at the next start. */
const later = new Set<string>()
const waiting = new Map<string, Waiting>()
let busy = false
let hooks: InboxHooks | null = null

function hasFile(d: string, depth = 0): boolean {
  if (depth > 8) return false
  try {
    return fs.readdirSync(d, { withFileTypes: true }).some((e) => e.isFile() || (e.isDirectory() && hasFile(path.join(d, e.name), depth + 1)))
  } catch {
    return false
  }
}

/** Files and folders waiting in mods\ and mods\<console>\ (not the game mod folders). */
function items(): { path: string; console?: string }[] {
  const root = dir('mods')
  fs.mkdirSync(root, { recursive: true })
  const out: { path: string; console?: string }[] = []
  const take = (p: string, consoleId?: string) => {
    const name = path.basename(p)
    if (name.startsWith('.') || /^(desktop\.ini|thumbs\.db)$/i.test(name) || PARTIAL.test(name)) return
    let st: fs.Stats
    try {
      st = fs.statSync(p)
    } catch {
      return
    }
    if (st.isDirectory()) {
      if (fs.existsSync(path.join(p, 'mods.json'))) return // a game's mods (Starstation's own)
      if (!hasFile(p)) return // an empty folder (e.g. one made by hand while following a readme): nothing to add
      out.push({ path: p, console: consoleId })
    } else if (ARCHIVE.test(name) || LOOSE.test(name)) out.push({ path: p, console: consoleId })
  }
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, e.name)
    if (e.isDirectory() && getConsole(e.name)) {
      for (const n of fs.readdirSync(p)) take(path.join(p, n), e.name)
    } else take(p)
  }
  return out
}

/** Readmes (and file names) of an unpacked mod, to recognise the game. */
function docsOf(folder: string): string {
  let text = ''
  const walk = (d: string, depth: number) => {
    if (depth > 4 || text.length > 200_000) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else if (DOCS.test(e.name) && fs.statSync(p).size < 500_000) text += `\n${e.name}\n${fs.readFileSync(p, 'utf8')}`
    }
  }
  try {
    if (fs.statSync(folder).isDirectory()) walk(folder, 0)
  } catch {
    /* gone */
  }
  return text
}

const handled = () => readJson<Record<string, string>>(stateFile(), {})
function markHandled(p: string, sig: string): void {
  writeJson(stateFile(), { ...handled(), [p.toLowerCase()]: sig })
}

/** Unpack an archive next to the inbox (once), leave folders and loose files as they are. */
async function stage(w: Waiting): Promise<string> {
  if (w.staged && fs.existsSync(w.staged)) return w.staged
  if (!ARCHIVE.test(w.path)) return w.path
  const size = fs.statSync(w.path).size
  const work = dir('mods', '.unpacking')
  await fsp.mkdir(work, { recursive: true })
  const free = await fsp.statfs(work)
  if (free.bavail * free.bsize < size * 2.5 + 1024 ** 3) throw new Error(`Not enough free space to unpack it: about ${Math.ceil((size * 2.5) / 1e9)} GB is needed.`)
  hooks?.notify({ kind: 'mod', title: 'Unpacking a mod', detail: `${w.name}${size > 1e9 ? ' · this can take a few minutes' : ''}` })
  const to = path.join(work, `${Date.now()}`)
  await unpack(w.path, to)
  w.staged = to
  return to
}

async function install(w: Waiting, g: Game): Promise<void> {
  const h = hooks!
  waiting.delete(w.id)
  try {
    const src = await stage(w)
    // Starstation's own unpacked copy is moved (no second copy of a big pack); the user's own folder is copied
    const r = await addMod(g, src, { name: w.name, move: src !== w.path })
    if (!r.ok && 'ask' in r) {
      // more than one place it could go: the menu asks; the original stays until then
      h.added(g.id, r)
      await h.trash(w.path).catch(() => undefined)
      return
    }
    if (!r.ok) {
      markHandled(w.path, w.sig)
      h.notify({ kind: 'error', title: `Mod not added: ${w.name}`, detail: `${r.error} It stays in the mods folder.` })
      return
    }
    let on = false
    if (!r.mod.manual) {
      const t = await setModEnabled(g, r.mod.id, true)
      on = t.ok
      if (!t.ok) log.info(`${g.id}: ${r.mod.id} added but left off (${'conflict' in t ? 'overlaps another mod' : t.error})`)
    }
    await h.trash(w.path).catch((e) => log.warn(`could not bin ${w.path}`, e))
    log.info(`${w.name} → ${g.id} (${on ? 'on' : r.mod.manual ? 'by hand' : 'off'})`)
    h.notify({
      kind: 'mod',
      title: on ? 'Mod installed and on' : r.mod.manual ? 'Mod kept: install it by hand' : 'Mod installed (off)',
      detail: on
        ? `${r.mod.name} · ${g.title}. To switch it off: △ → Mods.`
        : r.mod.manual
          ? `${r.mod.name} · ${g.title}. Starstation can't place it by itself; △ → Mods shows its instructions.`
          : `${r.mod.name} · ${g.title}. It overlaps another mod: △ → Mods to choose.`
    })
    h.added(g.id, r)
  } catch (e) {
    markHandled(w.path, w.sig)
    log.warn(`${w.name}: not added`, e)
    h.notify({ kind: 'error', title: `Mod not added: ${w.name}`, detail: `${(e as Error).message} It stays in the mods folder.` })
  } finally {
    if (w.staged) await fsp.rm(w.staged, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** The user picked the game for a mod ("" = not now). */
export async function assignInbox(id: string, gameId: string): Promise<void> {
  const w = waiting.get(id)
  if (!w) return
  if (!gameId) {
    waiting.delete(id)
    later.add(`${w.path.toLowerCase()}|${w.sig}`)
    if (w.staged) await fsp.rm(w.staged, { recursive: true, force: true }).catch(() => undefined)
    return
  }
  const g = view().games.find((x) => x.id === gameId)
  if (!g) return
  busy = true
  try {
    await install(w, g)
  } finally {
    busy = false
  }
}

async function handle(p: string, consoleId: string | undefined, sig: string): Promise<void> {
  const name = fs.statSync(p).isDirectory() ? path.basename(p) : path.basename(p, path.extname(p))
  const w: Waiting = { id: `m${Date.now()}`, path: p, console: consoleId, name, sig }
  const games = view().games.filter((g) => !consoleId || g.console === consoleId)
  if (!games.length) {
    markHandled(p, sig)
    hooks!.notify({ kind: 'warning', title: `Mod not added: ${name}`, detail: consoleId ? `There are no ${getConsole(consoleId)?.short ?? consoleId} games in the library for it.` : 'There are no games in the library yet.' })
    return
  }
  let docs = ''
  try {
    docs = docsOf(await stage(w))
  } catch (e) {
    markHandled(p, sig)
    hooks!.notify({ kind: 'error', title: `Mod not added: ${name}`, detail: `${(e as Error).message} It stays in the mods folder.` })
    return
  }
  const guess = guessGame(name, docs, games)
  if (guess.sure) return install(w, games.find((g) => g.id === guess.sure)!)
  waiting.set(w.id, w)
  log.info(`${name}: which game? asking`)
  // nothing to go on: games that already have mods are the likeliest (a second pack for the same game)
  const modded = new Set(games.filter((g) => fs.existsSync(path.join(modsRoot(g), 'mods.json'))).map((g) => g.id))
  const ranked = [...guess.ranked.filter((id) => modded.has(id)), ...guess.ranked.filter((id) => !modded.has(id))]
  w.question = { id: w.id, name, games: ranked.slice(0, 15) }
  hooks!.ask(w.question)
}

/**
 * Questions still waiting for an answer. The menu asks for them again whenever it (re)loads: a question lost
 * with a reload would otherwise stop the mods folder for the rest of the session (it waits for the answer).
 */
export function openInboxQuestions(): InboxQuestion[] {
  return [...waiting.values()].flatMap((w) => (w.question ? [w.question] : []))
}

/** One look at the mods folder. Exported for tests; normally called by the watcher. */
export async function checkModInbox(): Promise<void> {
  if (!hooks || busy || hooks.paused() || waiting.size) return
  busy = true
  try {
    const done = handled()
    const list = items()
    const keys = new Set(list.map((i) => i.path))
    for (const k of [...seen.keys()]) if (!keys.has(k)) seen.delete(k)
    for (const it of list) {
      const s = signature(it.path)
      if (!s) continue
      const before = seen.get(it.path)
      seen.set(it.path, s.id)
      // finished copying: the same at two looks and not touched for a few seconds
      if (before !== s.id || Date.now() - s.mtime < Math.min(3000, POLL)) continue
      // still being copied in (Explorer sets the full size first): look again once it's free
      if (!s.id.startsWith('d') && stillWriting(it.path)) {
        seen.delete(it.path)
        continue
      }
      if (done[it.path.toLowerCase()] === s.id || later.has(`${it.path.toLowerCase()}|${s.id}`)) continue
      await handle(it.path, it.console, s.id)
      if (waiting.size) break // one question at a time
    }
  } catch (e) {
    log.warn('mods folder check failed', e)
  } finally {
    busy = false
  }
}

export function startModInbox(h: InboxHooks): void {
  hooks = h
  setInterval(() => void checkModInbox(), POLL).unref()
}
