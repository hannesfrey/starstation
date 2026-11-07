import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { net } from 'electron'
import { allConsoles, allEmulators, emulatorDir, emulatorExe, getEmulator, type EmulatorPreset } from './presets'
import { applyConsoleConfig } from './emuconfig'
import { binDir, dir } from './paths'
import { readJson, writeJson } from './store'
import { logger } from './log'
import { getSecrets, isTester } from './settings'
import { versionFromAsset } from './formats/version'

import type { EmulatorInfo } from '../shared/types'

const log = logger('emulators')

interface Marker {
  version?: string
  /** GitHub release tag it came from (installs since v2). */
  tag?: string
  asset?: string
  source?: string
  installedAt?: string
}

/** The release Starstation offers for each emulator: newest (tester PC) or the tested one (everyone else). */
const latestCache = new Map<string, { at: number; tag: string; url: string; name: string } | null>()

/**
 * Tested emulator versions (SPEC-v2 B). Everyone gets the tested release; the tester PC gets the newest
 * and can mark it as tested. The shared list lives in the Starstation repo (tested-emulators.json on main),
 * so a version Hannes marks reaches the other PCs without a Starstation update; presets carry a fallback.
 */
const OWNER = 'hannesfrey'
const REPO = 'starstation'
const TESTED_FILE = 'tested-emulators.json'
const rawBase = () => process.env.STARSTATION_GITHUB_RAW ?? `https://raw.githubusercontent.com/${OWNER}/${REPO}/main`
const ghApi = () => process.env.STARSTATION_GITHUB_API ?? 'https://api.github.com'
let testedCache: { at: number; list: Record<string, string> } | null = null

async function remoteTested(): Promise<Record<string, string>> {
  if (testedCache && Date.now() - testedCache.at < 3600_000) return testedCache.list
  try {
    const r = await net.fetch(`${rawBase()}/${TESTED_FILE}?t=${Date.now()}`, { signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'Starstation' } })
    const list = r.ok ? ((await r.json()) as { emulators?: Record<string, string> }).emulators ?? {} : {}
    testedCache = { at: Date.now(), list }
  } catch (e) {
    log.warn('could not read the tested emulator list', e)
    testedCache = { at: Date.now() - 3000_000, list: testedCache?.list ?? {} } // try again in 10 minutes
  }
  return testedCache.list
}

function testedTag(e: EmulatorPreset): string | undefined {
  if (e.download?.type !== 'github') return undefined
  return testedCache?.list[e.id] ?? e.download.tested
}

function marker(e: EmulatorPreset): Marker {
  return readJson<Marker>(path.join(emulatorDir(e), '.starstation.json'), {})
}

function usedEmulators(): EmulatorPreset[] {
  const ids = new Set(allConsoles().map((c) => c.emulator))
  return allEmulators().filter((e) => ids.has(e.id) && !path.isAbsolute(e.folder))
}

export function emulatorInfos(): EmulatorInfo[] {
  return usedEmulators().map((e) => {
    const m = marker(e)
    const installed = fs.existsSync(emulatorExe(e))
    const l = latestCache.get(e.id)
    const latest = l?.tag ?? null
    const version = installed ? (m.version ?? 'unknown') : null
    const tested = testedTag(e)
    const current = !!(version && latest && isCurrent(version, latest, m.asset, l?.name))
    return {
      id: e.id,
      name: e.name,
      installed,
      version,
      latest,
      updateAvailable: !!(installed && latest && version && !current),
      tested,
      // tester PC, newest installed, not the tested one yet
      untested: !!(isTester() && installed && tested && m.tag && m.tag !== tested && !/latest|continuous|nightly/i.test(tested)),
      consoles: allConsoles()
        .filter((c) => c.emulator === e.id)
        .map((c) => c.short),
      canInstall: e.download?.type === 'github' || e.download?.type === 'url',
      page: e.download?.type === 'page' ? e.download.page : undefined
    }
  })
}

function norm(v: string): string {
  return v.replace(/^v\.?/i, '').trim().toLowerCase()
}

/** Up to date if the release file name or the version tag matches. Rolling "latest" tags can't be compared: never nag. */
function isCurrent(installed: string, latestTag: string, asset: string | undefined, latestAsset: string | undefined): boolean {
  if (asset && latestAsset && asset === latestAsset && !/latest|continuous|nightly/i.test(latestTag)) return true
  if (norm(installed) === norm(latestTag)) return true
  // tags like "build-<commit>" (RPCS3): the version is in the file name
  const fromAsset = latestAsset ? versionFromAsset(latestAsset) : null
  if (fromAsset && norm(installed) === norm(fromAsset)) return true
  if (/latest|continuous|nightly/i.test(latestTag)) return true
  return false
}

async function getJson<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  // the tester's GitHub login raises the rate limit (and is needed to mark versions as tested)
  const token = isTester() ? getSecrets().github?.token : undefined
  const r = await net.fetch(url, {
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
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return (await r.json()) as T
}

/** Ask GitHub for the release to offer for each emulator (cached for an hour): newest on the tester PC, tested elsewhere. */
export async function checkUpdates(): Promise<EmulatorInfo[]> {
  await remoteTested()
  for (const e of usedEmulators()) {
    const d = e.download
    if (d?.type !== 'github') continue
    const c = latestCache.get(e.id)
    if (c && Date.now() - c.at < 3600_000) continue
    const tested = testedTag(e)
    const which = isTester() || !tested ? 'latest' : `tags/${encodeURIComponent(tested)}`
    try {
      const rel = await getJson<{ tag_name: string; assets: { name: string; browser_download_url: string }[] }>(
        `${ghApi()}/repos/${d.repo}/releases/${which}`
      )
      const asset = rel.assets.find((a) => new RegExp(d.asset, 'i').test(a.name))
      if (asset) latestCache.set(e.id, { at: Date.now(), tag: rel.tag_name, url: asset.browser_download_url, name: asset.name })
    } catch (err) {
      log.warn(`update check failed for ${e.id}`, err)
    }
  }
  return emulatorInfos()
}

export function sevenZip(): string {
  return path.join(binDir(), '7zr.exe')
}

function run(exe: string, args: string[], cwd?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { cwd, windowsHide: true, stdio: 'ignore' })
    p.once('error', reject)
    p.once('exit', (code) => resolve(code ?? -1))
  })
}

/**
 * Unpack an archive into the folder `to` (created; removed again on failure). Both tools check the
 * archive's checksums and fail on a damaged or incomplete file.
 */
export async function unpack(archive: string, to: string): Promise<void> {
  await fsp.mkdir(to, { recursive: true })
  const lower = archive.toLowerCase()
  // Windows' tar (libarchive) reads zip and rar (4 and 5); 7z needs the bundled 7-Zip
  const code = lower.endsWith('.zip') || lower.endsWith('.rar')
    ? await run(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', archive, '-C', to])
    : await run(sevenZip(), ['x', '-y', `-o${to}`, archive])
  if (code !== 0) {
    await fsp.rm(to, { recursive: true, force: true })
    throw new Error(`Extracting ${path.basename(archive)} failed (code ${code})`)
  }
}

/** Extract an archive into `to`; if everything sits in one top folder, that folder is flattened. */
export async function extract(archive: string, to: string, opts: { flatten?: boolean } = {}): Promise<void> {
  const tmp = `${to}.extract-${Date.now()}`
  await unpack(archive, tmp)
  let root = tmp
  const ents = await fsp.readdir(tmp)
  if (opts.flatten !== false && ents.length === 1 && (await fsp.stat(path.join(tmp, ents[0]))).isDirectory()) root = path.join(tmp, ents[0])
  await fsp.mkdir(to, { recursive: true })
  await fsp.cp(root, to, { recursive: true, force: true })
  await fsp.rm(tmp, { recursive: true, force: true })
}

async function download(url: string, file: string, onProgress?: (done: number, total: number) => void): Promise<void> {
  const r = await net.fetch(url, { headers: { 'User-Agent': 'Starstation' } })
  if (!r.ok || !r.body) throw new Error(`Download failed: HTTP ${r.status}`)
  const total = Number(r.headers.get('content-length') ?? 0)
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const out = fs.createWriteStream(file)
  let done = 0
  const reader = r.body.getReader()
  for (;;) {
    const { done: end, value } = await reader.read()
    if (end) break
    done += value.length
    if (!out.write(value)) await new Promise<void>((res) => out.once('drain', () => res()))
    onProgress?.(done, total)
  }
  await new Promise<void>((res, rej) => out.end((err?: Error | null) => (err ? rej(err) : res())))
  // a connection that ended early without an error: never unpack half a file
  if (total && done !== total) throw new Error(`Download incomplete (${done} of ${total} bytes). Try again.`)
}

/** Install a RetroArch core from the official libretro buildbot. */
export async function installCore(core: string, onProgress?: (text: string) => void): Promise<void> {
  if (!/^[a-z0-9_]+$/i.test(core)) throw new Error(`Bad core name ${core}`)
  const ra = getEmulator('retroarch')
  if (!ra || !fs.existsSync(emulatorExe(ra))) throw new Error('RetroArch is not installed.')
  const url = `https://buildbot.libretro.com/nightly/windows/x86_64/latest/${core}_libretro.dll.zip`
  const dl = dir('config', 'downloads', `${core}_libretro.dll.zip`)
  onProgress?.(`Downloading ${core} core…`)
  await download(url, dl)
  await extract(dl, path.join(emulatorDir(ra), 'cores'))
  await fsp.rm(dl, { force: true })
  log.info(`installed core ${core}`)
}

/**
 * Install or update an emulator from its official source. Settings and data inside the emulator
 * folder are kept: new files overwrite program files only (archives don't contain user configs).
 */
export async function installEmulator(id: string, onProgress?: (text: string) => void): Promise<EmulatorInfo> {
  const e = getEmulator(id)
  if (!e) throw new Error(`Unknown emulator ${id}`)
  let url: string
  let name: string
  let version: string
  let tag: string | undefined
  if (e.download?.type === 'github') {
    latestCache.delete(e.id)
    await checkUpdates()
    const l = latestCache.get(e.id)
    if (!l) throw new Error(`No ${e.name} download found on GitHub`)
    ;({ url, name, tag } = l)
    // "build-<commit>" tags (RPCS3) and rolling tags: the file name has the real version
    version = /^build-|^latest$/i.test(l.tag) ? (versionFromAsset(l.name) ?? l.tag) : l.tag.replace(/^v\.?/i, '')
  } else if (e.download?.type === 'url') {
    url = e.download.url
    name = path.basename(new URL(url).pathname)
    version = e.download.version
  } else throw new Error(`${e.name} has to be downloaded by hand from its website.`)

  const dl = dir('config', 'downloads', name)
  log.info(`installing ${e.id} from ${url}`)
  onProgress?.(`Downloading ${e.name}…`)
  await download(url, dl, (d, t) => t && onProgress?.(`Downloading ${e.name}… ${Math.round((d / t) * 100)}%`))
  onProgress?.(`Installing ${e.name}…`)
  await extract(dl, emulatorDir(e))
  await fsp.rm(dl, { force: true })
  writeJson(path.join(emulatorDir(e), '.starstation.json'), { version, tag, asset: name, source: url, installedAt: new Date().toISOString() })
  for (const c of allConsoles().filter((x) => x.emulator === e.id)) applyConsoleConfig(c)
  log.info(`installed ${e.id} ${version}`)
  return emulatorInfos().find((x) => x.id === id)!
}

/**
 * Tester PC: the installed version works → it becomes the version everyone else gets.
 * Writes tested-emulators.json in the Starstation repo (GitHub contents API, the tester's login).
 */
export async function markTested(id: string): Promise<{ ok: boolean; error?: string }> {
  const e = getEmulator(id)
  if (!e || e.download?.type !== 'github') return { ok: false, error: 'This emulator has a fixed version.' }
  if (!isTester()) return { ok: false, error: 'Only the tester PC can mark versions as tested.' }
  const tag = marker(e).tag
  if (!tag) return { ok: false, error: 'Install or update it from Starstation first, so its version is known.' }
  try {
    const url = `${ghApi()}/repos/${OWNER}/${REPO}/contents/${TESTED_FILE}`
    let sha: string | undefined
    let list: Record<string, string> = {}
    try {
      const cur = await getJson<{ sha: string; content: string }>(url)
      sha = cur.sha
      list = (JSON.parse(Buffer.from(cur.content, 'base64').toString('utf8')) as { emulators?: Record<string, string> }).emulators ?? {}
    } catch {
      // first time: the file doesn't exist yet
    }
    list[id] = tag
    const body = JSON.stringify({ emulators: list, updatedAt: new Date().toISOString() }, null, 2) + '\n'
    await getJson(url, { method: 'PUT', body: { message: `Mark ${e.name} ${tag} as tested`, content: Buffer.from(body).toString('base64'), ...(sha ? { sha } : {}) } })
    testedCache = { at: Date.now(), list }
    latestCache.delete(id)
    log.info(`marked ${id} ${tag} as tested`)
    return { ok: true }
  } catch (err) {
    log.error(`mark tested ${id} failed`, err)
    return { ok: false, error: (err as Error).message }
  }
}
