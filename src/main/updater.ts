import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { app, net } from 'electron'
import { autoUpdater } from 'electron-updater'
import { dir } from './paths'
import { readJson, writeJson } from './store'
import { getSecrets, isTester } from './settings'
import { logger } from './log'
import { compareVersions } from '../shared/semver'
import { pickRelease, type Release } from './formats/releases'
import { endSession, type StartInfo } from './session'
import { download } from './emulators'
import type { Notice, UpdateState } from '../shared/types'

/**
 * Safe updates (SPEC-v2 B).
 * - Releases are GitHub releases of hannesfrey/starstation. A new version is published as a pre-release:
 *   only the tester PC (Hannes: GitHub login in secrets.json) takes pre-releases. "Release to everyone"
 *   turns that same release into a normal one, and then every other Starstation updates to it.
 * - Starstation picks the release itself and points electron-updater at that release's files, so the
 *   choice is easy to follow and test; electron-updater downloads, checks and installs it.
 * - Installers of the current and the last 3 versions are kept in Files\config\updates\installers:
 *   Undo update and the automatic rescue run one of them (silent NSIS install, then Starstation restarts).
 */

const log = logger('updater')
const OWNER = 'hannesfrey'
const REPO = 'starstation'
const KEEP_PREVIOUS = 3
const HEADLESS = process.env.STARSTATION_HEADLESS === '1'

const apiBase = () => process.env.STARSTATION_GITHUB_API ?? 'https://api.github.com'
const downloadsBase = () => process.env.STARSTATION_GITHUB_DOWNLOADS ?? `https://github.com/${OWNER}/${REPO}/releases/download`
const updatesDir = (...p: string[]) => dir('config', 'updates', ...p)
const installersDir = () => updatesDir('installers')
const installerName = (v: string) => `Starstation-Setup-${v}.exe`
// electron-updater's cache folder (LOCALAPPDATA points into Files\config\electron, see paths.ts)
const updaterCache = () => path.join(process.env.LOCALAPPDATA ?? '', 'starstation-updater')
const INSTALLER_VERSION = 'installer.version'

let state: UpdateState = { status: 'idle' }
let releases: Release[] | null = null

function version(): string {
  return process.env.STARSTATION_TEST_VERSION ?? app.getVersion()
}

function skipped(): string | undefined {
  return readJson<{ skip?: string }>(updatesDir('skip.json'), {}).skip
}

async function github<T>(p: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getSecrets().github?.token
  const r = await net.fetch(`${apiBase()}${p}`, {
    signal: AbortSignal.timeout(30_000),
    method: init.method ?? 'GET',
    headers: {
      'User-Agent': 'Starstation',
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {})
    },
    body: init.body ? JSON.stringify(init.body) : undefined
  })
  if (!r.ok) throw new Error(`GitHub: HTTP ${r.status}`)
  return (await r.json()) as T
}

async function loadReleases(): Promise<Release[]> {
  releases = await github<Release[]>(`/repos/${OWNER}/${REPO}/releases?per_page=30`)
  return releases
}

/** Versions whose installer is kept and that are older than the running one, newest first. */
export function previousVersions(): string[] {
  let names: string[] = []
  try {
    names = fs.readdirSync(installersDir())
  } catch {
    return []
  }
  return names
    .map((n) => /^Starstation-Setup-(.+)\.exe$/i.exec(n)?.[1])
    .filter((v): v is string => !!v && compareVersions(v, version()) < 0)
    .sort((a, b) => compareVersions(b, a))
    .slice(0, KEEP_PREVIOUS)
}

export function updateState(): UpdateState {
  const tester = isTester()
  const cur = releases?.find((r) => r.tag_name.replace(/^v/i, '') === version())
  return {
    ...(app.isPackaged || process.env.STARSTATION_GITHUB_API ? state : { status: 'dev' as const }),
    channel: tester ? 'beta' : 'everyone',
    tester,
    previous: previousVersions(),
    skipped: skipped(),
    canRelease: tester && !!cur?.prerelease
  }
}

/** Keep a copy of an installer (current + 3 older versions are kept, the rest removed). */
async function keepInstaller(file: string, v: string): Promise<void> {
  await fsp.mkdir(installersDir(), { recursive: true })
  const to = path.join(installersDir(), installerName(v))
  if (path.resolve(file).toLowerCase() !== to.toLowerCase()) await fsp.copyFile(file, to)
  const all = (await fsp.readdir(installersDir()))
    .map((n) => /^Starstation-Setup-(.+)\.exe$/i.exec(n)?.[1])
    .filter((x): x is string => !!x)
    .sort((a, b) => compareVersions(b, a))
  // keep everything newer than the running version (a downloaded update) + the running one + 3 older
  const cur = version()
  const older = all.filter((x) => compareVersions(x, cur) < 0)
  for (const old of older.slice(KEEP_PREVIOUS)) await fsp.rm(path.join(installersDir(), installerName(old)), { force: true })
  log.info(`kept installer ${v}`)
}

/**
 * #37 a kept installer is only used when it looks whole: there, a Windows program ("MZ"), and not cut short
 * (a real one is well over 50 MB). Exported for tests.
 */
export function installerLooksWhole(file: string): boolean {
  try {
    const st = fs.statSync(file)
    if (!st.isFile() || st.size < MIN_INSTALLER_BYTES) return false
    const head = Buffer.alloc(2)
    const fd = fs.openSync(file, 'r')
    try {
      fs.readSync(fd, head, 0, 2, 0)
    } finally {
      fs.closeSync(fd)
    }
    return head[0] === 0x4d && head[1] === 0x5a
  } catch {
    return false
  }
}
const MIN_INSTALLER_BYTES = Number(process.env.STARSTATION_TEST_MIN_INSTALLER ?? 50 * 1024 * 1024)

/** Download a version's installer from its GitHub release into the keep folder. */
async function fetchInstaller(v: string): Promise<string> {
  const to = path.join(installersDir(), installerName(v))
  if (installerLooksWhole(to)) return to
  if (fs.existsSync(to)) {
    log.warn(`kept installer ${v} is damaged; downloading it again`)
    await fsp.rm(to, { force: true })
  }
  // streamed to disk (about 230 MB: never all in memory)
  await fsp.mkdir(installersDir(), { recursive: true })
  try {
    await download(`${downloadsBase()}/v${v}/${installerName(v)}`, `${to}.part`)
    // an installer starts with "MZ"; anything else is an error page
    const head = Buffer.alloc(2)
    const fh = await fsp.open(`${to}.part`, 'r')
    await fh.read(head, 0, 2, 0).finally(() => fh.close())
    if (head[0] !== 0x4d || head[1] !== 0x5a) throw new Error(`Installer ${v} is not a program`)
  } catch (e) {
    await fsp.rm(`${to}.part`, { force: true })
    throw e
  }
  await fsp.rename(`${to}.part`, to)
  await keepInstaller(to, v)
  return to
}

/**
 * Install another version: silent NSIS install into the same folder, then it starts itself
 * (--force-run). Starstation quits so the installer can replace it. Hidden tests only note the call.
 */
async function runInstaller(v: string, why: string): Promise<{ ok: boolean; error?: string }> {
  const exe = path.join(installersDir(), installerName(v))
  // #37 a damaged copy is fetched again; if that fails too, Starstation stays as it is
  if (!installerLooksWhole(exe)) {
    try {
      await fetchInstaller(v)
    } catch (e) {
      log.error(`installer ${v} is damaged and could not be downloaded again`, e)
    }
    if (!installerLooksWhole(exe)) return { ok: false, error: `The installer for ${v} is damaged or missing. Nothing was changed.` }
  }
  log.info(`installing ${v} (${why}): ${exe}`)
  if (HEADLESS) {
    const runs = readJson<{ version: string; why: string; args: string[] }[]>(updatesDir('test-runs.json'), [])
    writeJson(updatesDir('test-runs.json'), [...runs, { version: v, why, args: ['/S', '--force-run'] }])
  } else {
    // quit only once Windows has really started it: an installer that can't start leaves Starstation open
    const started = await new Promise<Error | null>((resolve) => {
      const p = spawn(exe, ['/S', '--force-run'], { detached: true, stdio: 'ignore' })
      p.once('spawn', () => resolve(null))
      p.once('error', (e) => resolve(e))
      p.unref()
    })
    if (started) {
      log.error(`installer ${v} could not start`, started)
      return { ok: false, error: `The installer for ${v} could not start (${started.message}). Starstation stays as it is.` }
    }
  }
  endSession() // leaving on purpose: not a crash
  setTimeout(() => app.exit(0), 500)
  return { ok: true }
}

/** Settings → About → Undo update. */
export async function undoUpdate(to: string): Promise<{ ok: boolean; error?: string }> {
  if (!previousVersions().includes(to)) return { ok: false, error: `Version ${to} is not kept on this PC.` }
  const r = await runInstaller(to, 'undo update')
  if (r.ok) writeJson(updatesDir('skip.json'), { skip: version(), at: new Date().toISOString() })
  return r
}

/**
 * Started after an update and it crashed twice in a row since: go back to the version before.
 * Runs before the window opens. true = the old version is being installed, stop starting.
 */
export async function maybeRescue(info: StartInfo): Promise<boolean> {
  const cur = version()
  const prev = info.previousVersion
  if (info.crashesInARow < 2 || !info.neverClean || !prev || compareVersions(prev, cur) >= 0) return false
  try {
    if (!previousVersions().includes(prev)) await Promise.race([fetchInstaller(prev), new Promise((_r, rej) => setTimeout(() => rej(new Error('timeout')), 60_000))])
  } catch (e) {
    log.error(`rescue: no installer for ${prev}`, e)
    return false
  }
  log.warn(`rescue: ${cur} crashed ${info.crashesInARow} times right after updating, going back to ${prev}`)
  writeJson(updatesDir('rescued.json'), { from: cur, to: prev, at: new Date().toISOString(), shown: false })
  writeJson(updatesDir('skip.json'), { skip: cur, at: new Date().toISOString() })
  const r = await runInstaller(prev, 'rescue')
  if (!r.ok) {
    // the old version can't be put back: keep starting this one rather than leaving nothing
    log.error(`rescue to ${prev} not possible: ${r.error}`)
    fs.rmSync(updatesDir('rescued.json'), { force: true })
    return false
  }
  return true
}

/** After a rescue: the old version shows what happened (once). */
export function takeRescueNote(): { from: string; to: string } | undefined {
  const n = readJson<{ from?: string; to?: string; shown?: boolean } | null>(updatesDir('rescued.json'), null)
  if (!n?.from || !n.to || n.shown || n.to !== version()) return undefined
  writeJson(updatesDir('rescued.json'), { ...n, shown: true })
  return { from: n.from, to: n.to }
}

/** First start of a new version? (for What's new). Remembers the version for next time. */
export function takeNewVersion(): { from: string } | null {
  const f = updatesDir('state.json')
  const st = readJson<{ lastVersion?: string }>(f, {})
  const cur = version()
  writeJson(f, { ...st, lastVersion: cur })
  return st.lastVersion && st.lastVersion !== cur ? { from: st.lastVersion } : null
}

/** Tester: make the running beta a normal release, so everyone else updates to it. */
export async function releaseToEveryone(): Promise<{ ok: boolean; error?: string; already?: boolean }> {
  if (!getSecrets().github?.token) return { ok: false, error: 'Only the tester PC can release versions.' }
  const v = version()
  try {
    const rel = await github<{ id: number; prerelease: boolean }>(`/repos/${OWNER}/${REPO}/releases/tags/v${v}`)
    if (!rel.prerelease) return { ok: true, already: true }
    await github(`/repos/${OWNER}/${REPO}/releases/${rel.id}`, { method: 'PATCH', body: { prerelease: false, make_latest: 'true' } })
    log.info(`released ${v} to everyone`)
    await loadReleases().catch(() => undefined)
    return { ok: true }
  } catch (e) {
    log.error('release to everyone failed', e)
    return { ok: false, error: (e as Error).message }
  }
}

let wired = false
function wireUpdater(notify: (n: Omit<Notice, 'id'>) => void): void {
  if (wired) return
  wired = true
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = true // Starstation chooses the release itself (pickRelease)
  autoUpdater.disableWebInstaller = true
  autoUpdater.logger = { info: (m: unknown) => log.info(String(m)), warn: (m: unknown) => log.warn(String(m)), error: (m: unknown) => log.error(String(m)), debug: () => undefined }
  autoUpdater.on('update-downloaded', (i) => {
    state = { status: 'ready', version: i.version }
    void keepInstaller(i.downloadedFile, i.version).catch((e) => log.warn('could not keep the installer', e))
    // the next update only downloads what changed: the updater compares against installer.exe in its cache
    // folder, using current.blockmap next to it (it has just put the new version's blockmap there)
    void fsp
      .copyFile(i.downloadedFile, path.join(updaterCache(), 'installer.exe'))
      .then(() => fsp.writeFile(path.join(updaterCache(), INSTALLER_VERSION), i.version))
      .catch((e) => log.warn('could not keep the installer for smaller updates', e))
    notify({ kind: 'update', title: 'Starstation update ready', detail: `Version ${i.version} is used from the next start.` })
  })
  autoUpdater.on('error', (e) => {
    state = { status: 'error', error: e.message }
    log.warn('update failed', e)
  })
}

/** Look for a newer version for this PC and download it in the background. */
export async function checkNow(notify: (n: Omit<Notice, 'id'>) => void = () => undefined): Promise<UpdateState> {
  if (!app.isPackaged && !process.env.STARSTATION_GITHUB_API) return updateState()
  if (state.status === 'downloading' || state.status === 'ready') return updateState()
  state = { status: 'checking' }
  try {
    const list = await loadReleases()
    const target = pickRelease(list, version(), isTester(), skipped())
    if (!target) {
      state = { status: 'latest', version: version() }
      return updateState()
    }
    state = { status: 'downloading', version: target }
    if (app.isPackaged && !HEADLESS) {
      wireUpdater(notify)
      // versions are plain numbers (1.9.1, 2.0.0): every release has latest.yml, so v1 PCs can update too
      // GitHub's download server answers 501 to a request for several byte ranges at once, which made every
      // smaller (differential) update fall back to the full installer: ask for one range at a time
      autoUpdater.setFeedURL({ provider: 'generic', url: `${downloadsBase()}/v${target}`, channel: 'latest', useMultipleRangeRequest: false })
      void autoUpdater.checkForUpdates().catch((e) => {
        state = { status: 'error', error: (e as Error).message }
        log.warn('update download failed', e)
      })
    }
  } catch (e) {
    state = { status: 'error', error: (e as Error).message }
    log.warn('update check failed', e)
  }
  return updateState()
}

/** At start: check for updates, and make sure the running version's installer is kept (for Undo update). */
/** The running version's installer as the updater's installer.exe, so updates only download what changed. */
// installer.exe and current.blockmap in the updater's cache must describe the same version, else the smaller
// download can't be put together (the result fails its checksum and the full installer is downloaded)
async function seedDifferential(): Promise<void> {
  const cache = updaterCache()
  const kept = path.join(installersDir(), installerName(version()))
  if (!fs.existsSync(kept)) return
  const target = path.join(cache, 'installer.exe')
  const marker = path.join(cache, INSTALLER_VERSION)
  const has = fs.existsSync(marker) ? (await fsp.readFile(marker, 'utf8')).trim() : ''
  if (has === version() && fs.existsSync(target)) return
  await fsp.mkdir(cache, { recursive: true })
  // the blockmap of another version: without it the updater downloads this version's blockmap from GitHub
  await fsp.rm(path.join(cache, 'current.blockmap'), { force: true })
  await fsp.copyFile(kept, target)
  await fsp.writeFile(marker, version())
  log.info(`installer ${version()} ready for smaller updates`)
}

export function startUpdater(notify: (n: Omit<Notice, 'id'>) => void, busy: () => boolean = () => false): void {
  if (!app.isPackaged || HEADLESS) return
  void seedDifferential().catch((e) => log.warn('could not prepare smaller updates', e))
  setTimeout(() => void checkNow(notify), 8000)
  // left running like a console for days: look again every 6 hours (not during a game)
  setInterval(() => {
    if (!busy()) void checkNow(notify)
  }, 6 * 3600_000).unref()
  setTimeout(
    () =>
      void fetchInstaller(version())
        .then(() => seedDifferential())
        .catch((e) => log.warn(`could not keep installer ${version()}`, e)),
    30_000
  )
}
