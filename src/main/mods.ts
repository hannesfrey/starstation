import fs from 'node:fs'
import fsp from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'
import { dir } from './paths'
import { readJson, writeJson } from './store'
import { getConsole, type ConsolePreset, type GameOption, type ModTarget } from './presets'
import { applyStep } from './emuconfig'
import { artKey } from './library/library'
import { backupGame, fillStrict, gameVars } from './gamedata'
import { extract } from './emulators'
import { makePatchedCopy, patchKind } from './patchmods'
import { PatchError } from './formats/patch'
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
  source: { type: 'file' | 'gamebanana' | 'nexus'; ref?: string }
  image?: string
  addedAt: number
  /** Patch-file mod: the patched copy of the game that starts while the mod is on. */
  patch?: { launch: string; kind: string }
  /** Can't be placed automatically: its instructions (readme) are shown; the user installs it by hand. */
  manual?: { readme: string[] }
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
    target: m.patch ? 'Patched copy of the game' : m.manual ? 'Install by hand' : (targetsOf(c).find((t) => t.id === m.target)?.label ?? m.target),
    manual: m.manual ? { lines: m.manual.readme, folder: path.join(modsRoot(g), m.id) } : undefined,
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

/**
 * Zip/7z/rar archives often wrap everything in one folder: look inside it — but never past a folder the
 * emulator looks for by name (e.g. "replacements"), or "replacements/cars/…" would lose its "cars".
 */
function contentRoot(d: string, anchors: RegExp[] = []): string {
  let cur = d
  for (;;) {
    const ents = fs.readdirSync(cur, { withFileTypes: true }).filter((e) => !/^(__MACOSX|\.DS_Store|thumbs\.db|\.pending\.json)$/i.test(e.name))
    if (ents.length === 1 && ents[0].isDirectory() && !anchors.some((a) => a.test(ents[0].name))) cur = path.join(cur, ents[0].name)
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
  opts: { name?: string; target?: string; description?: string; image?: string; source?: ModEntry['source']; move?: boolean } = {}
): Promise<AddModResult> {
  // a patch file (.ips / .bps / .ppf / .xdelta): a patched copy of the game, for every console
  if (!fs.statSync(src).isDirectory() && patchKind(src)) return addPatchMod(g, src, opts)
  const support = modSupport(g)
  const root = modsRoot(g)
  const pending = `.incoming-${Date.now()}`
  const tmp = path.join(root, pending)
  await fsp.mkdir(tmp, { recursive: true })
  const ext = path.extname(src).toLowerCase()
  const name = opts.name ?? path.basename(src, fs.statSync(src).isDirectory() ? '' : ext)
  try {
    if (fs.statSync(src).isDirectory()) {
      // move: Starstation's own unpacked copy (mods folder inbox) — no second copy of a big pack
      const to = path.join(tmp, path.basename(src))
      if (opts.move) await fsp.rename(src, to).catch(() => fsp.cp(src, to, { recursive: true }))
      else await fsp.cp(src, to, { recursive: true })
    }
    else if (['.zip', '.7z', '.rar'].includes(ext)) await extract(src, tmp, { flatten: false })
    else await fsp.copyFile(src, path.join(tmp, path.basename(src)))
  } catch (e) {
    await fsp.rm(tmp, { recursive: true, force: true })
    return { ok: false, error: ext === '.rar' ? 'This RAR file could not be unpacked. Unpack it yourself and add the folder.' : (e as Error).message }
  }
  // an archive with just a patch (and maybe a readme) in it
  const inside = walk(tmp)
  const patches = inside.filter((f) => patchKind(path.join(tmp, f)))
  const rest = inside.filter((f) => !patches.includes(f) && !/\.(txt|md|nfo|pdf|png|jpe?g|url|htm|html)$/i.test(f))
  if (patches.length === 1 && !rest.length) {
    // the readme names the exact game version it needs (e.g. by MD5): check before patching for minutes
    const wrong = await wrongBase(g, inside.filter((f) => /\.(txt|md|nfo)$/i.test(f)).map((f) => fs.readFileSync(path.join(tmp, f), 'utf8')).join('\n'))
    if (wrong) {
      await fsp.rm(tmp, { recursive: true, force: true })
      return { ok: false, error: wrong }
    }
    const r = await addPatchMod(g, path.join(tmp, patches[0]), { ...opts, name: opts.name ?? name })
    await fsp.rm(tmp, { recursive: true, force: true })
    return r
  }
  void support
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
  const anchors = targetsOf(getConsole(g.console)).flatMap((t) => (t.anchor ? [new RegExp(t.anchor, 'i')] : []))
  const content = contentRoot(tmp, anchors)
  const files = walk(content).filter((f) => f !== '.pending.json' && !(meta.image && f === meta.image))
  if (!files.length) {
    await fsp.rm(tmp, { recursive: true, force: true })
    return { ok: false, error: 'The mod is empty.' }
  }
  const targets = targetsOf(getConsole(g.console)).filter((t) => targetDir(g, t))
  // nowhere Starstation knows to put it (or the user said "none of these"): keep it, show its instructions
  if (targetId === 'manual' || !targets.length) return keepManual(g, tmp, content, files, meta)
  let t = targets.find((x) => x.id === targetId)
  if (!t) {
    const ranked = targets.map((x) => ({ x, n: score(x, files) })).sort((a, b) => b.n - a.n)
    // none of its files is anything the emulator loads (e.g. a tool or a patch Starstation doesn't know):
    // don't put it anywhere — keep it with its instructions
    if (!ranked.length || ranked[0].n === 0) return keepManual(g, tmp, content, files, meta)
    const sure = ranked.length === 1 || ranked[0].n > (ranked[1]?.n ?? 0)
    if (!sure) return { ok: false, ask: { pending, name: meta.name, targets: targets.map((x) => ({ id: x.id, label: x.label })) } }
    t = ranked[0].x
  }
  // a pack with a folder the emulator looks for (e.g. "replacements") and extras beside it ("Alternate Textures"):
  // only what's inside that folder goes in; the extras stay with the mod
  const anchorRe = t.anchor ? new RegExp(t.anchor, 'i') : null
  const anchored = anchorRe ? files.filter((f) => f.split('/').slice(0, -1).some((s) => anchorRe.test(s))) : []
  const placed = anchored.length ? anchored : files
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
    files: placed.map((f) => prefix + f),
    placement: placed.map((f) => place(t, f)),
    source: meta.source ?? { type: 'file' },
    image: meta.image,
    addedAt: Date.now()
  }
  st.mods.push(entry)
  save(g, st)
  log.info(`${g.id}: added mod ${id} (${placed.length} of ${files.length} files → ${t.id})`)
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
  if (m.manual) return { ok: false, error: 'This mod is installed by hand: its instructions are in Mods → the mod.' }
  if (m.patch) {
    // a patched copy: only one can start at a time
    if (on && !fs.existsSync(m.patch.launch)) return { ok: false, error: 'The patched copy is missing. Add the patch again.' }
    if (on && !m.everEnabled) {
      await backupGame(g, 'before-mod').catch((e) => log.warn('backup before mod failed', e))
      m.everEnabled = true
    }
    for (const x of st.mods) if (x.patch) x.enabled = on && x.id === id ? true : x.id === id ? false : on ? false : x.enabled
    save(g, st)
    log.info(`${g.id}: patch mod ${id} ${on ? 'on' : 'off'}`)
    return { ok: true, skipped: 0 }
  }
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

// ---------- manual mods (SPEC-v2 E) ----------

async function keepManual(
  g: Game,
  tmp: string,
  content: string,
  files: string[],
  meta: { name: string; description?: string; image?: string; source?: ModEntry['source'] }
): Promise<AddModResult> {
  const root = modsRoot(g)
  const st = load(g)
  let id = meta.name.replace(/[^\w.-]+/g, '_').slice(0, 40) || 'mod'
  while (st.mods.some((m) => m.id === id) || fs.existsSync(path.join(root, id))) id += '_'
  // the mod's own instructions: the first readme-like file
  const readmeFile = files.find((f) => /(^|\/)(read ?me|install|instructions)[^/]*\.(txt|md|nfo)$/i.test(f)) ?? files.find((f) => /\.(txt|md|nfo)$/i.test(f))
  let readme: string[] = []
  if (readmeFile)
    readme = fs
      .readFileSync(path.join(content, readmeFile), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.replace(/[#*>`]/g, '').trim())
      .filter(Boolean)
      .slice(0, 30)
  if (!readme.length) readme = ['This mod came without instructions.', `Its files: ${files.slice(0, 5).join(', ')}${files.length > 5 ? ' …' : ''}`]
  await fsp.rm(path.join(tmp, '.pending.json'), { force: true })
  await fsp.rename(tmp, path.join(root, id))
  st.mods.push({ id, name: meta.name, description: meta.description, target: 'manual', enabled: false, files, placement: [], source: meta.source ?? { type: 'file' }, image: meta.image, addedAt: Date.now(), manual: { readme } })
  save(g, st)
  log.info(`${g.id}: kept mod ${id} to install by hand`)
  return { ok: true, mod: listMods(g).find((m) => m.id === id)! }
}

// ---------- patch-file mods (SPEC-v2 E) ----------

/** The readme's own words about the version it needs: the sentence with the MD5 and the one before it (exported for tests). */
export function neededVersion(docs: string): string {
  const text = docs
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^[=#*\-_]{2}|[=#]{2}$/.test(l)) // headings like "==1. Verify disc image=="
    .join(' ')
    .replace(/\s+/g, ' ')
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/)
  const i = sentences.findIndex((s) => /[0-9a-f]{32}/i.test(s))
  if (i < 0) return ''
  const out = sentences.slice(Math.max(0, i - 1), i + 1).join(' ')
  return out.length > 400 ? `${out.slice(0, 400)}…` : out
}

/**
 * Patch readmes often name the one game version the patch fits by its MD5 (Spec II: "verify that the MD5 hash is …").
 * If they do and this game's file isn't one of them, say so in plain words instead of failing after minutes.
 * (exported for tests)
 */
export async function wrongBase(g: Game, docs: string): Promise<string | null> {
  const hashes = new Set([...docs.matchAll(/\b[0-9a-f]{32}\b/gi)].map((m) => m[0].toLowerCase()))
  if (!hashes.size || !/md5/i.test(docs) || !/\.(iso|bin|img|gcm|cso)$/i.test(g.launchPath) || !fs.existsSync(g.launchPath)) return null
  const md5 = await new Promise<string>((resolve, reject) => {
    const h = crypto.createHash('md5')
    fs.createReadStream(g.launchPath)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
  if (hashes.has(md5)) return null
  const need = neededVersion(docs)
  log.info(`${g.id}: patch needs another version (game MD5 ${md5})`)
  return `It's made for a different version of the game than yours (${path.basename(g.launchPath)}). Its instructions say: “${need}”`
}

async function addPatchMod(g: Game, patchFile: string, opts: { name?: string; description?: string; source?: ModEntry['source'] }): Promise<AddModResult> {
  const root = modsRoot(g)
  const st = load(g)
  const name = opts.name ?? path.basename(patchFile, path.extname(patchFile))
  let id = name.replace(/[^\w.-]+/g, '_').slice(0, 40) || 'patch'
  while (st.mods.some((m) => m.id === id) || fs.existsSync(path.join(root, id))) id += '_'
  const dir = path.join(root, id)
  const work = path.join(root, `.patch-${Date.now()}`)
  await fsp.mkdir(work, { recursive: true })
  try {
    await fsp.mkdir(dir, { recursive: true })
    await fsp.copyFile(patchFile, path.join(dir, path.basename(patchFile)))
    const launch = await makePatchedCopy(g, patchFile, path.join(dir, 'patched'), work)
    const entry: ModEntry = {
      id,
      name,
      description: opts.description,
      target: 'patch',
      enabled: false,
      files: [],
      placement: [],
      source: opts.source ?? { type: 'file' },
      addedAt: Date.now(),
      patch: { launch, kind: patchKind(patchFile) ?? 'patch' }
    }
    const now = load(g)
    now.mods.push(entry)
    save(g, now)
    log.info(`${g.id}: added patch mod ${id}`)
    return { ok: true, mod: listMods(g).find((m) => m.id === id)! }
  } catch (e) {
    await fsp.rm(dir, { recursive: true, force: true })
    log.warn(`${g.id}: patch failed`, e)
    return { ok: false, error: e instanceof PatchError ? `The patch can't be used: ${e.message}.` : (e as Error).message }
  } finally {
    await fsp.rm(work, { recursive: true, force: true })
  }
}

/** The file to start instead of the game while a patch mod is on (null = the game itself). */
export function patchedLaunch(g: Game): string | null {
  const m = load(g).mods.find((x) => x.patch && x.enabled)
  return m?.patch && fs.existsSync(m.patch.launch) ? m.patch.launch : null
}

// ---------- mod profiles (SPEC-v2 E) ----------
// A profile is a named set of mods that are on; "Vanilla" = none. Which one is active is worked out
// from the mods that are on now (no stored "active": switching a mod by hand simply makes it "Custom").

export interface ModProfile {
  id: string
  name: string
  mods: string[]
}

function profilesOf(st: ModState): ModProfile[] {
  return (st as ModState & { profiles?: ModProfile[] }).profiles ?? []
}

export function modProfiles(g: Game): { profiles: ModProfile[]; active: string | null } {
  const st = load(g)
  const on = st.mods.filter((m) => m.enabled).map((m) => m.id).sort().join('|')
  const all: ModProfile[] = [{ id: 'vanilla', name: 'Vanilla', mods: [] }, ...profilesOf(st)]
  const active = all.find((p) => [...p.mods].filter((id) => st.mods.some((m) => m.id === id)).sort().join('|') === on)
  return { profiles: all, active: active?.id ?? null }
}

/** Save the mods that are on now as a profile (same name: replaced). */
export function saveModProfile(g: Game, name: string): ModProfile[] {
  const st = load(g) as ModState & { profiles?: ModProfile[] }
  const clean = name.trim().slice(0, 30) || 'Profile'
  const mods = st.mods.filter((m) => m.enabled).map((m) => m.id)
  const list = (st.profiles ?? []).filter((p) => p.name.toLowerCase() !== clean.toLowerCase())
  list.push({ id: `p${Date.now().toString(36)}`, name: clean, mods })
  st.profiles = list
  save(g, st)
  return modProfiles(g).profiles
}

export function deleteModProfile(g: Game, id: string): void {
  const st = load(g) as ModState & { profiles?: ModProfile[] }
  st.profiles = (st.profiles ?? []).filter((p) => p.id !== id)
  save(g, st)
}

/** Switch to a profile: mods not in it go off, mods in it come on (in the profile's order: later ones win clashes). */
export async function applyModProfile(g: Game, id: string): Promise<{ ok: boolean; error?: string }> {
  const prof = modProfiles(g).profiles.find((p) => p.id === id)
  if (!prof) return { ok: false, error: 'Profile not found.' }
  for (const m of load(g).mods.filter((x) => x.enabled && !prof.mods.includes(x.id))) {
    const r = await setModEnabled(g, m.id, false)
    if (!r.ok) return { ok: false, error: 'error' in r ? r.error : 'A mod could not be switched off.' }
  }
  for (const mid of prof.mods) {
    const m = load(g).mods.find((x) => x.id === mid)
    if (!m || m.enabled) continue
    const r = await setModEnabled(g, mid, true, 'this')
    if (!r.ok) return { ok: false, error: 'error' in r ? r.error : `${m.name} could not be switched on.` }
  }
  log.info(`${g.id}: mod profile ${prof.name}`)
  return { ok: true }
}
