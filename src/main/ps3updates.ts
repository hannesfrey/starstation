import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { spawn } from 'node:child_process'
import { dir } from './paths'
import { emulatorDir, getConsole, getEmulator } from './presets'
import { readJson, writeJson } from './store'
import { parseSfo } from './formats/sfo'
import { ps3FromFolder, ps3FromIso } from './formats/gameid'
import { compareAppVer, isSonyPkgUrl, parseUpdateXml, pendingUpdates, pkgMatches, type UpdatePkg } from './formats/ps3update'
import { rpcs3InstallPkg } from './convert'
import { logger } from './log'
import type { Game, Ps3UpdateInfo } from '../shared/types'

/**
 * PS3 game updates from Sony's own update server (Hannes, 2026-11-07: "shure" to downloading them).
 * Like the PS3: starting a game with an update asks "Update now / Play without updating".
 * The list comes over HTTPS from a0.ww.np.dl.playstation.net, trusted through Sony's own root certificate
 * (pinned below; Windows doesn't know it). The packages come over plain HTTP from Sony's CDN and are only
 * installed when size + SHA-1 match that list. RPCS3 installs them one after another, without a window.
 */

const log = logger('ps3updates')

/** "SCEI DNAS Root 05" (valid until 2037): the only certificate the update list is accepted from. */
const SONY_ROOT = `-----BEGIN CERTIFICATE-----
MIID0jCCArqgAwIBAgIBADANBgkqhkiG9w0BAQUFADBUMQswCQYDVQQGEwJKUDEp
MCcGA1UEChMgU29ueSBDb21wdXRlciBFbnRlcnRhaW5tZW50IEluYy4xGjAYBgNV
BAMTEVNDRUkgRE5BUyBSb290IDA1MB4XDTA0MDcxMjA5MDExOVoXDTM3MTIwNjA5
MDExOVowVDELMAkGA1UEBhMCSlAxKTAnBgNVBAoTIFNvbnkgQ29tcHV0ZXIgRW50
ZXJ0YWlubWVudCBJbmMuMRowGAYDVQQDExFTQ0VJIEROQVMgUm9vdCAwNTCCASIw
DQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBANmPeza8PwCqlI7esOGIkoSESnIN
g72ZD3Ut63jy7SdothPIvGBqVZWYkIpqJYJd1I4Nh//IpXQCQL0PnJLrh9BBeowq
Muf5NNq3Us80Ihiu9CvNEAEO18g3OFV1TYdSwQ5zUsk33OUeI7h4aBPDVcZXYeHt
dbPLqe4K8igian5prrAD5S6h28t8aAm+qMWRo+bW25B/841XwDGBP7/IxZv8Yoio
rCo80CVYe6lGoU08eeqQiaHI5zAF281DWZSoVfLjJUEWmEnxqr8aOhszRGePi+Ei
7UQjHDuZX9rLhDI1zAND+BA259tn/iwOqVXe20OccJllHJcG4Ecmd98f5qMCAwEA
AaOBrjCBqzAdBgNVHQ4EFgQUxlahM1tPzoN3YgVEhm0gV7Wv2twwfAYDVR0jBHUw
c4AUxlahM1tPzoN3YgVEhm0gV7Wv2tyhWKRWMFQxCzAJBgNVBAYTAkpQMSkwJwYD
VQQKEyBTb255IENvbXB1dGVyIEVudGVydGFpbm1lbnQgSW5jLjEaMBgGA1UEAxMR
U0NFSSBETkFTIFJvb3QgMDWCAQAwDAYDVR0TBAUwAwEB/zANBgkqhkiG9w0BAQUF
AAOCAQEACZPihjwXA27wJ03tEKcHAeFLi8aBw2ysH4GwuH1dWb3UpuznWOB0iQT1
wQocnEFYCJx5XFEnj4aLWpSHLEq/sSO+my+aPoTEsy20ajF+YLYZm0bZxH50CJYh
rkET4C2aC0XvhGp9k1JQ1o0W6+cFT5LTlXapsq8Btt31t+XDPX7RqGV4WGekt3hM
T7xRc7JWXdAQijIrbYi8mtbM07KEGnPU6IT8C47+0mSurpwLOoWL1tPgo6ePpLNi
c4quUMgh9RXVjeTyXOMmyYdeUm2gt7qErvQONli+6Epmhm0A2khpIMHSpQjTE8gV
rZp42a6+zg1iYy2vFBOmiQ17GRUl0A==
-----END CERTIFICATE-----
`

const HEADLESS = process.env.STARSTATION_HEADLESS === '1'
// tests: a local server instead of Sony's, and a stand-in for RPCS3's installer
const TEST_BASE = HEADLESS ? process.env.STARSTATION_PS3UPDATE_BASE : undefined
const TEST_INSTALLER = HEADLESS ? process.env.STARSTATION_PS3UPDATE_INSTALLER : undefined
const BASE = TEST_BASE || 'https://a0.ww.np.dl.playstation.net/tpl/np'
const RECHECK_MS = 24 * 3600_000

interface Entry {
  checkedAt: string
  packages: UpdatePkg[]
}
const stateFile = () => dir('config', 'ps3updates.json')
const cacheDir = () => dir('config', 'cache', 'ps3-updates')
const readState = () => readJson<Record<string, Entry>>(stateFile(), {})

function rpcs3Dir(): string | null {
  const c = getConsole('ps3')
  const e = c ? getEmulator(c.emulator) : undefined
  return e ? emulatorDir(e) : null
}

/** GET with a timeout; the update list only from Sony's root certificate (or the test server). */
function get(url: string, timeoutMs = 20_000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const opts = u.protocol === 'https:' && !TEST_BASE ? { ca: SONY_ROOT } : {}
    const req = (u.protocol === 'https:' ? https : http).get(url, opts, (r) => {
      let body = ''
      r.setEncoding('utf8')
      r.on('data', (c) => (body += c))
      r.on('end', () => resolve({ status: r.statusCode ?? 0, body }))
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timed out')))
    req.on('error', reject)
  })
}

/** Sony's update list for a game code ([] = no updates). Throws when the server can't be reached. */
export async function fetchUpdateList(serial: string, timeoutMs?: number): Promise<UpdatePkg[]> {
  if (HEADLESS && !TEST_BASE) throw new Error('no update server in tests')
  if (!/^[A-Z]{4}\d{5}$/.test(serial)) return []
  const r = await get(`${BASE}/${serial}/${serial}-ver.xml`, timeoutMs)
  if (r.status === 404) return []
  if (r.status !== 200) throw new Error(`update server answered ${r.status}`)
  return parseUpdateXml(r.body).filter((p) => !!TEST_BASE || isSonyPkgUrl(p.url))
}

/** The version a PS3 game is on: the newest of the disc's and RPCS3's installed copy (where updates go). */
export function installedVersion(g: Game): string {
  const found: string[] = []
  const root = rpcs3Dir()
  if (g.serial && root) {
    try {
      const v = parseSfo(fs.readFileSync(path.join(root, 'dev_hdd0', 'game', g.serial, 'PARAM.SFO'))).APP_VER
      if (v) found.push(String(v))
    } catch {
      /* nothing installed yet */
    }
  }
  if (g.kind === 'folder') found.push(ps3FromFolder(g.path)?.appVer ?? '')
  else if (g.kind === 'file') found.push(ps3FromIso(g.path)?.appVer ?? '')
  return found.filter((v) => /^\d{2}\.\d{2}$/.test(v)).sort(compareAppVer).pop() ?? '00.00'
}

function infoFrom(g: Game, pkgs: UpdatePkg[]): Ps3UpdateInfo | null {
  const installed = installedVersion(g)
  const pending = pendingUpdates(pkgs, installed)
  if (!pending.length) return null
  return { installed, latest: pending[pending.length - 1].version, count: pending.length, size: pending.reduce((s, p) => s + p.size, 0) }
}

/** An update this game still needs (from the last check; asks Sony right away if this game was never checked). */
export async function updateInfo(g: Game): Promise<Ps3UpdateInfo | null> {
  if (g.console !== 'ps3' || !g.serial) return null
  let e = readState()[g.serial]
  if (!e) {
    try {
      e = { checkedAt: new Date().toISOString(), packages: await fetchUpdateList(g.serial, 5000) }
      writeJson(stateFile(), { ...readState(), [g.serial]: e })
    } catch (err) {
      log.info(`${g.serial}: update server not reached (${(err as Error).message})`)
      return null
    }
  }
  return infoFrom(g, e.packages)
}

/** Look for updates for every PS3 game (only the small lists; once a day per game). */
export async function checkUpdates(games: Game[], force = false): Promise<void> {
  if (HEADLESS && !TEST_BASE) return
  const serials = [...new Set(games.filter((g) => g.console === 'ps3' && g.serial).map((g) => g.serial!))]
  for (const s of serials) {
    const e = readState()[s]
    if (!force && e && Date.now() - Date.parse(e.checkedAt) < RECHECK_MS) continue
    try {
      const packages = await fetchUpdateList(s)
      writeJson(stateFile(), { ...readState(), [s]: { checkedAt: new Date().toISOString(), packages } })
      if (packages.length) log.info(`${s}: updates up to ${packages[packages.length - 1].version}`)
    } catch (err) {
      log.info(`${s}: update server not reached (${(err as Error).message})`)
      return // offline: try again next start
    }
  }
}

/** Download to file (via .part), reporting 0–100. Only Sony's hosts (or the test server); follows a few redirects. */
function download(url: string, file: string, onPct: (pct: number) => void, hops = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!TEST_BASE && !isSonyPkgUrl(url)) return reject(new Error(`not a Sony update address: ${url}`))
    const u = new URL(url)
    const req = (u.protocol === 'https:' ? https : http).get(url, (r) => {
      const status = r.statusCode ?? 0
      if (status >= 300 && status < 400 && r.headers.location && hops < 3) {
        r.resume()
        return download(new URL(r.headers.location, url).toString(), file, onPct, hops + 1).then(resolve, reject)
      }
      if (status !== 200) {
        r.resume()
        return reject(new Error(`download answered ${status}`))
      }
      const total = Number(r.headers['content-length'] ?? 0)
      let got = 0
      let last = -1
      const out = fs.createWriteStream(file + '.part')
      r.on('data', (c: Buffer) => {
        got += c.length
        const pct = total ? Math.floor((got / total) * 100) : 0
        if (pct !== last) onPct((last = pct))
      })
      r.pipe(out)
      out.on('finish', () => fs.rename(file + '.part', file, (e) => (e ? reject(e) : resolve())))
      out.on('error', reject)
      r.on('error', reject)
    })
    // a stalled connection fails instead of hanging forever
    req.setTimeout(60_000, () => req.destroy(new Error('the download stalled')))
    req.on('error', reject)
  })
}

async function install(file: string, serial: string): Promise<void> {
  if (TEST_INSTALLER) {
    const p = spawn(process.execPath, [TEST_INSTALLER, file, path.join(rpcs3Dir() ?? '', 'dev_hdd0', 'game', serial)], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'ignore',
      windowsHide: true
    })
    await new Promise((resolve) => p.once('exit', resolve))
    return
  }
  await rpcs3InstallPkg(file)
}

let busy: string | null = null
export const updatingGame = (): string | null => busy

const gb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1024 ** 2))} MB`)

/** Download, check and install every update the game still needs, oldest first. */
export async function runUpdate(g: Game, progress: (text: string) => void): Promise<{ ok: boolean; error?: string; version?: string }> {
  if (busy) return { ok: false, error: 'Another game is being updated right now.' }
  if (!g.serial || g.console !== 'ps3') return { ok: false, error: 'Only PS3 games get updates this way.' }
  busy = g.id
  try {
    let pkgs: UpdatePkg[]
    try {
      pkgs = await fetchUpdateList(g.serial)
      writeJson(stateFile(), { ...readState(), [g.serial]: { checkedAt: new Date().toISOString(), packages: pkgs } })
    } catch (err) {
      log.warn(`${g.serial}: update list`, err)
      return { ok: false, error: 'PlayStation Network’s update server could not be reached. Check the internet connection and try again.' }
    }
    const pending = pendingUpdates(pkgs, installedVersion(g))
    if (!pending.length) return { ok: true }
    const total = pending.reduce((s, p) => s + p.size, 0)
    await fsp.mkdir(cacheDir(), { recursive: true })
    // room for the downloads (one at a time) and what they install
    const free = (() => {
      try {
        const s = fs.statfsSync(cacheDir())
        return s.bavail * s.bsize
      } catch {
        return Infinity
      }
    })()
    const need = total + Math.max(...pending.map((p) => p.size)) + 1024 ** 3
    if (free < need) return { ok: false, error: `Not enough space: the updates need about ${gb(need)}, ${gb(free)} is free.` }

    log.info(`${g.id}: updating ${installedVersion(g)} → ${pending[pending.length - 1].version} (${pending.length} packages, ${gb(total)})`)
    for (const [i, p] of pending.entries()) {
      const step = pending.length > 1 ? ` (${i + 1} of ${pending.length})` : ''
      const file = path.join(cacheDir(), `${g.serial}-${p.version}.pkg`)
      // a package left from an interrupted update is used if it checks out
      let ok = await pkgMatches(file, p)
      for (let attempt = 0; !ok && attempt < 2; attempt++) {
        await fsp.rm(file, { force: true })
        try {
          await download(p.url, file, (pct) => progress(`Downloading update ${p.version}${step}… ${pct}%`))
        } catch (err) {
          log.warn(`${g.serial} ${p.version}: download`, err)
          if (attempt === 1) return { ok: false, error: `Update ${p.version} could not be downloaded (${(err as Error).message}). Try again later.` }
          continue
        }
        progress(`Checking update ${p.version}${step}…`)
        ok = await pkgMatches(file, p)
        if (!ok) log.warn(`${g.serial} ${p.version}: download doesn't match Sony's checksum`)
      }
      if (!ok) {
        await fsp.rm(file, { force: true })
        return { ok: false, error: `Update ${p.version} arrived damaged twice and was not installed.` }
      }
      progress(`Installing update ${p.version}${step}…`)
      await install(file, g.serial)
      const now = installedVersion(g)
      if (compareAppVer(now, p.version) < 0) {
        log.warn(`${g.serial} ${p.version}: still on ${now} after installing`)
        return { ok: false, error: `RPCS3 could not install update ${p.version}. The download is kept for the next try.` }
      }
      await fsp.rm(file, { force: true })
      log.info(`${g.id}: update ${p.version} installed`)
    }
    return { ok: true, version: pending[pending.length - 1].version }
  } finally {
    busy = null
    progress('')
  }
}
