import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { dir, setSavesRoot } from './paths'
import { readJson, writeJson } from './store'
import { allConsoles, emulatorDir, fill, getEmulator, vars } from './presets'
import { logger } from './log'
import { renameRetry } from './fsutil'
import type { ProfileInfo } from '../shared/types'

/**
 * Profiles (SPEC-v2 G): like the PS3's users. Each profile has its own saves, play time,
 * favorites and recently played. The first profile ("main") is the setup as it was: its files stay where
 * they always were. Other profiles keep theirs in Files\profiles\<id>.
 *
 * Saves the emulators write through a path Starstation gives them (RetroArch, DuckStation, PCSX2) simply
 * follow the active profile's saves folder. Saves that live inside an emulator (Dolphin, Azahar, RPCS3,
 * Xenia) and the Xbox hard-disk image are swapped when the profile changes: the active profile's copy is
 * the one in the emulator, the others wait in their profile folder. Every swap is written to a journal
 * first, so a switch cut off half-way is finished on the next start; before the very first swap, all of
 * them are copied into backups\before-profiles.
 *
 * Guest: a built-in profile that starts empty and is cleared when the guest session ends.
 */

const log = logger('profiles')
const file = () => dir('config', 'profiles.json')
const journalFile = () => dir('config', 'profiles-switch.json')

interface Profile {
  id: string
  name: string
  icon: string
  /** The user's own picture (Files\media\profiles\…). */
  image?: string
  pinHash?: string
  createdAt: number
}
interface Store {
  list: Profile[]
  /** The first profile: the setup as it was before profiles. */
  main: string
  active: string
}

export const GUEST = 'guest'

function load(): Store {
  const s = readJson<Store | null>(file(), null)
  if (Array.isArray(s?.list) && s.list.length && s.list.every((p) => p && typeof p.id === 'string' && typeof p.name === 'string')) {
    // main / active must name a profile that exists (the active one may also be the guest)
    if (!s.list.some((p) => p.id === s.main)) s.main = s.list[0].id
    if (s.active !== GUEST && !s.list.some((p) => p.id === s.active)) s.active = s.main
    return s
  }
  // first v2 start: the existing setup becomes the main profile
  const main: Profile = { id: 'p1', name: 'Player 1', icon: 'p-star', createdAt: Date.now() }
  const fresh = { list: [main], main: main.id, active: main.id }
  writeJson(file(), fresh)
  return fresh
}
const save = (s: Store) => writeJson(file(), s)

/** Where a profile's own files live (the main profile: the old places). */
export function profileRoot(id: string): string | null {
  return id === load().main ? null : dir('config', 'profiles', id)
}

export function activeProfile(): string {
  return load().active
}

/** Paths that differ per profile: called at start and after every switch. */
export function applyProfilePaths(): void {
  const s = load()
  const root = profileRoot(s.active)
  setSavesRoot(root ? path.join(root, 'saves') : null)
}

/** Files of the active profile (stats…): main → the old file, others → their folder. */
export function profileFile(mainPath: string, name: string): string {
  const root = profileRoot(load().active)
  return root ? path.join(root, name) : mainPath
}

const hash = (pin: string, salt = crypto.randomBytes(8).toString('hex')) => `${salt}:${crypto.scryptSync(pin, salt, 32).toString('hex')}`
function pinOk(p: Profile, pin: string): boolean {
  if (!p.pinHash) return true
  const [salt] = p.pinHash.split(':')
  return crypto.timingSafeEqual(Buffer.from(hash(pin, salt)), Buffer.from(p.pinHash))
}

export function listProfiles(): ProfileInfo[] {
  const s = load()
  const guest: ProfileInfo = { id: GUEST, name: 'Guest', icon: 'guest', hasPin: false, main: false, guest: true, active: s.active === GUEST }
  return [...s.list.map((p) => ({ id: p.id, name: p.name, icon: p.icon, image: p.image, hasPin: !!p.pinHash, main: p.id === s.main, guest: false, active: p.id === s.active })), guest]
}

export function addProfile(name: string, icon = 'p-planet'): ProfileInfo[] {
  const s = load()
  const clean = name.trim().slice(0, 20) || `Player ${s.list.length + 1}`
  let n = s.list.length + 1
  while (s.list.some((p) => p.id === `p${n}`)) n++
  s.list.push({ id: `p${n}`, name: clean, icon, createdAt: Date.now() })
  save(s)
  return listProfiles()
}

export function updateProfile(id: string, change: { name?: string; icon?: string; image?: string | null }): ProfileInfo[] {
  const s = load()
  const p = s.list.find((x) => x.id === id)
  if (!p) return listProfiles()
  if (change.name) p.name = change.name.trim().slice(0, 20) || p.name
  if (change.icon) {
    p.icon = change.icon
    p.image = undefined
  }
  if (change.image !== undefined) p.image = change.image ?? undefined
  save(s)
  return listProfiles()
}

/** Set or remove a PIN. Changing a PIN needs the old one — except the main profile may reset anyone's. */
export function setPin(id: string, pin: string | null, oldPin?: string, asMain = false): { ok: boolean; error?: string } {
  const s = load()
  const p = s.list.find((x) => x.id === id)
  if (!p) return { ok: false, error: 'Profile not found.' }
  if (pin !== null && !/^\d{4}$/.test(pin)) return { ok: false, error: 'A PIN is 4 digits.' }
  const mainResets = asMain && s.active === s.main && id !== s.main
  if (p.pinHash && !mainResets && !pinOk(p, oldPin ?? '')) return { ok: false, error: 'The old PIN is wrong.' }
  p.pinHash = pin === null ? undefined : hash(pin)
  save(s)
  return { ok: true }
}

// ---------------- saves inside emulators ----------------

interface Spot {
  /** Stable name for the profile's copy. */
  key: string
  /** Where the emulator keeps it. */
  live: string
}

/** Save folders / files that live inside emulators (from the presets' save links) + the Xbox hard disk. */
function emulatorSaveSpots(): Spot[] {
  const spots: Spot[] = []
  for (const c of allConsoles()) {
    const e = getEmulator(c.emulator)
    if (!e) continue
    const v = vars(c)
    for (const st of c.config) {
      if (st.type !== 'link' || !st.path.startsWith('{saves}')) continue
      const live = fill(st.target, v)
      if (!live.toLowerCase().startsWith(emulatorDir(e).toLowerCase())) continue
      spots.push({ key: `${c.id}-${path.basename(st.path)}`, live })
    }
  }
  const hdd = dir('bios', 'xbox', 'xbox_hdd.qcow2')
  spots.push({ key: 'xbox-hdd.qcow2', live: hdd })
  // same folder from two consoles (Dolphin GC/Wii have their own): once each
  return spots.filter((s, i) => spots.findIndex((t) => t.live.toLowerCase() === s.live.toLowerCase()) === i)
}

const store = (profile: string, key: string) => dir('config', 'profiles', profile, 'emulator-saves', key)

interface Journal {
  from: string
  to: string
  /** hadLive / hadIn: what existed when the switch began (#04), so a resumed switch knows what each move was. */
  steps: { live: string; out: string; in: string; done: boolean; hadLive?: boolean; hadIn?: boolean }[]
}

async function backupBeforeFirstSwap(spots: Spot[]): Promise<void> {
  const b = dir('backups', 'before-profiles')
  if (fs.existsSync(path.join(b, 'done.json'))) return
  for (const s of spots) if (fs.existsSync(s.live)) await fsp.cp(s.live, path.join(b, s.key), { recursive: true, force: false, errorOnExist: false })
  writeJson(path.join(b, 'done.json'), { at: new Date().toISOString(), spots })
  log.info(`emulator saves backed up to ${b} before the first profile switch`)
}

/**
 * Do (or finish) the swaps written in the journal. Each step is noted as done right after it. The journal stays
 * until the caller has saved the new profile as active (#03): a crash in between finishes the switch at the next
 * start instead of leaving the old profile active on the new one's saves.
 */
async function runJournal(j: Journal): Promise<void> {
  for (const st of j.steps) {
    if (st.done) continue
    const old = st.hadLive === undefined // journal from before 2.1.0: the old rules
    // 1. the outgoing profile's saves leave the emulator (if they haven't already)
    if ((old || st.hadLive) && fs.existsSync(st.live)) {
      if (fs.existsSync(st.out)) {
        if (!old) throw new Error(`both ${st.live} and ${st.out} exist: not moving either`)
      } else {
        await fsp.mkdir(path.dirname(st.out), { recursive: true })
        await renameRetry(st.live, st.out)
      }
    }
    // 2. the incoming profile's saves move in (or the place stays empty: the emulator starts fresh)
    if ((old || st.hadIn) && fs.existsSync(st.in) && !fs.existsSync(st.live)) {
      await fsp.mkdir(path.dirname(st.live), { recursive: true })
      await renameRetry(st.in, st.live)
    }
    st.done = true
    writeJson(journalFile(), j)
  }
}

/**
 * Before a switch: a copy left in the outgoing profile's store (an older switch that went wrong) would stop its
 * live saves from moving out. It is put aside under a dated name — never deleted, never mixed in.
 */
async function planSteps(from: string, to: string, spots: Spot[]): Promise<Journal> {
  const steps: Journal['steps'] = []
  for (const sp of spots) {
    const live = sp.live
    const out = store(from, sp.key)
    const inn = store(to, sp.key)
    const hadLive = fs.existsSync(live)
    if (hadLive && fs.existsSync(out)) {
      const aside = `${out}.leftover-${Date.now()}`
      log.warn(`profile switch: ${out} was already there; kept as ${aside}`)
      await renameRetry(out, aside)
    }
    steps.push({ live, out, in: inn, done: false, hadLive, hadIn: fs.existsSync(inn) })
  }
  return { from, to, steps }
}

/** A switch was cut off half-way and isn't finished yet: no game may start (it would play on mixed saves). */
export function switchPending(): boolean {
  return fs.existsSync(journalFile())
}

/** A switch cut off half-way (crash, power cut) is finished first thing at start. */
export async function finishInterruptedSwitch(): Promise<void> {
  const j = readJson<Journal | null>(journalFile(), null)
  if (!j) return
  log.warn(`finishing an interrupted profile switch ${j.from} → ${j.to}`)
  await runJournal(j)
  const s = load()
  s.active = j.to
  save(s)
  fs.rmSync(journalFile(), { force: true })
}

/** A switch is moving save folders right now: a second one (a double press) must not move them at the same time. */
let switching = false

/** Switch profile (no game may run). Checks the PIN; Guest is cleared when its session ends. */
export async function switchProfile(id: string, pin?: string): Promise<{ ok: boolean; error?: string; busy?: boolean }> {
  if (switching) return { ok: false, error: 'A profile switch is already on its way.', busy: true }
  switching = true
  try {
    return await switchNow(id, pin)
  } finally {
    switching = false
  }
}

async function switchNow(id: string, pin?: string): Promise<{ ok: boolean; error?: string }> {
  const s = load()
  if (id === s.active) return { ok: true }
  const target = id === GUEST ? null : s.list.find((p) => p.id === id)
  if (id !== GUEST && !target) return { ok: false, error: 'Profile not found.' }
  if (target?.pinHash && !pinOk(target, pin ?? '')) return { ok: false, error: 'Wrong PIN.' }
  const spots = emulatorSaveSpots()
  await backupBeforeFirstSwap(spots)
  const j = await planSteps(s.active, id, spots)
  writeJson(journalFile(), j)
  try {
    await runJournal(j)
  } catch (e) {
    // a save folder is held by another program: try once more, else the next start finishes it
    log.warn('profile switch: a save folder could not be moved, trying again', e)
    await new Promise((r) => setTimeout(r, 2000))
    try {
      await runJournal(j)
    } catch (e2) {
      log.error('profile switch stopped half-way; it is finished at the next start', e2)
      return { ok: false, error: 'A save folder is in use by another program. Close Starstation and start it again: the switch is finished then.' }
    }
  }
  const leaving = s.active
  s.active = id
  save(s)
  fs.rmSync(journalFile(), { force: true }) // only now: the new profile is saved as active
  if (leaving === GUEST) await clearGuest()
  applyProfilePaths()
  log.info(`profile ${leaving} → ${id}`)
  return { ok: true }
}

/** The guest session ended: everything the guest did goes. */
export async function clearGuest(): Promise<void> {
  if (load().active === GUEST) return
  await fsp.rm(dir('config', 'profiles', GUEST), { recursive: true, force: true })
  log.info('guest cleared')
}

/** Delete a profile (not the main one, not the active one). Its saves go to the Recycle Bin. */
export async function deleteProfile(id: string, trash: (p: string) => Promise<void>): Promise<{ ok: boolean; error?: string }> {
  const s = load()
  if (id === s.main) return { ok: false, error: 'The first profile can’t be deleted.' }
  if (id === s.active) return { ok: false, error: 'Switch to another profile first.' }
  const p = dir('config', 'profiles', id)
  if (fs.existsSync(p)) await trash(p)
  s.list = s.list.filter((x) => x.id !== id)
  save(s)
  return { ok: true }
}

/** For the package code: a profile's folder (null = main, whose files are in the usual places). */
export function profileFolder(id: string): string | null {
  return profileRoot(id)
}

/**
 * Where a profile's things are right now (packages send and receive profiles): play time + favorites,
 * its saves folder, and its saves inside emulators (live in the emulator while it is the active one).
 */
export function profileData(id: string): { stats: string; saves: string; emu: Record<string, string> } {
  const s = load()
  const root = profileRoot(id)
  const emu: Record<string, string> = {}
  for (const sp of emulatorSaveSpots()) emu[sp.key] = id === s.active ? sp.live : store(id, sp.key)
  return {
    stats: root ? path.join(root, 'stats.json') : dir('config', 'library', 'stats.json'),
    // the main profile's saves are Files\saves (dir('saves') follows the active profile, so not that)
    saves: root ? path.join(root, 'saves') : path.join(path.dirname(dir('config')), 'saves'),
    emu
  }
}

export function profileByName(name: string): ProfileInfo | undefined {
  return listProfiles().find((p) => !p.guest && p.name.toLowerCase() === name.trim().toLowerCase())
}
