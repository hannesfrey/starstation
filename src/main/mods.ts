import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { dir } from './paths'
import { readJson, writeJson } from './store'
import { getConsole, type ConsolePreset, type GameOption, type ModTarget } from './presets'
import { applyStep } from './emuconfig'
import { artKey } from './library/library'
import { backupGame, fillStrict, gameVars } from './gamedata'
import { extract } from './emulators'
import { logger } from './log'
import type { Game, ModInfo } from '../shared/types'

/**
 * Mod manager. Originals stay in mods\<console>\<game>\<mod>\; switching a mod on puts hard links (or copies)
 * where the emulator looks, switching it off removes exactly those files. Files Starstation didn't place are
 * never touched. When two mods want the same file, the user decides which one wins.
 */

const log = logger('mods')

interface ModEntry {
  id: string
  name: string
  description?: string
  target: string
  enabled: boolean
  /** Has been switched on at least once (a save backup is made before the first time). */
  everEnabled?: boolean
  /** Paths inside the mod folder, and where each one goes inside the target folder. */
  files: string[]
  placement: string[]
  source: { type: 'file' | 'gamebanana'; ref?: string }
  image?: string
  addedAt: number
}

interface ModState {
  mods: ModEntry[]
  /** Target file (absolute, lower case) → id of the mod whose file is there. */
  owners: Record<string, string>
  gamebananaGame?: number
}

export function modsRoot(g: Game): string {
  return dir('mods', g.console, artKey(g))
}
const stateFile = (g: Game) => path.join(modsRoot(g), 'mods.json')
const load = (g: Game): ModState => readJson<ModState>(stateFile(g), { mods: [], owners: {} })
const save = (g: Game, s: ModState) => writeJson(stateFile(g), s)

function targetsOf(c: ConsolePreset | undefined): ModTarget[] {
  return c?.mods?.targets ?? []
}

function targetDir(g: Game, t: ModTarget): string | null {
  return fillStrict(t.dir, gameVars(g))
}

export function modSupport(g: Game): { targets: { id: string; label: string }[]; reason?: string; gamebanana: boolean } {
  const c = getConsole(g.console)
  const targets = targetsOf(c)
  if (!targets.length) return { targets: [], reason: `${c?.short ?? 'This console'} has no mod support in Starstation yet.`, gamebanana: false }
  const usable = targets.filter((t) => targetDir(g, t))
  return {
    targets: usable.map((t) => ({ id: t.id, label: t.label })),
    reason: usable.length ? undefined : "This game's ID is unknown, so Starstation can't tell the emulator where its mods are.",
    gamebanana: c?.mods?.gamebanana !== false
  }
}

export function listMods(g: Game): ModInfo[] {
  const st = load(g)
  const c = getConsole(g.console)
  return st.mods.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    target: targetsOf(c).find((t) => t.id === m.target)?.label ?? m.target,
    enabled: m.enabled,
    files: m.files.length,
    source: m.source.type,
    image: m.image ? path.join(modsRoot(g), m.id, m.image) : undefined
  }))
}

// ---------------- adding ----------------

function walk(root: string, rel = ''): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...walk(root, r))
    else if (e.isFile()) out.push(r)
  }
  return out
}

/** Zip/7z/rar archives often wrap everything in one folder: look inside it. */
function contentRoot(d: string): string {
  let cur = d
  for (;;) {
    const ents = fs.readdirSync(cur, { withFileTypes: true }).filter((e) => !/^(__MACOSX|\.DS_Store|thumbs\.db|\.pending\.json)$/i.test(e.name))
    if (ents.length === 1 && ents[0].isDirectory()) cur = path.join(cur, ents[0].name)
    else return cur
  }
}

function score(t: ModTarget, files: string[]): number {
  const re = t.match ? new RegExp(t.match, 'i') : null
  const anchor = t.anchor ? new RegExp(t.anchor, 'i') : null
  let n = 0
  for (const f of files) {
    if (re?.test(f)) n++
    if (anchor && f.split('/').some((seg) => anchor.test(seg))) n += 2
  }
  return n
}

function place(t: ModTarget, rel: string): string {
  const segs = rel.split('/')
  if (t.anchor) {
    const re = new RegExp(t.anchor, 'i')
    const i = segs.findIndex((s, k) => k < segs.length - 1 && re.test(s))
    if (i >= 0) return segs.slice(i).join('/')
  }
  if (t.flatten) return segs[segs.length - 1]
  return t.into ? `${t.into}/${rel}` : rel
}

export type AddModResult =
  | { ok: true; mod: ModInfo }
  | { ok: false; error: string }
  | { ok: false; ask: { pending: string; name: string; targets: { id: string; label: string }[] } }

/** Unpack an archive / copy a folder or file into the mods folder and work out where it goes. */
export async function addMod(
  g: Game,
  src: string,
  opts: { name?: string; target?: string; description?: string; image?: string; source?: ModEntry['source'] } = {}
): Promise<AddModResult> {
  const support = modSupport(g)
  if (!support.targets.length) return { ok: false, error: support.reason ?? 'No mod support.' }
  const root = modsRoot(g)
  const pending = `.incoming-${Date.now()}`
  const tmp = path.join(root, pending)
  await fsp.mkdir(tmp, { recursive: true })
  const ext = path.extname(src).toLowerCase()
  const name = opts.name ?? path.basename(src, fs.statSync(src).isDirectory() ? '' : ext)
  try {
    if (fs.statSync(src).isDirectory()) await fsp.cp(src, path.join(tmp, path.basename(src)), { recursive: true })
    else if (['.zip', '.7z', '.rar'].includes(ext)) await extract(src, tmp, { flatten: false })
    else await fsp.copyFile(src, path.join(tmp, path.basename(src)))
  } catch (e) {
    await fsp.rm(tmp, { recursive: true, force: true })
    return { ok: false, error: ext === '.rar' ? 'This RAR file could not be unpacked. Unpack it yourself and add the folder.' : (e as Error).message }
  }
  writeJson(path.join(tmp, '.pending.json'), { name, ...opts })
  return finishAdd(g, pending, opts.target)
}

/** Second half of adding (also used after "Where does this mod go?"). */
export async function finishAdd(g: Game, pending: string, targetId?: string): Promise<AddModResult> {
  const root = modsRoot(g)
  const tmp = path.join(root, pending)
  if (!pending.startsWith('.incoming-') || !fs.existsSync(tmp)) return { ok: false, error: 'That mod is no longer waiting to be added.' }
  const meta = readJson<{ name: string; description?: string; image?: string; source?: ModEntry['source'] }>(path.join(tmp, '.pending.json'), { name: 'Mod' })
  if (targetId === '') {
    await fsp.rm(tmp, { recursive: true, force: true })
    return { ok: false, error: 'Cancelled.' }
  }
  const content = contentRoot(tmp)
  const files = walk(content).filter((f) => f !== '.pending.json' && !(meta.image && f === meta.image))
  if (!files.length) {
    await fsp.rm(tmp, { recursive: true, force: true })
    return { ok: false, error: 'The mod is empty.' }
  }
  const targets = targetsOf(getConsole(g.console)).filter((t) => targetDir(g, t))
  let t = targets.find((x) => x.id === targetId)
  if (!t) {
    const ranked = targets.map((x) => ({ x, n: score(x, files) })).sort((a, b) => b.n - a.n)
    const sure = ranked.length === 1 || (ranked[0]?.n > 0 && ranked[0].n > (ranked[1]?.n ?? 0))
    if (!sure) return { ok: false, ask: { pending, name: meta.name, targets: targets.map((x) => ({ id: x.id, label: x.label })) } }
    t = ranked[0].x
  }
  const st = load(g)
  let id = meta.name.replace(/[^\w.-]+/g, '_').slice(0, 40) || 'mod'
  while (st.mods.some((m) => m.id === id) || fs.existsSync(path.join(root, id))) id += '_'
  const relContent = path.relative(tmp, content).replace(/\\/g, '/')
  await fsp.rename(tmp, path.join(root, id))
  const prefix = relContent ? `${relContent}/` : ''
  const entry: ModEntry = {
    id,
    name: meta.name,
    description: meta.description,
    target: t.id,
    enabled: false,
    files: files.map((f) => prefix + f),
    placement: files.map((f) => place(t, f)),
    source: meta.source ?? { type: 'file' },
    image: meta.image,
    addedAt: Date.now()
  }
  st.mods.push(entry)
  save(g, st)
  log.info(`${g.id}: added mod ${id} (${files.length} files → ${t.id})`)
  return { ok: true, mod: listMods(g).find((m) => m.id === id)! }
}

// ---------------- on / off ----------------

export type ToggleResult = { ok: true; skipped: number } | { ok: false; error: string } | { ok: false; conflict: { with: string[]; files: number } }

function linkOrCopy(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  try {
    fs.linkSync(from, to) // same drive: no extra space, and removing it leaves the original alone
  } catch {
    fs.copyFileSync(from, to)
  }
}

function removeEmptyDirs(from: string, stop: string): void {
  let d = path.dirname(from)
  const end = path.resolve(stop).toLowerCase()
  while (path.resolve(d).toLowerCase().startsWith(end) && path.resolve(d).toLowerCase() !== end) {
    try {
      if (fs.readdirSync(d).length) return
      fs.rmdirSync(d)
    } catch {
      return
    }
    d = path.dirname(d)
  }
}

/**
 * Switch a mod on or off. `winner`: when files clash with another mod that is on,
 * 'this' = this mod's files replace the other's, 'other' = the other mod keeps them.
 */
export async function setModEnabled(g: Game, id: string, on: boolean, winner?: 'this' | 'other'): Promise<ToggleResult> {
  const st = load(g)
  const m = st.mods.find((x) => x.id === id)
  if (!m) return { ok: false, error: 'Mod not found.' }
  const t = targetsOf(getConsole(g.console)).find((x) => x.id === m.target)
  const base = t && targetDir(g, t)
  if (!t || !base) return { ok: false, error: "Starstation can't tell where this mod goes for this game." }
  const src = path.join(modsRoot(g), m.id)
  const key = (rel: string) => path.join(base, rel).toLowerCase()

  if (on) {
    const clash = new Set<string>()
    let clashing = 0
    for (const rel of m.placement) {
      const owner = st.owners[key(rel)]
      if (owner && owner !== m.id && st.mods.some((x) => x.id === owner && x.enabled)) {
        clash.add(owner)
        clashing++
      }
    }
    if (clash.size && !winner) return { ok: false, conflict: { with: [...clash].map((o) => st.mods.find((x) => x.id === o)?.name ?? o), files: clashing } }
    if (!m.everEnabled) {
      await backupGame(g, 'before-mod').catch((e) => log.warn('backup before mod failed', e))
      m.everEnabled = true
    }
    let skipped = 0
    m.files.forEach((rel, i) => {
      const to = path.join(base, m.placement[i])
      const k = to.toLowerCase()
      const owner = st.owners[k]
      if (owner && owner !== m.id) {
        if (winner === 'other') return
        if (fs.existsSync(to)) fs.rmSync(to)
      } else if (!owner && fs.existsSync(to)) {
        skipped++ // a file Starstation didn't put there: never overwrite it
        return
      }
      if (owner === m.id && fs.existsSync(to)) return
      linkOrCopy(path.join(src, rel), to)
      st.owners[k] = m.id
    })
    m.enabled = true
    save(g, st)
    log.info(`${g.id}: mod ${id} on (${skipped} existing files left alone)`)
    return { ok: true, skipped }
  }

  // off: remove our files; another mod that is on and has the same file gets it back
  for (const rel of m.placement) {
    const to = path.join(base, rel)
    const k = to.toLowerCase()
    if (st.owners[k] !== m.id) continue
    if (fs.existsSync(to)) fs.rmSync(to)
    delete st.owners[k]
    const heir = st.mods.find((x) => x.id !== m.id && x.enabled && x.target === m.target && x.placement.some((p) => key(p) === k))
    if (heir) {
      const i = heir.placement.findIndex((p) => key(p) === k)
      linkOrCopy(path.join(modsRoot(g), heir.id, heir.files[i]), to)
      st.owners[k] = heir.id
    } else removeEmptyDirs(to, base)
  }
  m.enabled = false
  save(g, st)
  log.info(`${g.id}: mod ${id} off`)
  return { ok: true, skipped: 0 }
}

export async function deleteMod(g: Game, id: string): Promise<void> {
  const st = load(g)
  if (st.mods.find((x) => x.id === id)?.enabled) await setModEnabled(g, id, false)
  const after = load(g)
  after.mods = after.mods.filter((x) => x.id !== id)
  save(g, after)
  await fsp.rm(path.join(modsRoot(g), id), { recursive: true, force: true })
}

/** Mods that arrived in a package and were on at the sender: switch them on here (this PC's paths). */
export async function enablePending(g: Game): Promise<number> {
  const st = load(g)
  const pending = st.mods.filter((m) => (m as ModEntry & { pendingOn?: boolean }).pendingOn)
  if (!pending.length) return 0
  for (const m of pending) delete (m as ModEntry & { pendingOn?: boolean }).pendingOn
  save(g, st)
  let n = 0
  for (const m of pending) if ((await setModEnabled(g, m.id, true, 'other')).ok) n++
  return n
}

export function hasEnabledMods(g: Game): boolean {
  return load(g).mods.some((m) => m.enabled)
}

/** Emulator settings that depend on mods (e.g. "load texture replacements") — vars and steps per target. */
function modOptions(c: ConsolePreset, g: Game): GameOption[] {
  const on = new Set(load(g).mods.filter((m) => m.enabled).map((m) => m.target))
  return targetsOf(c).map((t) => (on.has(t.id) ? t.enabled : t.disabled) ?? {})
}
export function modVars(c: ConsolePreset, g: Game): Record<string, string> {
  return Object.assign({}, ...modOptions(c, g).map((o) => o.vars ?? {}))
}
export function applyModSettings(c: ConsolePreset, g: Game, v: Record<string, string>): void {
  for (const o of modOptions(c, g))
    for (const s of o.steps ?? []) {
      try {
        applyStep(s, gameVars(g, v))
      } catch (e) {
        log.warn(`${c.id}: mod setting failed`, e)
      }
    }
}

export function setModImage(g: Game, id: string, file: string): void {
  const st = load(g)
  const m = st.mods.find((x) => x.id === id)
  if (!m) return
  m.image = file
  save(g, st)
}

export function gamebananaGame(g: Game): number | undefined {
  return load(g).gamebananaGame
}
export function setGamebananaGame(g: Game, id: number): void {
  const st = load(g)
  st.gamebananaGame = id
  save(g, st)
}
