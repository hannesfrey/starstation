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
import { renameRetry } from './fsutil'

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
    // a fixed download (Dolphin, RetroArch): the version in the preset, offered when the installed one is older
    // (never a step back, and an unknown imported version isn't nagged about)
    const fixed = e.download?.type === 'url' ? e.download.version : null
    const latest = l?.tag ?? fixed ?? null
    const version = installed ? (m.version ?? 'unknown') : null
    const tested = testedTag(e)
    const current = fixed
      ? !version || version === 'unknown' || version.localeCompare(fixed, undefined, { numeric: true, sensitivity: 'base' }) >= 0
      : !!(version && latest && isCurrent(version, latest, m.asset, l?.name))
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
  const code = lower.endsWith('.zip') || lower.endsWith('.rar') ? await tarUnpack(archive, to) : await run(sevenZip(), ['x', '-y', `-o${to}`, archive])
  if (code !== 0) {
    await fsp.rm(to, { recursive: true, force: true })
    throw new Error(`Extracting ${path.basename(archive)} failed (code ${code})`)
  }
}

export const tarExe = (): string => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')

/**
 * Windows' tar reads its command line in the PC's old code page: a path with characters outside it (a Japanese,
 * Greek or Cyrillic user name) can't reach it, and every .zip / .rar failed to unpack on such a PC. So tar runs
 * inside a work folder with plain names only — the archive as archive.<ext> (a hard link, or a copy on another
 * drive), unpacked into "x" — and what it unpacked is moved into place.
 */
async function tarUnpack(archive: string, to: string): Promise<number> {
  const work = `${to}.tar-${Date.now()}`
  const name = `archive${path.extname(archive).toLowerCase()}`
  await fsp.mkdir(path.join(work, 'x'), { recursive: true })
  try {
    await fsp.link(archive, path.join(work, name)).catch(() => fsp.copyFile(archive, path.join(work, name)))
    const code = await run(tarExe(), ['-xf', name, '-C', 'x'], work)
    if (code !== 0) return code
    for (const n of await fsp.readdir(path.join(work, 'x'))) await renameRetry(path.join(work, 'x', n), path.join(to, n))
    return 0
  } finally {
    await fsp.rm(work, { recursive: true, force: true })
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

export interface DownloadOptions {
  /** No data for this long: the download is given up (default 60 s) instead of hanging for ever. */
  stallMs?: number
  /** Extra tries after a dropped connection (default 2). HTTP errors (404…) and disk errors are not tried again. */
  retries?: number
  /** Tests: a fetch stand-in. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>
}

class HttpError extends Error {}

/**
 * Download to a file without holding it in memory (mods and emulators can be gigabytes). #11: the data goes to
 * "<file>.part" and gets its real name only when complete; a stalled connection is given up after a minute; a
 * write error (disk full) stops it at once; a dropped connection is tried again. Nothing half-written is left.
 */
export async function download(url: string, file: string, onProgress?: (done: number, total: number) => void, opts: DownloadOptions = {}): Promise<void> {
  const tries = 1 + (opts.retries ?? 2)
  for (let i = 1; ; i++) {
    try {
      return await downloadOnce(url, file, onProgress, opts)
    } catch (e) {
      const disk = !!(e as NodeJS.ErrnoException).code
      if (i >= tries || e instanceof HttpError || disk) throw e
      log.warn(`download ${path.basename(file)} dropped (${(e as Error).message}); try ${i + 1} of ${tries}`)
      await new Promise((r) => setTimeout(r, 1000 * i))
    }
  }
}

async function downloadOnce(url: string, file: string, onProgress: ((done: number, total: number) => void) | undefined, opts: DownloadOptions): Promise<void> {
  const stallMs = opts.stallMs ?? 60_000
  const ctl = new AbortController()
  let timer: NodeJS.Timeout | undefined
  const stalled = () => {
    clearTimeout(timer)
    timer = setTimeout(() => ctl.abort(new Error(`The download stopped (no data for ${Math.round(stallMs / 1000)} s). Try again.`)), stallMs)
  }
  const part = `${file}.part`
  await fsp.mkdir(path.dirname(file), { recursive: true })
  let out: fs.WriteStream | null = null
  try {
    stalled()
    const doFetch = opts.fetch ?? ((u: string, init: RequestInit) => net.fetch(u, init))
    const r = await doFetch(url, { headers: { 'User-Agent': 'Starstation' }, signal: ctl.signal })
    if (!r.ok || !r.body) throw new HttpError(`Download failed: HTTP ${r.status}`)
    const total = Number(r.headers.get('content-length') ?? 0)
    out = fs.createWriteStream(part)
    let writeError: Error | null = null
    out.on('error', (err) => {
      writeError = err
      ctl.abort(err)
    })
    let done = 0
    const reader = r.body.getReader()
    ctl.signal.addEventListener('abort', () => void reader.cancel().catch(() => undefined), { once: true })
    for (;;) {
      const { done: end, value } = await reader.read()
      if (ctl.signal.aborted) throw ctl.signal.reason
      if (end) break
      stalled()
      done += value.length
      if (!out.write(value)) await new Promise<void>((res) => out!.once('drain', () => res()).once('error', () => res()))
      if (writeError) throw writeError
      onProgress?.(done, total)
    }
    const o = out
    await new Promise<void>((res, rej) => o.end((err?: Error | null) => (err ? rej(err) : res())))
    if (writeError) throw writeError
    // a connection that ended early without an error: never unpack half a file
    if (total && done !== total) throw new Error(`Download incomplete (${done} of ${total} bytes). Try again.`)
    await fsp.rm(file, { force: true })
    await renameRetry(part, file)
  } catch (e) {
    if (out && !out.closed) await new Promise<void>((res) => out!.destroy().once('close', () => res()))
    await fsp.rm(part, { force: true }).catch(() => undefined)
    throw ctl.signal.aborted && ctl.signal.reason instanceof Error ? ctl.signal.reason : e
  } finally {
    clearTimeout(timer)
  }
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

/** Where the program files an update replaced are kept (one generation per emulator), to put them back by hand. */
export const previousDir = (e: EmulatorPreset) => dir('config', 'emulator-previous', e.id)

/**
 * #12: unpack into a separate folder, check the program is there, then move the new files in. The files they
 * replace move to config\emulator-previous\<id> first; if anything fails half-way, they are put back, so the
 * old version keeps working. Settings, saves and everything else the archive doesn't contain stay untouched.
 */
export async function installStaged(e: EmulatorPreset, archive: string): Promise<void> {
  const live = emulatorDir(e)
  const stage = `${live}.new-${Date.now()}`
  try {
    await extract(archive, stage)
    const exeRel = path.relative(live, emulatorExe(e))
    if (!path.isAbsolute(e.exe) && !fs.existsSync(path.join(stage, exeRel)))
      throw new Error(`The download doesn't contain ${path.basename(e.exe)}. Nothing was changed; ${e.name} stays as it was.`)
    const files: string[] = []
    const walk = async (d: string, rel = ''): Promise<void> => {
      for (const ent of await fsp.readdir(d, { withFileTypes: true })) {
        const r = rel ? path.join(rel, ent.name) : ent.name
        if (ent.isDirectory()) await walk(path.join(d, ent.name), r)
        else files.push(r)
      }
    }
    await walk(stage)
    const prev = previousDir(e)
    await fsp.rm(prev, { recursive: true, force: true })
    const moved: { rel: string; hadOld: boolean }[] = []
    try {
      for (const rel of files) {
        const dst = path.join(live, rel)
        const hadOld = fs.existsSync(dst)
        if (hadOld) {
          await fsp.mkdir(path.dirname(path.join(prev, rel)), { recursive: true })
          await renameRetry(dst, path.join(prev, rel))
        }
        moved.push({ rel, hadOld })
        await fsp.mkdir(path.dirname(dst), { recursive: true })
        await renameRetry(path.join(stage, rel), dst)
      }
    } catch (err) {
      // put the old version back exactly as it was
      log.error(`${e.id}: update stopped half-way, putting the old files back`, err)
      for (const { rel, hadOld } of moved.reverse()) {
        const dst = path.join(live, rel)
        await fsp.rm(dst, { force: true }).catch(() => undefined)
        if (hadOld) await renameRetry(path.join(prev, rel), dst).catch((x) => log.error(`could not put back ${rel}`, x))
      }
      throw new Error(`${e.name} could not be updated (${(err as Error).message}). The old version was kept.`)
    }
  } finally {
    await fsp.rm(stage, { recursive: true, force: true })
  }
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
  await installStaged(e, dl)
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
