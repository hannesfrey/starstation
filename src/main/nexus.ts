import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app, net } from 'electron'
import { dir } from './paths'
import { getSecrets } from './settings'
import { logger } from './log'
import type { NexusRequest } from '../shared/types'

/**
 * Nexus Mods (SPEC-v2 E). The user clicks "Download with mod manager" on nexusmods.com; Windows hands
 * Starstation an nxm:// link (Starstation registers itself for nxm:// in the user's part of the registry,
 * which Hannes allowed). With the user's own free API key (secrets.json → nexus.apiKey) Starstation asks
 * Nexus for the download, then the user picks the game and it is installed like any other mod.
 */

const log = logger('nexus')
const API = () => process.env.STARSTATION_NEXUS_API ?? 'https://api.nexusmods.com/v1'

export function nexusKey(): string | null {
  return getSecrets().nexus?.apiKey?.trim() || null
}

/** Make nxm:// links open Starstation (installed version only; dev runs don't register). */
export function registerNxm(): boolean {
  if (!app.isPackaged || process.env.STARSTATION_HEADLESS === '1' || !nexusKey()) return false
  if (app.isDefaultProtocolClient('nxm')) return true
  const ok = app.setAsDefaultProtocolClient('nxm')
  log.info(`nxm:// handler ${ok ? 'registered' : 'could not be registered'}`)
  return ok
}

/** nxm://<game>/mods/<mod>/files/<file>?key=…&expires=…&user_id=… */
export function parseNxm(url: string): { domain: string; mod: number; file: number; key?: string; expires?: string } | null {
  const m = /^nxm:\/\/([^/]+)\/mods\/(\d+)\/files\/(\d+)\/?(?:\?(.*))?$/i.exec(url.trim())
  if (!m) return null
  const q = new URLSearchParams(m[4] ?? '')
  return { domain: m[1].toLowerCase(), mod: Number(m[2]), file: Number(m[3]), key: q.get('key') ?? undefined, expires: q.get('expires') ?? undefined }
}

async function nexus<T>(p: string): Promise<T> {
  const key = nexusKey()
  if (!key) throw new Error('Add your Nexus Mods API key to secrets.json first (Settings → Games & emulators → Mod sources).')
  const r = await net.fetch(`${API()}${p}`, {
    signal: AbortSignal.timeout(30_000),
    headers: { apikey: key, 'Application-Name': 'Starstation', 'Application-Version': app.getVersion(), Accept: 'application/json' }
  })
  if (r.status === 401) throw new Error('Nexus Mods did not accept the API key in secrets.json.')
  if (r.status === 403) throw new Error('Nexus Mods wants this download to start from the website’s “Download with mod manager” button.')
  if (!r.ok) throw new Error(`Nexus Mods: HTTP ${r.status}`)
  return (await r.json()) as T
}

/** What a link points at (name, picture, game), for the "Which game is this for?" question. */
export async function describeNxm(url: string): Promise<NexusRequest> {
  const l = parseNxm(url)
  if (!l) throw new Error('That is not a Nexus Mods download link.')
  const [mod, game, files] = await Promise.all([
    nexus<{ name?: string; summary?: string; picture_url?: string }>(`/games/${l.domain}/mods/${l.mod}.json`),
    nexus<{ name?: string }>(`/games/${l.domain}.json`).catch(() => ({ name: l.domain })),
    nexus<{ files?: { file_id: number; name?: string; file_name?: string }[] }>(`/games/${l.domain}/mods/${l.mod}/files.json`).catch(() => ({ files: [] as { file_id: number; name?: string; file_name?: string }[] }))
  ])
  const f = files.files?.find((x) => x.file_id === l.file)
  return { url, modName: mod.name ?? `Mod ${l.mod}`, summary: mod.summary?.replace(/<[^>]+>/g, '').slice(0, 300), picture: mod.picture_url, gameName: game.name ?? l.domain, fileName: f?.file_name ?? f?.name }
}

/** Download the file of an nxm:// link into Files\config\downloads. */
export async function downloadNxm(url: string, onProgress?: (pct: number) => void): Promise<string> {
  const l = parseNxm(url)
  if (!l) throw new Error('That is not a Nexus Mods download link.')
  const q = l.key && l.expires ? `?key=${encodeURIComponent(l.key)}&expires=${encodeURIComponent(l.expires)}` : ''
  const links = await nexus<{ URI: string; name?: string }[]>(`/games/${l.domain}/mods/${l.mod}/files/${l.file}/download_link.json${q}`)
  const uri = links[0]?.URI
  if (!uri) throw new Error('Nexus Mods gave no download for this file.')
  const name = decodeURIComponent(path.basename(new URL(uri).pathname)) || `nexus-${l.mod}-${l.file}.zip`
  const to = dir('config', 'downloads', name.replace(/[\\/:*?"<>|]/g, '_'))
  const r = await net.fetch(uri, { headers: { 'User-Agent': 'Starstation' } })
  if (!r.ok || !r.body) throw new Error(`Download failed: HTTP ${r.status}`)
  const total = Number(r.headers.get('content-length') ?? 0)
  await fsp.mkdir(path.dirname(to), { recursive: true })
  const out = fs.createWriteStream(to)
  const reader = r.body.getReader()
  let done = 0
  for (;;) {
    const { done: end, value } = await reader.read()
    if (end) break
    done += value.length
    if (!out.write(value)) await new Promise<void>((res) => out.once('drain', () => res()))
    if (total) onProgress?.(Math.round((done / total) * 100))
  }
  await new Promise<void>((res, rej) => out.end((err?: Error | null) => (err ? rej(err) : res())))
  log.info(`downloaded ${url} → ${to}`)
  return to
}

/** The nxm:// link in a command line (Windows starts Starstation with it). */
export function nxmFromArgs(argv: string[]): string | null {
  return argv.find((a) => /^nxm:\/\//i.test(a)) ?? null
}
