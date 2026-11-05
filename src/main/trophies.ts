import { dir } from './paths'
import { readJson, writeJson } from './store'
import { allConsoles } from './presets'
import { view } from './library/library'
import type { Trophy } from '../shared/types'

/**
 * Starstation's own trophies (SPEC-v2 C): bronze / silver / gold, and a platinum for unlocking all the others.
 * Worked out from play time, the library and a few first-times (first mod, first netplay session).
 * Unlocks are kept in config\trophies.json (per profile from step 7 on).
 */

interface State {
  unlocked: Record<string, number>
  firsts: Partial<Record<'mod' | 'netplay', number>>
}

let fileFn = () => dir('config', 'trophies.json')
/** Profiles (step 7) keep their own trophies: the file can be pointed elsewhere. */
export function setTrophyFile(fn: () => string): void {
  fileFn = fn
}
const load = () => readJson<State>(fileFn(), { unlocked: {}, firsts: {} })

/** A first-time event (first mod installed, first netplay session). */
export function noteFirst(what: 'mod' | 'netplay'): void {
  const st = load()
  if (st.firsts[what]) return
  st.firsts[what] = Date.now()
  writeJson(fileFn(), st)
}

type Def = Omit<Trophy, 'unlockedAt'> & { done: boolean }

function definitions(st: State): Def[] {
  const lib = view()
  const stats = lib.stats
  const hours = Object.values(stats).reduce((n, s) => n + (s.playTime ?? 0), 0) / 3600
  const played = lib.games.filter((g) => (stats[g.id]?.playCount ?? 0) > 0)
  const consolesWithGames = allConsoles().filter((c) => lib.games.some((g) => g.console === c.id))
  const defs: Def[] = []
  const time = (id: string, name: string, h: number, tier: Trophy['tier']) =>
    defs.push({ id, name, description: `Play for ${h} hours in total.`, tier, done: hours >= h, progress: [Math.min(h, Math.floor(hours)), h] })
  time('time-10', 'Settling in', 10, 'bronze')
  time('time-50', 'Regular', 50, 'silver')
  time('time-100', 'Devoted', 100, 'gold')
  time('time-500', 'Lifetime', 500, 'gold')
  // per console with games: three different games played
  for (const c of consolesWithGames) {
    const n = played.filter((g) => g.console === c.id).length
    defs.push({ id: `console-${c.id}`, name: `${c.short} explorer`, description: `Play 3 different ${c.short} games.`, tier: 'bronze', done: n >= 3, progress: [Math.min(3, n), 3] })
  }
  defs.push({ id: 'first-mod', name: 'Tinkerer', description: 'Install your first mod.', tier: 'bronze', done: !!st.firsts.mod })
  defs.push({ id: 'first-netplay', name: 'Together', description: 'Play your first netplay session.', tier: 'silver', done: !!st.firsts.netplay })
  if (consolesWithGames.length >= 2) {
    const tried = consolesWithGames.filter((c) => played.some((g) => g.console === c.id)).length
    defs.push({ id: 'all-consoles', name: 'World tour', description: 'Play every console you have games for at least once.', tier: 'gold', done: tried === consolesWithGames.length, progress: [tried, consolesWithGames.length] })
  }
  defs.push({ id: 'collector-50', name: 'Collector', description: 'Have 50 games in your library.', tier: 'silver', done: lib.games.length >= 50, progress: [Math.min(50, lib.games.length), 50] })
  defs.push({ id: 'collector-200', name: 'Archivist', description: 'Have 200 games in your library.', tier: 'gold', done: lib.games.length >= 200, progress: [Math.min(200, lib.games.length), 200] })
  // platinum: every other trophy above (the ones this library can have)
  const others = defs.length
  const got = defs.filter((d) => d.done || st.unlocked[d.id]).length
  defs.push({ id: 'platinum', name: 'Starstation Platinum', description: 'Unlock every other Starstation trophy.', tier: 'platinum', done: got === others, progress: [got, others] })
  return defs
}

/** All trophies with their state. Newly earned ones are stored (an unlocked trophy stays unlocked). */
export function trophies(): { list: Trophy[]; fresh: Trophy[] } {
  const st = load()
  const fresh: Trophy[] = []
  const list = definitions(st).map(({ done, ...t }) => {
    if (done && !st.unlocked[t.id]) {
      st.unlocked[t.id] = Date.now()
      fresh.push({ ...t, unlockedAt: st.unlocked[t.id] })
    }
    return { ...t, unlockedAt: st.unlocked[t.id] }
  })
  if (fresh.length) writeJson(fileFn(), st)
  return { list, fresh }
}
