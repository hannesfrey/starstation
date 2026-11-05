import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { net } from 'electron'
import { dir } from './paths'
import { readJson, writeJson } from './store'
import { emulatorDir, emulatorExe, getEmulator } from './presets'
import { logger } from './log'

/**
 * Community patch collections (SPEC-v2 E): widescreen / 60 fps / fixes, updated only when the user presses
 * "Update patches" (Settings → Mod sources). Every download is checked against the hash its source publishes.
 * - PCSX2: the patches.zip of the official PCSX2/pcsx2_patches release → <pcsx2>\resources\patches.zip
 * - RPCS3: patch.yml from RPCS3's own patch service → <rpcs3>\patches\patch.yml
 * - Dolphin ships its game patches inside Dolphin itself (they come with Dolphin updates).
 */

const log = logger('patchsets')
const stateFile = () => dir('config', 'patches.json')
const ghApi = () => process.env.STARSTATION_GITHUB_API ?? 'https://api.github.com'
const rpcs3Url = () => process.env.STARSTATION_RPCS3_PATCH ?? 'https://rpcs3.net/compatibility?patch&api=v1&v=1.2'
const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex')

export interface PatchStatus {
  pcsx2?: string
  rpcs3?: string
}

export function patchStatus(): PatchStatus {
  return readJson<PatchStatus>(stateFile(), {})
}

async function get(url: string): Promise<Response> {
  const r = await net.fetch(url, { headers: { 'User-Agent': 'Starstation', Accept: 'application/vnd.github+json, application/json, */*' } })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r
}

async function pcsx2(): Promise<string> {
  const e = getEmulator('pcsx2')
  if (!e || !fs.existsSync(emulatorExe(e))) return 'PCSX2 is not installed'
  const rel = (await (await get(`${ghApi()}/repos/PCSX2/pcsx2_patches/releases/latest`)).json()) as { assets: { name: string; browser_download_url: string; digest?: string }[] }
  const a = rel.assets.find((x) => x.name === 'patches.zip')
  if (!a) throw new Error('no patches.zip in the release')
  const buf = Buffer.from(await (await get(a.browser_download_url)).arrayBuffer())
  if (a.digest && a.digest !== `sha256:${sha256(buf)}`) throw new Error('patches.zip does not match its published hash')
  const to = path.join(emulatorDir(e), 'resources', 'patches.zip')
  await fsp.mkdir(path.dirname(to), { recursive: true })
  await fsp.writeFile(`${to}.new`, buf)
  await fsp.rename(`${to}.new`, to)
  return 'PCSX2 patches updated'
}

async function rpcs3(): Promise<string> {
  const e = getEmulator('rpcs3')
  if (!e || !fs.existsSync(emulatorExe(e))) return 'RPCS3 is not installed'
  const j = (await (await get(rpcs3Url())).json()) as { return_code?: number; sha256?: string; patch?: string }
  if (j.return_code !== 0 || !j.patch) throw new Error('no patch file from RPCS3')
  if (j.sha256 && j.sha256.toLowerCase() !== sha256(j.patch)) throw new Error('patch.yml does not match its published hash')
  const to = path.join(emulatorDir(e), 'patches', 'patch.yml')
  await fsp.mkdir(path.dirname(to), { recursive: true })
  await fsp.writeFile(`${to}.new`, j.patch)
  await fsp.rename(`${to}.new`, to)
  return 'RPCS3 patches updated'
}

/** "Update patches": each collection on its own (one failing doesn't stop the other). */
export async function updatePatches(): Promise<{ done: string[]; errors: string[] }> {
  const done: string[] = []
  const errors: string[] = []
  const st = patchStatus()
  for (const [id, fn] of [
    ['pcsx2', pcsx2],
    ['rpcs3', rpcs3]
  ] as const) {
    try {
      const msg = await fn()
      done.push(msg)
      if (msg.endsWith('updated')) st[id] = new Date().toISOString()
    } catch (err) {
      log.warn(`${id} patches`, err)
      errors.push(`${id === 'pcsx2' ? 'PCSX2' : 'RPCS3'}: ${(err as Error).message}`)
    }
  }
  writeJson(stateFile(), st)
  return { done, errors }
}
