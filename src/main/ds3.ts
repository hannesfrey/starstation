import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { binDir, dir } from './paths'
import { readJson } from './store'
import { logger } from './log'

/**
 * PS3 controllers (DualShock 3): unlike PS4/PS5/Xbox pads, Windows can't use them without a driver.
 * Starstation brings one — DsHidMini (Nefarius, official release, bundled with its .NET 10 runtime) —
 * and installs it when a PS3 controller is plugged in and the user agrees (one Windows permission prompt).
 * DsHidMini's default mode makes the pad an Xbox controller to every emulator. Hannes OK'd this 2026-11-07
 * ("every program Starstation uses must come with Starstation"; replaces starting the user's own ScpServer).
 */

const log = logger('ds3')
const sys32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
const DS3_ID = /USB\\VID_054C&PID_0268\\\S+/gi

export type Ds3State = 'none' | 'ready' | 'needs-driver'

export interface Ds3Status {
  state: Ds3State
  /** The driver the connected PS3 controller uses now (e.g. WinUSB for the old SCP driver). */
  service?: string
}

/** pnputil /enum-devices /connected output → connected PS3 controller instance ids (exported for tests). */
export function ds3Instances(pnputilOutput: string): string[] {
  return [...new Set((pnputilOutput.match(DS3_ID) ?? []).map((s) => s.trim()))]
}

/** reg query …\Enum\<id> /v Service output → the service name (exported for tests). */
export function serviceOf(regOutput: string): string | undefined {
  return /^\s+Service\s+REG_SZ\s+(\S+)\s*$/im.exec(regOutput)?.[1]
}

const run = (exe: string, args: string[], timeout = 10_000) =>
  new Promise<string>((resolve) => execFile(exe, args, { encoding: 'utf8', timeout, windowsHide: true }, (_e, out) => resolve(out ?? '')))

let last: Ds3Status = { state: 'none' }

/** Look at the connected PS3 controllers (no admin needed). */
export async function checkDs3(): Promise<Ds3Status> {
  const t = process.env.STARSTATION_TEST_DS3
  if (t) {
    const installed = readJson<{ ok?: boolean }>(path.join(dir('config', 'controllers'), 'ds3-install.json'), {}).ok
    last = t === 'needs-driver' && installed ? { state: 'ready', service: 'dshidmini' } : { state: t as Ds3State, service: t === 'needs-driver' ? 'WinUSB' : undefined }
    return last
  }
  const ids = ds3Instances(await run(path.join(sys32, 'pnputil.exe'), ['/enum-devices', '/connected']))
  if (!ids.length) return (last = { state: 'none' })
  const services = await Promise.all(ids.map(async (id) => serviceOf(await run(path.join(sys32, 'reg.exe'), ['query', `HKLM\\SYSTEM\\CurrentControlSet\\Enum\\${id}`, '/v', 'Service']))))
  const other = services.find((s) => s?.toLowerCase() !== 'dshidmini')
  last = other === undefined && services.length ? { state: 'ready', service: 'dshidmini' } : { state: 'needs-driver', service: other ?? services[0] }
  return last
}

export function ds3Status(): Ds3Status {
  return last
}

let installing = false

/**
 * Install DsHidMini (and .NET 10 Desktop Runtime if missing) with one Windows permission prompt.
 * The elevated part is the bundled ds3-driver.ps1; it logs to Files\config\logs\ds3-driver.log.
 */
export async function installDs3Driver(): Promise<{ ok: boolean; error?: string; cancelled?: boolean }> {
  if (installing) return { ok: false, error: 'The driver is already being installed.' }
  installing = true
  try {
    const out = dir('config', 'controllers')
    const logFile = dir('config', 'logs', 'ds3-driver.log')
    fs.mkdirSync(out, { recursive: true })
    fs.rmSync(path.join(out, 'ds3-install.json'), { force: true })
    const t = process.env.STARSTATION_TEST_DS3_INSTALL
    // a hidden test run never starts the real (elevated) driver setup
    if (!t && process.env.STARSTATION_HEADLESS === '1') return { ok: false, error: 'No driver setup in hidden test runs.' }
    log.info('installing the PS3 controller driver (DsHidMini) — Windows asks for permission')
    let code: number | null
    if (t) {
      // hidden tests: no Windows prompt; "ok" writes what the real script writes
      if (t === 'ok') fs.writeFileSync(path.join(out, 'ds3-install.json'), JSON.stringify({ ok: true, steps: ['test'] }))
      code = t === 'ok' ? 0 : t === 'cancel' ? 1223 : 1
    } else {
      const script = path.join(binDir(), 'ds3-driver.ps1')
      if (!fs.existsSync(script)) return { ok: false, error: 'The driver setup is missing from Starstation.' }
      const q = (s: string) => `'${s.replace(/'/g, "''")}'`
      // the inner PowerShell runs elevated (Windows shows its permission prompt); 1223 = the user said no
      const cmd = [
        'try {',
        `  $p = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe') -Verb RunAs -Wait -PassThru -WindowStyle Hidden`,
        `    -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File', ${q(`"${script}"`)}, '-Bin', ${q(`"${binDir()}"`)}, '-Out', ${q(`"${out}"`)}, '-Log', ${q(`"${logFile}"`)})`,
        '  exit $p.ExitCode',
        '} catch { exit 1223 }'
      ].join('\n')
      code = await new Promise<number | null>((resolve) => {
        const p = spawn(path.join(sys32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', cmd], { stdio: 'ignore', windowsHide: true })
        p.once('exit', (c) => resolve(c))
        p.once('error', () => resolve(1))
      })
    }
    const res = readJson<{ ok?: boolean; error?: string; steps?: string[] }>(path.join(out, 'ds3-install.json'), {})
    for (const s of res.steps ?? []) log.info(`driver setup: ${s}`)
    if (code === 1223 && !res.ok) {
      log.info('driver setup: Windows permission not given')
      return { ok: false, cancelled: true, error: 'Windows didn’t get permission, so nothing was installed.' }
    }
    if (code !== 0 || !res.ok) {
      log.warn(`driver setup failed (code ${code}): ${res.error ?? 'no result'}`)
      return { ok: false, error: res.error ?? `The driver setup stopped (code ${code}). Details are in the logs (ds3-driver.log).` }
    }
    const st = await checkDs3()
    log.info(`driver setup done; PS3 controller: ${st.state}${st.service ? ` (${st.service})` : ''}`)
    if (st.state === 'needs-driver') return { ok: false, error: 'The driver is installed, but the controller didn’t switch to it. Unplug it and plug it in again.' }
    return { ok: true }
  } finally {
    installing = false
  }
}
