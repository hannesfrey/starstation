import { net } from 'electron'
import { dir } from './paths'
import { readJson, writeJson } from './store'
import { getSecrets, type Secrets } from './settings'
import { logger } from './log'
import type { Achievement } from '../shared/types'

/**
 * RetroAchievements: log in once (username + password from config\secrets.json), keep only the token,
 * and give it to every emulator that can use it (written before each launch by the presets' `achievements` steps).
 */

const log = logger('retroachievements')
const base = () => process.env.STARSTATION_RA_API || 'https://retroachievements.org'

export function raStatus(): { loggedIn: boolean; username?: string; hasPassword: boolean; hasApiKey: boolean } {
  const r = getSecrets().retroachievements ?? {}
  return { loggedIn: !!(r.username && r.token), username: r.username || undefined, hasPassword: !!r.password, hasApiKey: !!r.webApiKey }
}

/** Placeholders for the presets: only filled when logged in, so the emulators' own logins are left alone otherwise. */
export function raVars(): Record<string, string> {
  const r = getSecrets().retroachievements ?? {}
  return r.username && r.token ? { rauser: r.username, ratoken: r.token } : {}
}

export async function raLogin(): Promise<{ ok: boolean; error?: string }> {
  const secrets = getSecrets()
  const r = secrets.retroachievements ?? {}
  if (!r.username || !r.password) return { ok: false, error: 'Fill in your RetroAchievements username and password in Files\\config\\secrets.json first.' }
  try {
    const res = await net.fetch(`${base()}/dorequest.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Starstation' },
      body: new URLSearchParams({ r: 'login2', u: r.username, p: r.password }).toString()
    })
    const j = (await res.json()) as { Success?: boolean; Token?: string; User?: string; Error?: string }
    if (!j.Success || !j.Token) return { ok: false, error: j.Error || 'RetroAchievements did not accept the login.' }
    const next: Secrets = { ...secrets, retroachievements: { ...r, username: j.User || r.username, token: j.Token } }
    writeJson(dir('config', 'secrets.json'), next)
    log.info(`logged in as ${j.User || r.username}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `RetroAchievements can't be reached (${(e as Error).message}).` }
  }
}

export function raLogout(): void {
  const secrets = getSecrets()
  if (!secrets.retroachievements) return
  const { token: _t, ...rest } = secrets.retroachievements
  writeJson(dir('config', 'secrets.json'), { ...secrets, retroachievements: rest })
}

/** After a session: achievements unlocked in the last `minutes` (needs the web API key from the RA settings page). */
export async function recentUnlocks(minutes: number): Promise<Achievement[]> {
  const r = getSecrets().retroachievements ?? {}
  if (!r.username || !r.token || !r.webApiKey) return []
  try {
    const q = new URLSearchParams({ u: r.username, y: r.webApiKey, m: String(Math.max(1, Math.ceil(minutes))) })
    const res = await net.fetch(`${base()}/API/API_GetUserRecentAchievements.php?${q}`, { headers: { 'User-Agent': 'Starstation' } })
    if (!res.ok) return []
    const list = (await res.json()) as { Title?: string; Description?: string; GameTitle?: string; Points?: number }[]
    return (Array.isArray(list) ? list : []).map((a) => ({ title: a.Title ?? 'Achievement', description: a.Description, game: a.GameTitle, points: a.Points }))
  } catch (e) {
    log.warn('recent unlocks failed', e)
    return []
  }
}

/** Remember which sessions were checked (so a restart doesn't show the same unlocks again). */
export function lastUnlockCheck(set?: number): number {
  const f = dir('config', 'retroachievements.json')
  if (set) writeJson(f, { checkedAt: set })
  return readJson<{ checkedAt?: number }>(f, {}).checkedAt ?? 0
}
