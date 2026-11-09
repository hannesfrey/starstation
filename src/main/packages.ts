import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { app } from 'electron'
import { binDir, dir, filesDir } from './paths'
import { readJson, writeJson } from './store'
import { allConsoles, allEmulators, emulatorDir, getEmulator, loadPresets } from './presets'
import { applyConsoleConfig } from './emuconfig'
import { view } from './library/library'
import { logger } from './log'
import { addProfile, profileByName, profileData } from './profiles'
import type { Inventory, PackageChoice, PackageManifest, PackageProgress, ProfileMerge } from '../shared/types'

/**
 * Packages copy a whole setup to another PC: emulators, BIOS, games, mods, settings, saves (optional).
 * Sent by code with croc (encrypted, resumable) or saved to a folder. Receiving adds what's new and never
 * deletes or overwrites anything that is already there.
 * Never included: favorites, play time, recently played (stats.json), logins (secrets.json), logs, caches —
 * unless profiles are sent along on purpose (SPEC-v2 F), then those profiles' saves, play time and
 * favorites travel too.
 * Smart packages (SPEC-v2 F): the receiving Starstation first tells the sender what it has (an inventory:
 * file paths + sizes); the sender leaves those files out. "Only new since last time" also leaves out what
 * hasn't changed since the last package to that PC.
 */

const log = logger('packages')
const FORMAT = 1

// ---------------- what goes in ----------------

interface Entry {
  from: string
  rel: string
}

function isLink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

export function planPackage(c: PackageChoice): { entries: Entry[]; manifest: PackageManifest } {
  const entries: Entry[] = []
  const add = (from: string, rel: string) => fs.existsSync(from) && entries.push({ from, rel })
  const emus = allEmulators().filter((e) => !path.isAbsolute(e.folder) && fs.existsSync(emulatorDir(e)))
  if (c.emulators) for (const e of emus) add(emulatorDir(e), path.join('emulators', e.folder))
  if (c.bios) for (const con of allConsoles()) add(dir('bios', con.id), path.join('bios', con.id))
  const lib = view().games
  const games = lib.filter((g) => g.kind !== 'installed' && (c.games === 'all' || c.games.includes(g.console)))
  for (const con of allConsoles()) {
    if (!games.some((g) => g.console === con.id)) continue
    // the whole console folder: keeps .cue tracks, .m3u discs and PS3 folders together
    if (c.games === 'all' || c.games.includes(con.id)) add(dir('games', con.id), path.join('games', con.id))
  }
  if (c.mods) add(dir('mods'), 'mods')
  if (c.saves)
    for (const con of allConsoles()) {
      const d = dir('saves', con.id)
      if (!fs.existsSync(d)) continue
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n)
        // saves that are links into an emulator folder travel with the emulator when that is included
        if (isLink(p) && c.emulators) continue
        add(p, path.join('saves', con.id, n))
      }
    }
  // profiles sent along: everything that is theirs
  for (const id of c.profiles ?? []) {
    const p = profileData(id)
    const name = listProfileName(id)
    if (!name) continue
    const base = path.join('profiles', safeName(name))
    add(p.stats, path.join(base, 'stats.json'))
    add(p.saves, path.join(base, 'saves'))
    for (const [key, from] of Object.entries(p.emu)) add(from, path.join(base, 'emulator-saves', key))
  }
  if (c.settings) {
    for (const f of ['settings.json', 'controllers.json']) add(dir('config', f), path.join('config', f))
    for (const f of ['collections.json', 'game-options.json']) add(dir('config', 'library', f), path.join('config', 'library', f))
    add(dir('config', 'consoles'), path.join('config', 'consoles'))
  }
  const manifest: PackageManifest = {
    format: FORMAT,
    app: 'Starstation',
    version: app.getVersion(),
    createdAt: new Date().toISOString(),
    includes: { ...c },
    emulators: c.emulators ? emus.map((e) => e.id) : [],
    games: games.length
  }
  return { entries, manifest }
}

const safeName = (n: string) => n.replace(/[^\w .-]+/g, '_').trim() || 'Profile'
function listProfileName(id: string): string | undefined {
  return profileNames().get(id)
}
function profileNames(): Map<string, string> {
  return new Map(readJson<{ list?: { id: string; name: string }[] }>(dir('config', 'profiles.json'), {}).list?.map((p) => [p.id, p.name]) ?? [])
}

// ---------------- smart packages ----------------

/** This PC's own id (so a sender can remember what it sent here). */
export function pcId(): string {
  const f = dir('config', 'pc-id.json')
  const have = readJson<{ id?: string }>(f, {}).id
  if (have) return have
  const id = crypto.randomUUID()
  writeJson(f, { id })
  return id
}

/** What this PC has (the parts a package can bring): path inside Files → size. */
export function inventory(): Inventory {
  const files: Record<string, number> = {}
  const root = filesDir()
  const walk = (p: string) => {
    let st: fs.Stats
    try {
      st = fs.statSync(p)
    } catch {
      return
    }
    if (st.isDirectory()) for (const n of fs.readdirSync(p)) walk(path.join(p, n))
    else if (st.isFile()) files[path.relative(root, p).replace(/\\/g, '/')] = st.size
  }
  for (const d of ['emulators', 'bios', 'games', 'mods', 'saves']) walk(path.join(root, d))
  return { pcId: pcId(), files, at: new Date().toISOString() }
}

const sentFile = () => dir('config', 'packages', 'sent.json')
export const INVENTORY_FILE = 'Starstation inventory.json'

export function lastSentTo(pc: string): number | undefined {
  const t = readJson<Record<string, string>>(sentFile(), {})[pc]
  return t ? Date.parse(t) : undefined
}
export function noteSent(pc: string): void {
  writeJson(sentFile(), { ...readJson<Record<string, string>>(sentFile(), {}), [pc]: new Date().toISOString() })
}

function treeSize(p: string): { files: number; bytes: number } {
  let files = 0
  let bytes = 0
  const walk = (q: string) => {
    let st: fs.Stats
    try {
      st = fs.statSync(q)
    } catch {
      return
    }
    if (st.isFile()) {
      files++
      bytes += st.size
    } else if (st.isDirectory()) for (const n of fs.readdirSync(q)) walk(path.join(q, n))
  }
  walk(p)
  return { files, bytes }
}

export function packageSize(c: PackageChoice): number {
  return planPackage(c).entries.reduce((n, e) => n + treeSize(e.from).bytes, 0)
}

/** Settings files that may hold a login (RetroAchievements, RPCN, web services) — checked line by line (#07). */
const SETTINGS_EXT = new Set(['.ini', '.cfg', '.yml', '.yaml', '.json', '.conf', '.toml', '.xml', '.txt'])
const SECRET_LINE = /^(\s*["']?[\w.\- ]*?(?:token|password|passwd|api_?key|secret|session_?id)[\w.\- ]*?["']?\s*[=:]\s*)(.+?)(\s*,?\s*)$/i

/**
 * A settings file with every login value emptied (key kept, value ""): packages go to friends, logins must not.
 * Quoted values stay quoted (RetroArch: cheevos_token = ""). Returns the text unchanged when there is nothing.
 */
export function scrubSecrets(text: string): string {
  return text
    .split(/(\r?\n)/)
    .map((line) => {
      const m = SECRET_LINE.exec(line)
      if (!m || !m[2].trim()) return line
      const v = m[2].trim()
      const q = /^".*"$/.test(v) ? '""' : /^'.*'$/.test(v) ? "''" : ''
      return `${m[1]}${q}${m[3]}`
    })
    .join('')
}

/** Copy (or hard-link, for a temporary send folder) every entry into `to`. Links are followed. */
async function writeTree(from: string, to: string, link: boolean, onFile: (bytes: number) => void, rel = '', skip?: (rel: string, st: fs.Stats) => boolean): Promise<void> {
  const st = await fsp.stat(from)
  if (st.isDirectory()) {
    await fsp.mkdir(to, { recursive: true })
    for (const n of await fsp.readdir(from)) await writeTree(path.join(from, n), path.join(to, n), link, onFile, rel ? `${rel}/${n}` : n, skip)
    return
  }
  // smart packages: the other PC has it already, or it hasn't changed since the last package there
  if (skip?.(rel, st)) return
  await fsp.mkdir(path.dirname(to), { recursive: true })
  if (SETTINGS_EXT.has(path.extname(from).toLowerCase()) && st.size < 4 * 1024 * 1024) {
    const text = await fsp.readFile(from, 'utf8')
    const clean = scrubSecrets(text)
    if (clean !== text) {
      log.info(`package: logins left out of ${rel}`)
      await fsp.writeFile(to, clean, 'utf8')
      onFile(st.size)
      return
    }
  }
  if (link) {
    try {
      await fsp.link(from, to)
      onFile(st.size)
      return
    } catch {
      /* other drive: copy */
    }
  }
  await fsp.copyFile(from, to)
  onFile(st.size)
}

export async function buildPackage(
  c: PackageChoice,
  folder: string,
  link: boolean,
  progress: (p: PackageProgress) => void,
  have?: Inventory | null
): Promise<string> {
  const { entries, manifest } = planPackage(c)
  const total = entries.reduce((n, e) => n + treeSize(e.from).bytes, 0)
  const since = c.onlyNew && have ? lastSentTo(have.pcId) : undefined
  // profiles always travel whole (the receiver decides merge / replace / keep both)
  const skip = (rel: string, st: fs.Stats) =>
    !rel.startsWith('profiles/') && ((have?.files[rel] !== undefined && have.files[rel] === st.size) || (since !== undefined && st.mtimeMs <= since))
  let done = 0
  let left = 0
  await fsp.mkdir(folder, { recursive: true })
  for (const e of entries) {
    progress({ phase: 'packing', pct: total ? done / total : 0, detail: e.rel })
    await writeTree(e.from, path.join(folder, e.rel), link, (b) => (done += b), e.rel.replace(/\\/g, '/'), (rel, st) => {
      const s = skip(rel, st)
      if (s) {
        left++
        done += st.size
      }
      return s
    })
  }
  writeJson(path.join(folder, 'manifest.json'), { ...manifest, bytes: total, smart: have ? { pcId: have.pcId, left, since: since ? new Date(since).toISOString() : undefined } : undefined })
  progress({ phase: 'packing', pct: 1 })
  log.info(`package built in ${folder} (${Math.round(total / 1e6)} MB, link=${link})`)
  return folder
}

// ---------------- receiving ----------------

export function readManifest(folder: string): PackageManifest | null {
  const m = readJson<PackageManifest | null>(path.join(folder, 'manifest.json'), null)
  return m && m.app === 'Starstation' && m.format === FORMAT ? m : null
}

/** A received download may sit one folder deeper (croc keeps the sent folder's name). */
export function findPackageRoot(d: string): string | null {
  if (readManifest(d)) return d
  for (const n of fs.existsSync(d) ? fs.readdirSync(d) : []) {
    const p = path.join(d, n)
    if (fs.statSync(p).isDirectory() && readManifest(p)) return p
  }
  return null
}

/** Copy files that don't exist yet; existing ones are kept (counted). */
async function addTree(from: string, to: string, stats: { added: number; kept: number }): Promise<void> {
  const st = await fsp.stat(from)
  if (st.isDirectory()) {
    await fsp.mkdir(to, { recursive: true })
    for (const n of await fsp.readdir(from)) await addTree(path.join(from, n), path.join(to, n), stats)
    return
  }
  if (fs.existsSync(to)) {
    stats.kept++
    return
  }
  await fsp.mkdir(path.dirname(to), { recursive: true })
  await fsp.copyFile(from, to)
  await fsp.utimes(to, st.atime, st.mtime)
  stats.added++
}

/** Mods: new mods are added next to mine; owners (placed files) are rebuilt on this PC afterwards. */
async function mergeMods(from: string, stats: { added: number; kept: number }): Promise<string[]> {
  const games: string[] = []
  const walk = async (d: string, depth: number) => {
    for (const n of await fsp.readdir(d)) {
      const p = path.join(d, n)
      if (!(await fsp.stat(p)).isDirectory()) continue
      if (depth === 1) {
        const rel = path.relative(from, p)
        const target = path.join(dir('mods'), rel)
        const theirs = readJson<{ mods: { id: string; enabled: boolean }[]; gamebananaGame?: number } | null>(path.join(p, 'mods.json'), null)
        if (!theirs) continue
        const mine = readJson<{ mods: { id: string; enabled: boolean }[]; owners: Record<string, string>; gamebananaGame?: number }>(path.join(target, 'mods.json'), { mods: [], owners: {} })
        for (const m of theirs.mods) {
          if (mine.mods.some((x) => x.id === m.id)) continue
          await addTree(path.join(p, m.id), path.join(target, m.id), stats)
          // switched on again below, on this PC's paths
          mine.mods.push({ ...m, enabled: false, pendingOn: m.enabled } as typeof m)
        }
        mine.gamebananaGame ??= theirs.gamebananaGame
        writeJson(path.join(target, 'mods.json'), mine)
        games.push(rel)
      } else await walk(p, depth + 1)
    }
  }
  if (fs.existsSync(from)) await walk(from, 0)
  return games
}

/** Profiles in a package whose name already exists here: the user decides first. */
export function profileConflicts(folder: string): string[] {
  const root = findPackageRoot(folder)
  const p = root ? path.join(root, 'profiles') : ''
  if (!p || !fs.existsSync(p)) return []
  return fs.readdirSync(p).filter((n) => profileByName(n))
}

export async function receiveFromFolder(
  folder: string,
  opts: { useSettings: boolean; profiles?: Record<string, ProfileMerge> },
  progress: (p: PackageProgress) => void
): Promise<{ ok: boolean; error?: string; added: number; kept: number; ask?: string[] }> {
  const root = findPackageRoot(folder)
  if (!root) return { ok: false, error: "That folder doesn't contain a Starstation package.", added: 0, kept: 0 }
  const m = readManifest(root)!
  // a profile with the same name is already here: merge, replace or keep both? (asked before anything is unpacked)
  const ask = profileConflicts(root).filter((n) => !opts.profiles?.[n])
  if (ask.length) return { ok: false, added: 0, kept: 0, ask }
  const stats = { added: 0, kept: 0 }
  const step = async (rel: string, label: string, pct: number) => {
    const p = path.join(root, rel)
    if (!fs.existsSync(p)) return
    progress({ phase: 'unpacking', pct, detail: label })
    await addTree(p, path.join(filesDir(), rel), stats)
  }
  await step('emulators', 'Emulators', 0.05)
  await step('bios', 'BIOS', 0.35)
  // custom consoles first so their games folders are known
  if (opts.useSettings || !fs.existsSync(dir('config', 'settings.json'))) {
    for (const f of ['settings.json', 'controllers.json', path.join('library', 'game-options.json'), path.join('library', 'collections.json')]) {
      const p = path.join(root, 'config', f)
      if (fs.existsSync(p)) {
        await fsp.mkdir(path.dirname(dir('config', f)), { recursive: true })
        await fsp.copyFile(p, dir('config', f))
      }
    }
  }
  await step(path.join('config', 'consoles'), 'Consoles', 0.4)
  loadPresets()
  // portable mode + save links for the emulators that arrived, before the saves go in
  for (const c of allConsoles()) if (getEmulator(c.emulator)) applyConsoleConfig(c)
  await step('games', 'Games', 0.45)
  progress({ phase: 'unpacking', pct: 0.85, detail: 'Mods' })
  await mergeMods(path.join(root, 'mods'), stats)
  await step('saves', 'Saves', 0.92)
  await receiveProfiles(path.join(root, 'profiles'), opts.profiles ?? {}, stats)
  writeJson(dir('config', 'imports.json'), [
    ...readJson<unknown[]>(dir('config', 'imports.json'), []),
    { at: new Date().toISOString(), source: `package from ${m.createdAt}`, result: stats }
  ])
  progress({ phase: 'done', pct: 1 })
  log.info(`package received: ${stats.added} added, ${stats.kept} kept`)
  return { ok: true, ...stats }
}

// ---------------- profiles in packages ----------------

type Stats = Record<string, { playTime?: number; playCount?: number; lastPlayed?: number; favorite?: boolean }>

async function receiveProfiles(from: string, choices: Record<string, ProfileMerge>, stats: { added: number; kept: number }): Promise<void> {
  if (!fs.existsSync(from)) return
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name)
    const existing = profileByName(name)
    const how: ProfileMerge = existing ? (choices[name] ?? 'both') : 'both'
    let id = existing?.id
    if (!existing || how === 'both') {
      // a new profile ("Name (2)" when the name is taken)
      let n = name
      for (let i = 2; profileByName(n); i++) n = `${name} (${i})`
      const list = addProfile(n)
      id = list.find((p) => p.name === n)!.id
    }
    const to = profileData(id!)
    const replace = how === 'replace' && !!existing
    if (replace) {
      // the old ones go to the Recycle Bin-like backups folder first, then the package's take their place
      const keep = dir('backups', 'replaced-profiles', `${safeName(name)}-${Date.now()}`)
      for (const p of [to.saves, ...Object.values(to.emu)]) if (fs.existsSync(p)) await fsp.cp(p, path.join(keep, path.basename(p)), { recursive: true })
      for (const p of [to.saves, ...Object.values(to.emu)]) await fsp.rm(p, { recursive: true, force: true })
    }
    const copy = async (a: string, b: string) => {
      if (!fs.existsSync(a)) return
      await fsp.mkdir(path.dirname(b), { recursive: true })
      await addTree(a, b, stats)
    }
    await copy(path.join(src, 'saves'), to.saves)
    for (const [key, target] of Object.entries(to.emu)) await copy(path.join(src, 'emulator-saves', key), target)
    // play time / favorites: replaced, or merged (longer play time, favorite if either)
    const theirs = readJson<Stats>(path.join(src, 'stats.json'), {})
    const mine = replace || !existing ? {} : readJson<Stats>(to.stats, {})
    for (const [g, s] of Object.entries(theirs)) {
      const m = mine[g] ?? {}
      mine[g] = { ...m, ...s, playTime: Math.max(m.playTime ?? 0, s.playTime ?? 0), playCount: Math.max(m.playCount ?? 0, s.playCount ?? 0), lastPlayed: Math.max(m.lastPlayed ?? 0, s.lastPlayed ?? 0) || undefined, favorite: !!(m.favorite || s.favorite) || undefined }
    }
    writeJson(to.stats, mine)
    log.info(`profile "${name}" received (${how}${existing ? '' : ', new'})`)
  }
}

// ---------------- croc ----------------

const WORDS = ['amber', 'arcade', 'beacon', 'breeze', 'cactus', 'canyon', 'comet', 'coral', 'dragon', 'ember', 'falcon', 'forest', 'galaxy', 'harbor', 'island', 'jungle', 'lantern', 'lunar', 'maple', 'meadow', 'nebula', 'ocean', 'orbit', 'pepper', 'pixel', 'planet', 'quartz', 'rocket', 'saturn', 'shadow', 'silver', 'summit', 'thunder', 'tiger', 'timber', 'velvet', 'violet', 'walnut', 'willow', 'zephyr']

export function makeCode(): string {
  const n = crypto.randomInt(1000, 10000)
  const w = () => WORDS[crypto.randomInt(WORDS.length)]
  return `${n}-${w()}-${w()}-${w()}`
}

let running: ChildProcess | null = null
/** Cancel was pressed: the transfer stops for good (receiving used to try again for up to 10 minutes). */
let cancelled = false

function croc(args: string[], onLine: (l: string) => void): Promise<number> {
  const relay = process.env.STARSTATION_CROC_RELAY ? ['--relay', process.env.STARSTATION_CROC_RELAY] : []
  if (cancelled) return Promise.resolve(-1)
  // hidden test runs only ever use a local relay, never the public one
  if (!relay.length && process.env.STARSTATION_HEADLESS === '1') return Promise.resolve(-1)
  return new Promise((resolve, reject) => {
    const p = spawn(path.join(binDir(), 'croc.exe'), ['--yes', '--disable-clipboard', ...relay, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    running = p
    const feed = (d: Buffer) => d.toString().split(/[\r\n]+/).forEach((l) => l.trim() && onLine(l.trim()))
    p.stdout.on('data', feed)
    p.stderr.on('data', feed)
    p.once('error', reject)
    p.once('exit', (code) => {
      if (running === p) running = null
      resolve(code ?? -1)
    })
  })
}

/** "2/5 file.bin 45% |███  | (…)" → overall share of the transfer. */
export function crocProgress(line: string): number | null {
  const m = /(?:(\d+)\/(\d+)\s+.*?)?(\d{1,3})%\s*\|/.exec(line)
  if (!m) return null
  const pct = Number(m[3]) / 100
  if (!m[1]) return pct
  return (Number(m[1]) - 1 + pct) / Number(m[2])
}

export function cancelTransfer(): void {
  cancelled = true
  running?.kill()
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Sender: the receiver's inventory arrives first under "<code>-have" (an older Starstation doesn't send one). */
async function receiveInventory(code: string, waitMs: number): Promise<Inventory | null> {
  const out = dir('config', 'packages', `have-${Date.now()}`)
  await fsp.mkdir(out, { recursive: true })
  const until = Date.now() + waitMs
  try {
    while (Date.now() < until) {
      const exit = await croc(['--overwrite', '--out', out, `${code}-have`], () => undefined)
      const f = path.join(out, 'inventory.json')
      if (exit === 0 && fs.existsSync(f)) return readJson<Inventory | null>(f, null)
      await sleep(2000)
    }
    return null
  } finally {
    await fsp.rm(out, { recursive: true, force: true })
  }
}

/** Receiver: tell the sender what is here (gives up after a while: an older sender doesn't ask). */
async function sendInventory(code: string, waitMs: number): Promise<void> {
  const d = dir('config', 'packages', `inv-${Date.now()}`)
  await fsp.mkdir(d, { recursive: true })
  const f = path.join(d, 'inventory.json')
  writeJson(f, inventory())
  // stops only this croc (not a Cancel: receiving goes on afterwards)
  const t = setTimeout(() => running?.kill(), waitMs)
  try {
    await croc(['send', '--code', `${code}-have`, f], () => undefined)
  } finally {
    clearTimeout(t)
    await fsp.rm(d, { recursive: true, force: true })
  }
}

/** Hidden test runs only transfer through a local relay (never the public one, never waiting minutes). */
const sealed = () => process.env.STARSTATION_HEADLESS === '1' && !process.env.STARSTATION_CROC_RELAY

export async function sendByCode(c: PackageChoice, onCode: (code: string) => void, progress: (p: PackageProgress) => void): Promise<{ ok: boolean; error?: string }> {
  if (sealed()) return { ok: false, error: 'No transfers in hidden test runs.' }
  const stage = dir('config', 'packages', `send-${Date.now()}`)
  const folder = path.join(stage, `Starstation package ${new Date().toISOString().slice(0, 10)}`)
  cancelled = false
  try {
    const code = makeCode()
    onCode(code)
    progress({ phase: 'waiting', pct: 0, code })
    // smart package: what does the other PC have already?
    const have = await receiveInventory(code, Number(process.env.STARSTATION_INVENTORY_WAIT ?? 60_000))
    await buildPackage(c, folder, true, progress, have)
    progress({ phase: 'waiting', pct: 0, code })
    const exit = await croc(['send', '--code', code, folder], (l) => {
      const pct = crocProgress(l)
      if (pct !== null) progress({ phase: 'sending', pct, code })
    })
    if (cancelled) return { ok: false, error: 'Cancelled.' }
    if (exit !== 0) return { ok: false, error: 'The transfer stopped. Start it again — croc continues where it left off.' }
    if (have) noteSent(have.pcId)
    progress({ phase: 'done', pct: 1, code })
    return { ok: true }
  } finally {
    await fsp.rm(stage, { recursive: true, force: true })
  }
}

export async function receiveByCode(
  code: string,
  opts: { useSettings: boolean },
  progress: (p: PackageProgress) => void
): Promise<{ ok: boolean; error?: string; added?: number; kept?: number; ask?: string[]; folder?: string }> {
  const clean = code.trim().toLowerCase().replace(/\s+/g, '-')
  if (clean.length < 6) return { ok: false, error: 'The code is too short.' }
  if (sealed()) return { ok: false, error: 'No transfers in hidden test runs.' }
  cancelled = false
  // download into Files\config\packages (same drive: no extra copy later), keep it until it's unpacked
  const out = dir('config', 'packages', `receive-${clean.replace(/[^\w-]/g, '')}`)
  await fsp.mkdir(out, { recursive: true })
  // smart package: first tell the sender what is here, then take only the rest
  progress({ phase: 'receiving', pct: 0, detail: 'Telling the other PC what is here…' })
  await sendInventory(clean, Number(process.env.STARSTATION_INVENTORY_WAIT ?? 60_000))
  progress({ phase: 'receiving', pct: 0 })
  // the sender packs after it got the list: try again until it is ready (up to 10 minutes)
  let exit = -1
  const until = Date.now() + 10 * 60_000
  while (Date.now() < until && !cancelled) {
    exit = await croc(['--overwrite', '--out', out, clean], (l) => {
      const pct = crocProgress(l)
      if (pct !== null) progress({ phase: 'receiving', pct })
    })
    if (exit === 0 && findPackageRoot(out)) break
    await sleep(2000)
  }
  if (cancelled) {
    await fsp.rm(out, { recursive: true, force: true })
    return { ok: false, error: 'Cancelled.' }
  }
  if (exit !== 0) return { ok: false, error: 'Nothing received. Check the code, and that the other PC is still sending.' }
  const r = await receiveFromFolder(out, opts, progress)
  if (r.ok) await fsp.rm(out, { recursive: true, force: true })
  // profiles to decide about: the download stays until the answer comes (packageFinish)
  return r.ask ? { ...r, folder: out } : r
}
