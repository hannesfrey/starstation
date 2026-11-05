import { dir } from './paths'
import { writeJson } from './store'
import { homeConflicts } from './system'
import { helperPads } from './padhelper'
import type { CouchStatus, CouchStep } from '../shared/types'

/**
 * Couch check (SPEC-v2 A): the one-time test Hannes runs with his own controller. While it is on,
 * Starstation notes each step of the couch flow as it really happens; the panel ticks them off.
 */

let on = false
let done = new Set<CouchStep>()
let startedAt = 0

/** Opening the panel starts a check; opening it again (after playing) keeps the steps done so far. */
export function startCouchCheck(): void {
  if (on) return
  on = true
  done = new Set()
  startedAt = Date.now()
}

export function couchMark(step: CouchStep): void {
  if (on) done.add(step)
}

let conflicts: { at: number; v: CouchStatus['conflicts'] } | null = null
export function couchStatus(): CouchStatus {
  // the panel asks every second; Steam / Game Bar are looked up at most every 10 s
  if (!conflicts || Date.now() - conflicts.at > 10_000) conflicts = { at: Date.now(), v: homeConflicts() }
  return { on, done: [...done], pads: helperPads(), conflicts: conflicts.v }
}

/** Write the result into the logs (it goes into a diagnostics report too). */
export function saveCouchCheck(): string {
  const file = dir('config', 'logs', `couch-check-${new Date().toISOString().slice(0, 10)}.json`)
  writeJson(file, { startedAt: new Date(startedAt).toISOString(), finishedAt: new Date().toISOString(), ...couchStatus() })
  on = false
  return file
}
