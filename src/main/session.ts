import { dir } from './paths'
import { readObject, writeJson } from './store'

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

/** Only bookkeeping (crash count): a full disk must never stop Starstation from starting or closing. */
function save(st: SessionFile): void {
  try {
    writeJson(file(), st)
  } catch {
    /* nothing to do: the next start just can't tell how this one ended */
  }
}

/** Read before anything else at start: a file of another shape must never stop Starstation from starting. */
function load(): SessionFile {
  const st = readObject<Partial<SessionFile>>(file(), {})
  const last = st.last && typeof st.last === 'object' && typeof st.last.version === 'string' ? st.last : undefined
  return {
    last,
    crashesInARow: Number.isInteger(st.crashesInARow) && st.crashesInARow! >= 0 ? st.crashesInARow! : 0,
    cleanRuns: st.cleanRuns && typeof st.cleanRuns === 'object' && !Array.isArray(st.cleanRuns) ? st.cleanRuns : {},
    versions: Array.isArray(st.versions) ? st.versions.filter((v) => typeof v === 'string') : []
  }
}

export function startSession(version: string): StartInfo {
  const st = load()
  // another version ran last: an update replaced it (the installer ends a running Starstation), not a crash
  const crashed = !!st.last && !st.last.clean && st.last.version === version
  st.crashesInARow = crashed ? st.crashesInARow + 1 : 0
  if (st.versions[0] !== version) st.versions = [version, ...st.versions.filter((v) => v !== version)].slice(0, 10)
  st.last = { version, startedAt: Date.now(), clean: false }
  save(st)
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
  const st = load()
  if (!st.last || st.last.clean) return
  st.last.clean = true
  st.crashesInARow = 0
  st.cleanRuns[st.last.version] = (st.cleanRuns[st.last.version] ?? 0) + 1
  save(st)
}

export function startInfo(): StartInfo {
  return info ?? { crashedLastTime: false, crashesInARow: 0, neverClean: false }
}
