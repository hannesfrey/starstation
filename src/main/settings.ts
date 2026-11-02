import { dir } from './paths'
import { readJson, writeJson } from './store'
import { DEFAULT_SETTINGS, type Settings } from '../shared/types'

let cache: Settings | null = null
const file = () => dir('config', 'settings.json')

export function getSettings(): Settings {
  if (!cache) cache = { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(file(), {}) }
  return cache
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Settings {
  const s = { ...getSettings() }
  if (!(key in DEFAULT_SETTINGS)) throw new Error(`Unknown setting ${String(key)}`)
  if (typeof value !== typeof DEFAULT_SETTINGS[key]) throw new Error(`Bad value for ${String(key)}`)
  s[key] = value
  cache = s
  writeJson(file(), s)
  return s
}

/** Local secrets (ScreenScraper / RetroAchievements). Never packaged, never committed. */
export interface Secrets {
  screenscraper?: { username?: string; password?: string; devid?: string; devpassword?: string }
  retroachievements?: { username?: string; password?: string; webApiKey?: string; token?: string }
}
export function getSecrets(): Secrets {
  return readJson<Secrets>(dir('config', 'secrets.json'), {})
}
