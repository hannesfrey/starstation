import { dir } from './paths'
import { readJson, writeJson } from './store'

/**
 * Did Starstation close normally last time? Every start writes a "running" note; a normal close
 * (or Windows shutting down) marks it clean. A start that finds an unclean note counts as a crash.
 * Used for: offering safe mode after a crash, and the automatic rescue after a bad update (updater.ts).
 */

interface SessionFile {
  last?: { version: string; startedAt: number; clean: boolean }
  /** Unclean ends in a row (0 after any normal close). */
  crashesInARow: number
  /** Normal closes per version. A version with none has never worked. */
  cleanRuns: Record<string, number>
  /** Versions in the order they were first started, newest first. */
  versions: string[]
}

export interface StartInfo {
  crashedLastTime: boolean
  crashesInARow: number
  /** The version that ran before this one (when this one is new). */
  previousVersion?: string
  /** This version has never closed normally. */
  neverClean: boolean
}

const file = () => dir('config', 'updates', 'session.json')
let info: StartInfo | null = null

export function startSession(version: string): StartInfo {
  const st = readJson<SessionFile>(file(), { crashesInARow: 0, cleanRuns: {}, versions: [] })
  const crashed = !!st.last && !st.last.clean
  st.crashesInARow = crashed ? st.crashesInARow + 1 : 0
  if (st.versions[0] !== version) st.versions = [version, ...st.versions.filter((v) => v !== version)].slice(0, 10)
  st.last = { version, startedAt: Date.now(), clean: false }
  writeJson(file(), st)
  info = {
    crashedLastTime: crashed,
    crashesInARow: st.crashesInARow,
    previousVersion: st.versions[1],
    neverClean: !st.cleanRuns[version]
  }
  return info
}

/** Normal close: not a crash. */
export function endSession(): void {
  const st = readJson<SessionFile>(file(), { crashesInARow: 0, cleanRuns: {}, versions: [] })
  if (!st.last || st.last.clean) return
  st.last.clean = true
  st.crashesInARow = 0
  st.cleanRuns[st.last.version] = (st.cleanRuns[st.last.version] ?? 0) + 1
  writeJson(file(), st)
}

export function startInfo(): StartInfo {
  return info ?? { crashedLastTime: false, crashesInARow: 0, neverClean: false }
}
