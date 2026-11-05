import fsp from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { dir, filesDir } from './paths'
import { allConsoles, emulatorDir, getEmulator } from './presets'
import type { StorageInfo } from '../shared/types'

/** Settings → Storage (SPEC-v2 D): disk use per console — games, saves, mods, pictures, emulator. */

async function size(p: string): Promise<number> {
  let st: fs.Stats
  try {
    st = await fsp.lstat(p)
  } catch {
    return 0
  }
  // links (saves pointing into an emulator, test folders) are not counted twice
  if (st.isSymbolicLink()) return 0
  if (!st.isDirectory()) return st.size
  let total = 0
  let ents: fs.Dirent[] = []
  try {
    ents = await fsp.readdir(p, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of ents) total += await size(path.join(p, e.name))
  return total
}

let cache: { at: number; info: StorageInfo } | null = null

export async function storageInfo(fresh = false): Promise<StorageInfo> {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.info
  const consoles: StorageInfo['consoles'] = []
  const emuSeen = new Set<string>()
  for (const c of allConsoles()) {
    const e = getEmulator(c.emulator)
    const games = await size(dir('games', c.id))
    const saves = await size(dir('saves', c.id))
    const mods = await size(dir('mods', c.id))
    const media = (await size(dir('media', 'artwork', c.id))) + (await size(dir('media', 'screenshots', c.id)))
    // an emulator shared by several consoles (Dolphin, RetroArch) counts once, at its first console
    const emulator = e && !path.isAbsolute(e.folder) && !emuSeen.has(e.id) ? await size(emulatorDir(e)) : 0
    if (e) emuSeen.add(e.id)
    if (games + saves + mods + media + emulator === 0) continue
    consoles.push({ id: c.id, name: c.name, short: c.short, games, saves, mods, media, emulator })
  }
  consoles.sort((a, b) => b.games + b.saves + b.emulator - (a.games + a.saves + a.emulator))
  let free = 0
  let total = 0
  try {
    const s = fs.statfsSync(filesDir())
    free = s.bavail * s.bsize
    total = s.blocks * s.bsize
  } catch {
    /* not available */
  }
  const info: StorageInfo = { consoles, backups: await size(dir('backups')), free, total }
  cache = { at: Date.now(), info }
  return info
}
