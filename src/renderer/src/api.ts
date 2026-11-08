import type { StarstationApi } from '../../shared/types'

declare global {
  interface Window {
    starstation: StarstationApi
  }
}

const raw: StarstationApi = window.starstation

/** A request that failed answers with an empty result: its screen shows "nothing" instead of "Loading…" for ever
 *  (the failure itself is written to Starstation's log by the main process). */
const or = <T>(p: Promise<T>, empty: T): Promise<T> => p.catch(() => empty)

export const api: StarstationApi = raw
  ? {
      ...raw,
      emulators: () => or(raw.emulators(), []),
      raStatus: () => or(raw.raStatus(), { loggedIn: false, hasPassword: false, hasApiKey: false }),
      steamStatus: () => or(raw.steamStatus(), { found: false, added: false, running: false }),
      sysAudio: () => or(raw.sysAudio(), []),
      sysDisplay: () => or(raw.sysDisplay(), []),
      licenses: () => or(raw.licenses(), [])
    }
  : raw
