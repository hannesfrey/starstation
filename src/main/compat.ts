import { net } from 'electron'
import { dir } from './paths'
import { readJson, writeJson } from './store'
import { getSecrets, isTester } from './settings'
import { logger } from './log'
import type { Compat, CompatLabel, Game } from '../shared/types'

/**
 * Compatibility labels for PS3 and Xbox 360 games (SPEC-v2 D), from the emulators' public lists:
 * RPCS3's compatibility database (by serial) and Xenia Canary's game-compatibility issues (by title ID).
 * Looked up in the background, kept in config\library\compat.json, refreshed after a week.
 */

const log = logger('compat')
const file = () => dir('config', 'library', 'compat.json')
const WEEK = 7 * 24 * 3600_000
type Cache = Record<string, (Compat & { at: number }) | { none: true; at: number }>
let cache: Cache | null = null
const load = (): Cache => (cache ??= readJson<Cache>(file(), {}))

const rpcs3Base = () => process.env.STARSTATION_RPCS3_COMPAT ?? 'https://rpcs3.net/compatibility'
const ghApi = () => process.env.STARSTATION_GITHUB_API ?? 'https://api.github.com'

const RPCS3: Record<string, CompatLabel> = { Playable: 'Runs well', Ingame: 'Playable', Intro: 'Issues', Loadable: "Doesn't start", Nothing: "Doesn't start" }
const XENIA: [RegExp, CompatLabel][] = [
  [/^state-playable$/, 'Runs well'],
  [/^state-gameplay$/, 'Playable'],
  [/^state-(menus|intro)$/, 'Issues'],
  [/^state-(load|nothing|crash)$/, "Doesn't start"]
]

const key = (g: Game) => `${g.console}:${g.serial ?? ''}`

/** The label for a game, from what was looked up before (no network). */
export function compatFor(g: Game): Compat | undefined {
  if ((g.console !== 'ps3' && g.console !== 'xbox360') || !g.serial) return undefined
  const e = load()[key(g)]
  return e && !('none' in e) ? { label: e.label, source: e.source, status: e.status, url: e.url } : undefined
}

async function rpcs3(serial: string): Promise<Compat | null> {
  const r = await net.fetch(`${rpcs3Base()}?api=v1&g=${encodeURIComponent(serial)}`, { signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'Starstation' } })
  if (!r.ok) throw new Error(`RPCS3 list: HTTP ${r.status}`)
  const j = (await r.json()) as { results?: Record<string, { status?: string; thread?: number }> }
  const hit = j.results?.[serial]
  const label = hit?.status ? RPCS3[hit.status] : undefined
  return label ? { label, source: 'RPCS3', status: hit!.status!, url: hit!.thread ? `https://forums.rpcs3.net/thread-${hit!.thread}.html` : undefined } : null
}

async function xenia(titleId: string): Promise<Compat | null> {
  const token = isTester() ? getSecrets().github?.token : undefined
  const q = encodeURIComponent(`repo:xenia-canary/game-compatibility ${titleId} in:title`)
  const r = await net.fetch(`${ghApi()}/search/issues?q=${q}`, {
    signal: AbortSignal.timeout(20_000),
    headers: { 'User-Agent': 'Starstation', Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  })
  if (!r.ok) throw new Error(`Xenia list: HTTP ${r.status}`)
  const j = (await r.json()) as { items?: { title: string; html_url: string; labels: { name: string }[] }[] }
  const issue = j.items?.find((i) => i.title.toUpperCase().startsWith(titleId.toUpperCase()))
  if (!issue) return null
  for (const l of issue.labels.map((x) => x.name))
    for (const [re, label] of XENIA) if (re.test(l)) return { label, source: 'Xenia', status: l.replace(/^state-/, ''), url: issue.html_url }
  return null
}

let busy = false

/** Look up the games that aren't known yet (or not for a week), slowly: the lists are shared by everyone. */
export async function refreshCompat(games: Game[], onChange: () => void): Promise<void> {
  if (busy || (process.env.STARSTATION_HEADLESS === '1' && !process.env.STARSTATION_RPCS3_COMPAT)) return
  busy = true
  try {
    const c = load()
    const todo = games.filter((g) => (g.console === 'ps3' || g.console === 'xbox360') && g.serial && Date.now() - (c[key(g)]?.at ?? 0) > WEEK)
    for (const g of todo) {
      try {
        const hit = g.console === 'ps3' ? await rpcs3(g.serial!) : await xenia(g.serial!)
        c[key(g)] = hit ? { ...hit, at: Date.now() } : { none: true, at: Date.now() }
        writeJson(file(), c)
        if (hit) onChange()
      } catch (e) {
        log.warn(`${g.id}: compatibility lookup failed`, e)
        if (/HTTP 403|HTTP 429/.test(String(e))) break // rate limit: next start
      }
      // GitHub allows 10 searches a minute without a login
      await new Promise((r) => setTimeout(r, g.console === 'xbox360' && !process.env.STARSTATION_RPCS3_COMPAT ? 7000 : 300))
    }
  } finally {
    busy = false
  }
}
