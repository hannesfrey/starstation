import { execFile, execFileSync } from 'node:child_process'
import path from 'node:path'
import { dir } from './paths'
import { readJson, writeJson } from './store'
import { logger } from './log'

/**
 * Things outside Starstation that get in the way of playing from the couch (SPEC-v2 A).
 * Read, and shown with how to switch them off; the Game Bar button can be switched off by "Fix it" (2.1.0).
 */

const log = logger('system')
const sys32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')

export interface HomeConflicts {
  /** Steam is running: with "Guide button focuses Steam" it takes the PS / Home button. */
  steam: boolean
  /** Xbox Game Bar opens with the controller's Home button (Windows default: on). */
  gameBar: boolean
}

export function homeConflicts(): HomeConflicts {
  if (process.env.STARSTATION_TEST_CONFLICTS) {
    const t = process.env.STARSTATION_TEST_CONFLICTS
    return { steam: t.includes('steam'), gameBar: t.includes('gamebar') }
  }
  let steam = false
  let gameBar = true
  try {
    const out = execFileSync(path.join(sys32, 'tasklist.exe'), ['/FI', 'IMAGENAME eq steam.exe', '/NH', '/FO', 'CSV'], { encoding: 'utf8', timeout: 5000, windowsHide: true })
    steam = /"steam\.exe"/i.test(out)
  } catch (e) {
    log.warn('could not list processes', e)
  }
  try {
    const out = execFileSync(path.join(sys32, 'reg.exe'), ['query', 'HKCU\\Software\\Microsoft\\GameBar', '/v', 'UseNexusForGameBarEnabled'], { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    gameBar = !/REG_DWORD\s+0x0\b/i.test(out)
  } catch {
    gameBar = true // not set: Windows' default, the controller button opens the Game Bar
  }
  return { steam, gameBar }
}

/**
 * Health check "Fix it": the controller's Home button stops opening the Xbox Game Bar (the same switch as Windows
 * Settings → Gaming → Xbox Game Bar → "Open Xbox Game Bar using this button on a controller"). Only for this
 * Windows user, no admin needed; the old value is noted in config\gamebar-before.json so it can be put back.
 */
export function gameBarButtonOff(): { ok: boolean; error?: string } {
  if (process.env.STARSTATION_TEST_CONFLICTS !== undefined) {
    process.env.STARSTATION_TEST_CONFLICTS = process.env.STARSTATION_TEST_CONFLICTS.replace('gamebar', '')
    return { ok: true }
  }
  const reg = path.join(sys32, 'reg.exe')
  try {
    let before: string | null = null
    try {
      before = execFileSync(reg, ['query', 'HKCU\\Software\\Microsoft\\GameBar', '/v', 'UseNexusForGameBarEnabled'], { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      /* not set yet */
    }
    writeJson(dir('config', 'gamebar-before.json'), { at: new Date().toISOString(), value: before ? /0x1\b/.test(before) ? 1 : 0 : null })
    execFileSync(reg, ['add', 'HKCU\\Software\\Microsoft\\GameBar', '/v', 'UseNexusForGameBarEnabled', '/t', 'REG_DWORD', '/d', '0', '/f'], { timeout: 5000, windowsHide: true, stdio: 'ignore' })
    log.info('Xbox Game Bar: controller button switched off (HKCU GameBar UseNexusForGameBarEnabled = 0)')
    return { ok: true }
  } catch (e) {
    log.warn('could not switch off the Game Bar controller button', e)
    return { ok: false, error: 'Windows didn’t allow the change. Switch it off in Windows Settings → Gaming → Xbox Game Bar.' }
  }
}

const guidesFile = () => dir('config', 'guides.json')

/** Conflicts whose guide hasn't been shown yet (shown once each). */
export function newHomeConflicts(): (keyof HomeConflicts)[] {
  const seen = readJson<Record<string, boolean>>(guidesFile(), {})
  const c = homeConflicts()
  return (Object.keys(c) as (keyof HomeConflicts)[]).filter((k) => c[k] && !seen[`home-${k}`])
}

export function markGuideSeen(keys: string[]): void {
  const seen = readJson<Record<string, boolean>>(guidesFile(), {})
  for (const k of keys) seen[`home-${k}`] = true
  writeJson(guidesFile(), seen)
}

export interface GpuDriver {
  name: string
  version: string
  /** ISO date of the driver. */
  date?: string
}

let gpus: GpuDriver[] | null = null

/** Graphics card drivers (read once in the background; the health check warns about old ones). */
export function loadGpuDrivers(): void {
  if (process.env.STARSTATION_HEADLESS === '1') return
  execFile(
    path.join(sys32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,@{n="Date";e={$_.DriverDate.ToString("yyyy-MM-dd")}} | ConvertTo-Json -Compress'],
    { timeout: 20_000, windowsHide: true },
    (err, out) => {
      if (err) return log.warn('could not read GPU drivers', err)
      try {
        const j = JSON.parse(out) as { Name: string; DriverVersion: string; Date?: string } | { Name: string; DriverVersion: string; Date?: string }[]
        gpus = (Array.isArray(j) ? j : [j]).map((g) => ({ name: g.Name, version: g.DriverVersion, date: g.Date }))
        log.info(`GPU: ${gpus.map((g) => `${g.name} ${g.version} (${g.date})`).join('; ')}`)
      } catch (e) {
        log.warn('could not read GPU drivers', e)
      }
    }
  )
}

export function gpuDrivers(): GpuDriver[] {
  return gpus ?? []
}
