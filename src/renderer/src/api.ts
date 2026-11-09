import type { StarstationApi } from '../../shared/types'

declare global {
  interface Window {
    starstation: StarstationApi
  }
}

const raw: StarstationApi = window.starstation

/** A request that failed answers with an empty result: its screen shows "nothing" instead of "Loading…" for ever
 *  (the failure itself is written to Starstation's log by the main process). */
const or = <T>(p: Promise<T>, empty: T): Promise<T> => timed(p).catch(() => empty)

/** #35 a request that never answers (the main process stuck on a slow drive) fails after a while instead. */
export function timed<T>(p: Promise<T>, ms = 20_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('No answer')), ms)
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e))
    )
  })
}

export const api: StarstationApi = raw
  ? {
      ...raw,
      emulators: () => or(raw.emulators(), []),
      raStatus: () => or(raw.raStatus(), { loggedIn: false, hasPassword: false, hasApiKey: false }),
      steamStatus: () => or(raw.steamStatus(), { found: false, added: false, running: false }),
      sysAudio: () => or(raw.sysAudio(), []),
      sysDisplay: () => or(raw.sysDisplay(), []),
      licenses: () => or(raw.licenses(), []),
      gameDetails: (id) => timed(raw.gameDetails(id)),
      mods: (id) => timed(raw.mods(id))
    }
  : raw
