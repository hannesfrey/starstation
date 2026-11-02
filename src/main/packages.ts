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
import type { PackageChoice, PackageManifest, PackageProgress } from '../shared/types'

/**
 * Packages copy a whole setup to another PC: emulators, BIOS, games, mods, settings, saves (optional).
 * Sent by code with croc (encrypted, resumable) or saved to a folder. Receiving adds what's new and never
 * deletes or overwrites anything that is already there.
 * Never included: favorites, play time, recently played (stats.json), logins (secrets.json), logs, caches.
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

/** Copy (or hard-link, for a temporary send folder) every entry into `to`. Links are followed. */
async function writeTree(from: string, to: string, link: boolean, onFile: (bytes: number) => void): Promise<void> {
  const st = await fsp.stat(from)
  if (st.isDirectory()) {
    await fsp.mkdir(to, { recursive: true })
    for (const n of await fsp.readdir(from)) await writeTree(path.join(from, n), path.join(to, n), link, onFile)
    return
  }
  await fsp.mkdir(path.dirname(to), { recursive: true })
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

export async function buildPackage(c: PackageChoice, folder: string, link: boolean, progress: (p: PackageProgress) => void): Promise<string> {
  const { entries, manifest } = planPackage(c)
  const total = entries.reduce((n, e) => n + treeSize(e.from).bytes, 0)
  let done = 0
  await fsp.mkdir(folder, { recursive: true })
  for (const e of entries) {
    progress({ phase: 'packing', pct: total ? done / total : 0, detail: e.rel })
    await writeTree(e.from, path.join(folder, e.rel), link, (b) => (done += b))
  }
  writeJson(path.join(folder, 'manifest.json'), { ...manifest, bytes: total })
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

export async function receiveFromFolder(
  folder: string,
  opts: { useSettings: boolean },
  progress: (p: PackageProgress) => void
): Promise<{ ok: boolean; error?: string; added: number; kept: number }> {
  const root = findPackageRoot(folder)
  if (!root) return { ok: false, error: "That folder doesn't contain a Starstation package.", added: 0, kept: 0 }
  const m = readManifest(root)!
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
  writeJson(dir('config', 'imports.json'), [
    ...readJson<unknown[]>(dir('config', 'imports.json'), []),
    { at: new Date().toISOString(), source: `package from ${m.createdAt}`, result: stats }
  ])
  progress({ phase: 'done', pct: 1 })
  log.info(`package received: ${stats.added} added, ${stats.kept} kept`)
  return { ok: true, ...stats }
}

// ---------------- croc ----------------

const WORDS = ['amber', 'arcade', 'beacon', 'breeze', 'cactus', 'canyon', 'comet', 'coral', 'dragon', 'ember', 'falcon', 'forest', 'galaxy', 'harbor', 'island', 'jungle', 'lantern', 'lunar', 'maple', 'meadow', 'nebula', 'ocean', 'orbit', 'pepper', 'pixel', 'planet', 'quartz', 'rocket', 'saturn', 'shadow', 'silver', 'summit', 'thunder', 'tiger', 'timber', 'velvet', 'violet', 'walnut', 'willow', 'zephyr']

export function makeCode(): string {
  const n = crypto.randomInt(1000, 10000)
  const w = () => WORDS[crypto.randomInt(WORDS.length)]
  return `${n}-${w()}-${w()}-${w()}`
}

let running: ChildProcess | null = null

function croc(args: string[], onLine: (l: string) => void): Promise<number> {
  const relay = process.env.STARSTATION_CROC_RELAY ? ['--relay', process.env.STARSTATION_CROC_RELAY] : []
  return new Promise((resolve, reject) => {
    const p = spawn(path.join(binDir(), 'croc.exe'), ['--yes', '--disable-clipboard', ...relay, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    running = p
    const feed = (d: Buffer) => d.toString().split(/[\r\n]+/).forEach((l) => l.trim() && onLine(l.trim()))
    p.stdout.on('data', feed)
    p.stderr.on('data', feed)
    p.once('error', reject)
    p.once('exit', (code) => {
      running = null
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
  running?.kill()
}

export async function sendByCode(c: PackageChoice, onCode: (code: string) => void, progress: (p: PackageProgress) => void): Promise<{ ok: boolean; error?: string }> {
  const stage = dir('config', 'packages', `send-${Date.now()}`)
  const folder = path.join(stage, `Starstation package ${new Date().toISOString().slice(0, 10)}`)
  try {
    await buildPackage(c, folder, true, progress)
    const code = makeCode()
    onCode(code)
    progress({ phase: 'waiting', pct: 0, code })
    const exit = await croc(['send', '--code', code, folder], (l) => {
      const pct = crocProgress(l)
      if (pct !== null) progress({ phase: 'sending', pct, code })
    })
    if (exit !== 0) return { ok: false, error: 'The transfer stopped. Start it again — croc continues where it left off.' }
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
): Promise<{ ok: boolean; error?: string; added?: number; kept?: number }> {
  const clean = code.trim().toLowerCase().replace(/\s+/g, '-')
  if (clean.length < 6) return { ok: false, error: 'The code is too short.' }
  // download into Files\config\packages (same drive: no extra copy later), keep it until it's unpacked
  const out = dir('config', 'packages', `receive-${clean.replace(/[^\w-]/g, '')}`)
  await fsp.mkdir(out, { recursive: true })
  progress({ phase: 'receiving', pct: 0 })
  const exit = await croc(['--overwrite', '--out', out, clean], (l) => {
    const pct = crocProgress(l)
    if (pct !== null) progress({ phase: 'receiving', pct })
  })
  if (exit !== 0) return { ok: false, error: 'Nothing received. Check the code, and that the other PC is still sending.' }
  const r = await receiveFromFolder(out, opts, progress)
  if (r.ok) await fsp.rm(out, { recursive: true, force: true })
  return r
}
