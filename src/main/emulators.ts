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

import type { EmulatorInfo } from '../shared/types'

const log = logger('emulators')

interface Marker {
  version?: string
  asset?: string
  source?: string
  installedAt?: string
}

const latestCache = new Map<string, { at: number; tag: string; url: string; name: string } | null>()

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
    return {
      id: e.id,
      name: e.name,
      installed,
      version,
      latest,
      updateAvailable: !!(installed && latest && version && !isCurrent(version, latest, m.asset, l?.name)),
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
  if (/latest|continuous|nightly/i.test(latestTag)) return true
  return false
}

async function getJson<T>(url: string): Promise<T> {
  const r = await net.fetch(url, { headers: { 'User-Agent': 'Starstation', Accept: 'application/vnd.github+json' } })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return (await r.json()) as T
}

/** Ask GitHub for the newest release of each emulator (cached for an hour). */
export async function checkUpdates(): Promise<EmulatorInfo[]> {
  for (const e of usedEmulators()) {
    const d = e.download
    if (d?.type !== 'github') continue
    const c = latestCache.get(e.id)
    if (c && Date.now() - c.at < 3600_000) continue
    try {
      const rel = await getJson<{ tag_name: string; assets: { name: string; browser_download_url: string }[] }>(
        `https://api.github.com/repos/${d.repo}/releases/latest`
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
  if (e.download?.type === 'github') {
    latestCache.delete(e.id)
    await checkUpdates()
    const l = latestCache.get(e.id)
    if (!l) throw new Error(`No ${e.name} download found on GitHub`)
    ;({ url, name } = l)
    version = l.tag.replace(/^v\.?/i, '')
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
  writeJson(path.join(emulatorDir(e), '.starstation.json'), { version, asset: name, source: url, installedAt: new Date().toISOString() })
  for (const c of allConsoles().filter((x) => x.emulator === e.id)) applyConsoleConfig(c)
  log.info(`installed ${e.id} ${version}`)
  return emulatorInfos().find((x) => x.id === id)!
}
