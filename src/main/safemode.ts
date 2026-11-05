import { dir } from './paths'
import { readJson, writeJson } from './store'
import { inSafeMode, setSafeFlag } from './safeflag'
import { listMods, setModEnabled } from './mods'
import { getGame } from './library/library'
import { logger } from './log'
import type { Game } from '../shared/types'

/**
 * Safe mode (SPEC-v2 G): Starstation without mods, themes and custom settings.
 * - settings: defaults, changes stay in memory (settings.ts)
 * - per-game options: defaults (gameoptions.ts)
 * - mods: a game's mods are switched off right before it starts in safe mode and noted in
 *   config\safe-mode.json; leaving safe mode (or the next normal start, after a crash) switches them on again.
 */

const log = logger('safemode')
const file = () => dir('config', 'safe-mode.json')
type State = { suspended: Record<string, string[]> }

export { inSafeMode }

export function enterSafeMode(): void {
  if (inSafeMode()) return
  setSafeFlag(true)
  log.info('safe mode on')
}

/** Back to normal: settings come back by themselves, mods are switched on again. */
export async function leaveSafeMode(): Promise<number> {
  setSafeFlag(false)
  const n = await restoreSuspended()
  log.info(`safe mode off (${n} mod(s) back on)`)
  return n
}

/** Before a game starts in safe mode: switch its mods off for now. */
export async function suspendModsFor(g: Game): Promise<void> {
  if (!inSafeMode()) return
  const on = listMods(g).filter((m) => m.enabled)
  if (!on.length) return
  const st = readJson<State>(file(), { suspended: {} })
  const ids = new Set(st.suspended[g.id] ?? [])
  for (const m of on) {
    const r = await setModEnabled(g, m.id, false)
    if (r.ok) ids.add(m.id)
  }
  st.suspended[g.id] = [...ids]
  writeJson(file(), st) // written before the game starts, so a crash can't lose it
  log.info(`${g.id}: ${on.length} mod(s) set aside for safe mode`)
}

/** Switch every mod that safe mode set aside on again. Called when leaving safe mode and at every normal start. */
export async function restoreSuspended(): Promise<number> {
  const st = readJson<State>(file(), { suspended: {} })
  let n = 0
  for (const [gameId, ids] of Object.entries(st.suspended)) {
    const g = getGame(gameId)
    if (!g) continue
    for (const id of ids) if ((await setModEnabled(g, id, true, 'other')).ok) n++
  }
  writeJson(file(), { suspended: {} })
  return n
}
