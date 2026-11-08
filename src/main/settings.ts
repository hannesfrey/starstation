import { dir } from './paths'
import { readJson, readObject, writeJson } from './store'
import { inSafeMode } from './safeflag'
import { DEFAULT_SETTINGS, type Settings } from '../shared/types'

let cache: Settings | null = null
/** Safe mode: default settings, changes kept in memory only (leaving safe mode brings the saved ones back). */
let safe: Settings | null = null
const file = () => dir('config', 'settings.json')

/**
 * The saved settings, each one only if it is the right kind of value (settings.json can be edited by hand:
 * "sounds": "yes" or a nickname that isn't text would otherwise reach code that expects true/false or text).
 * Unknown keys (from older versions) are dropped.
 */
function load(): Settings {
  const raw = readJson<Record<string, unknown> | null>(file(), {})
  const s: Settings = { ...DEFAULT_SETTINGS }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return s
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const v = raw[k]
    const want = typeof DEFAULT_SETTINGS[k]
    if (typeof v === want && (want !== 'number' || Number.isFinite(v))) (s as unknown as Record<string, unknown>)[k] = v
  }
  return s
}

export function getSettings(): Settings {
  if (inSafeMode()) return (safe ??= { ...DEFAULT_SETTINGS, bootAnimation: false })
  safe = null
  if (!cache) cache = load()
  return cache
}

/** The saved settings, even in safe mode (packages, diagnostics). */
export function savedSettings(): Settings {
  return cache ?? (cache = load())
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Settings {
  if (!(key in DEFAULT_SETTINGS)) throw new Error(`Unknown setting ${String(key)}`)
  if (typeof value !== typeof DEFAULT_SETTINGS[key]) throw new Error(`Bad value for ${String(key)}`)
  if (inSafeMode()) {
    safe = { ...getSettings(), [key]: value }
    return safe
  }
  const s = { ...getSettings() }
  s[key] = value
  cache = s
  writeJson(file(), s)
  return s
}

/** Local secrets (ScreenScraper / RetroAchievements / GitHub / Nexus). Never packaged, never committed. */
export interface Secrets {
  screenscraper?: { username?: string; password?: string; devid?: string; devpassword?: string }
  retroachievements?: { username?: string; password?: string; webApiKey?: string; token?: string }
  /** Hannes's PC only: beta channel + "Release to everyone" + "Mark as tested". */
  github?: { token?: string }
  nexus?: { apiKey?: string }
}
export function getSecrets(): Secrets {
  // filled in by hand: anything but an object counts as empty
  return readObject<Secrets>(dir('config', 'secrets.json'), {})
}

/** This PC tests new versions first (it has the GitHub login that can publish releases). */
export function isTester(): boolean {
  return !!getSecrets().github?.token || process.env.STARSTATION_TESTER === '1'
}
