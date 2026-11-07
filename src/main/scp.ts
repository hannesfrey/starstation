import { execFile, execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { dir, filesDir } from './paths'
import { readJson, writeJson } from './store'
import { logger } from './log'

/**
 * PS3 controllers on the old SCP driver (Scarlet.Crush "SCP DS3", also ScpToolkit): Windows only sees the pad
 * (as an Xbox 360 controller) while the SCP server program runs. It doesn't start with Windows by itself —
 * after a restart the controller simply does nothing (Hannes, 2026-11-07). So Starstation starts it.
 * Only the user's own copy is started (never downloaded or installed), minimized; nothing is changed.
 */

const log = logger('scp')
const sys32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
const DS3_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Enum\\USB\\VID_054C&PID_0268'
const SERVERS = ['scpserver.exe', 'scpservice.exe']
const file = () => dir('config', 'controllers', 'scp.json')

export interface ScpStatus {
  /** A PS3 controller was set up with the SCP driver (WinUSB) on this PC. */
  driver: boolean
  /** ScpServer / ScpService is running. */
  running: boolean
  /** The ScpServer.exe Starstation found (or was shown). */
  server?: string
}

/** reg query output → has a PS3 controller been set up with SCP's WinUSB driver? (exported for tests) */
export function ds3OnScp(regOutput: string): boolean {
  return /^\s+Service\s+REG_SZ\s+WinUSB\s*$/im.test(regOutput)
}

/** tasklist /FO CSV output → is an SCP server running? (exported for tests) */
export function scpRunning(tasklistCsv: string): boolean {
  return tasklistCsv.split(/\r?\n/).some((l) => SERVERS.includes((l.split('","')[0] ?? '').replace(/^"/, '').toLowerCase()))
}

let driverCache: boolean | null = null
function driverInstalled(): boolean {
  if (process.env.STARSTATION_TEST_SCP) return process.env.STARSTATION_TEST_SCP.includes('driver')
  if (driverCache !== null) return driverCache
  try {
    driverCache = ds3OnScp(execFileSync(path.join(sys32, 'reg.exe'), ['query', DS3_KEY, '/s', '/v', 'Service'], { encoding: 'utf8', timeout: 5000, windowsHide: true }))
  } catch {
    driverCache = false // key missing: no PS3 controller was ever set up this way
  }
  return driverCache
}

function serverRunning(): boolean {
  if (process.env.STARSTATION_TEST_SCP) return process.env.STARSTATION_TEST_SCP.includes('running')
  try {
    return scpRunning(execFileSync(path.join(sys32, 'tasklist.exe'), ['/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 5000, windowsHide: true }))
  } catch {
    return false
  }
}

function knownServer(): string | undefined {
  const s = readJson<{ server?: string }>(file(), {}).server
  return s && fs.existsSync(s) ? s : undefined
}

export function scpStatus(): ScpStatus {
  const driver = driverInstalled()
  return { driver, running: driver && serverRunning(), server: driver ? knownServer() : undefined }
}

/** Look for ScpServer.exe in the usual places a user keeps it (a few folders deep, Starstation's own folder skipped). */
export async function findScpServer(): Promise<string | undefined> {
  if (process.env.STARSTATION_TEST_SCP) return process.env.STARSTATION_TEST_SCP_SERVER || undefined
  const home = os.homedir()
  const roots = [
    path.join(home, 'Desktop'),
    path.join(home, 'OneDrive', 'Desktop'),
    path.join(home, 'Downloads'),
    path.join(home, 'Documents'),
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    home
  ].filter((r): r is string => !!r && fs.existsSync(r))
  const skip = new Set([path.resolve(filesDir()).toLowerCase(), 'node_modules', '.git', 'appdata', 'windowsapps'])
  let seen = 0
  const walk = async (d: string, depth: number): Promise<string | undefined> => {
    if (depth > 5 || seen > 60_000) return undefined
    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(d, { withFileTypes: true })
    } catch {
      return undefined
    }
    seen += entries.length
    const hit = entries.find((e) => e.isFile() && e.name.toLowerCase() === 'scpserver.exe')
    if (hit) return path.join(d, hit.name)
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue
      const p = path.join(d, e.name)
      if (skip.has(e.name.toLowerCase()) || skip.has(p.toLowerCase())) continue
      const r = await walk(p, depth + 1)
      if (r) return r
    }
    return undefined
  }
  for (const r of roots) {
    const hit = await walk(r, r === home ? 4 : 0)
    if (hit) return hit
  }
  return undefined
}

/** Start the user's ScpServer (minimized, not taking the focus) and wait until it runs. */
export async function startScpServer(): Promise<{ ok: boolean; error?: string }> {
  const server = knownServer() ?? (await findScpServer())
  if (!server) return { ok: false, error: 'ScpServer.exe wasn’t found. Start it from your SCP driver folder once, and Starstation remembers it.' }
  writeJson(file(), { server })
  if (process.env.STARSTATION_TEST_SCP) return { ok: true }
  // Start-Process goes through Windows' shell (ShellExecute): the server gets none of Starstation's open handles
  // (with cmd "start" it kept them, so Starstation's own pipes stayed open after it closed). Minimized.
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`
  spawn(
    path.join(sys32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath ${q(server)} -WorkingDirectory ${q(path.dirname(server))} -WindowStyle Minimized`],
    { stdio: 'ignore', windowsHide: true }
  )
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (serverRunning()) {
      log.info(`started ${server} (PS3 controller on the SCP driver)`)
      return { ok: true }
    }
  }
  log.warn(`${server} didn't start`)
  return { ok: false, error: 'SCP Server didn’t start.' }
}

/** At start: a PS3 controller on the SCP driver needs its server running — start it if it isn't. */
export async function ensureScpServer(): Promise<void> {
  if (!driverInstalled()) return
  if (serverRunning()) {
    // remember where it is, for the next time it isn't running
    if (!knownServer()) remember()
    return
  }
  const r = await startScpServer()
  if (!r.ok) log.warn(`PS3 controller (SCP driver) won't work: ${r.error}`)
}

/** The running server's path (wmic-free: PowerShell's Get-Process). */
function remember(): void {
  execFile(
    path.join(sys32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', '(Get-Process ScpServer -ErrorAction SilentlyContinue | Select-Object -First 1).Path'],
    { timeout: 15_000, windowsHide: true },
    (err, out) => {
      const p = out?.trim()
      if (!err && p && fs.existsSync(p)) writeJson(file(), { server: p })
    }
  )
}
