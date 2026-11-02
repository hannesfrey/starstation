import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { net } from 'electron'
import { dir } from './paths'
import { addMod, modsRoot, setModImage, type AddModResult } from './mods'
import { logger } from './log'
import type { Game, GbFile, GbGame, GbMod, GbModDetails } from '../shared/types'

/** GameBanana's public API (no account needed). Starstation only downloads and unpacks files — it never runs them. */

const log = logger('gamebanana')
const API = 'https://gamebanana.com/apiv11'
// tests point this at a local fake server
const base = () => process.env.STARSTATION_GAMEBANANA_API || API

async function get<T>(url: string): Promise<T> {
  const r = await net.fetch(url, { headers: { 'User-Agent': 'Starstation', Accept: 'application/json' } })
  if (!r.ok) throw new Error(`GameBanana answered ${r.status}`)
  return (await r.json()) as T
}

interface Img {
  _sBaseUrl: string
  _sFile: string
  _sFile530?: string
  _sFile220?: string
}
const imgUrl = (i?: Img, size: '220' | '530' = '220') =>
  i ? `${i._sBaseUrl}/${(size === '530' ? i._sFile530 : i._sFile220) ?? i._sFile}` : undefined

export async function searchGames(name: string): Promise<GbGame[]> {
  const q = name.replace(/[^\w\s'&:-]/g, ' ').trim()
  const r = await get<{ _aRecords: { _idRow: number; _sName: string; _sIconUrl?: string }[] }>(
    `${base()}/Util/Game/NameMatch?_sName=${encodeURIComponent(q)}`
  )
  return r._aRecords.map((x) => ({ id: x._idRow, name: x._sName, icon: x._sIconUrl }))
}

export async function listGbMods(gameId: number, page = 1): Promise<{ mods: GbMod[]; more: boolean }> {
  const r = await get<{
    _aMetadata: { _bIsComplete: boolean }
    _aRecords: { _idRow: number; _sName: string; _sModelName: string; _bHasFiles?: boolean; _nDownloadCount?: number; _aPreviewMedia?: { _aImages?: Img[] } }[]
  }>(`${base()}/Mod/Index?_nPerpage=20&_nPage=${page}&_sSort=Generic_MostDownloaded&_aFilters%5BGeneric_Game%5D=${gameId}`)
  return {
    mods: r._aRecords
      .filter((x) => x._sModelName === 'Mod' && x._bHasFiles !== false)
      .map((x) => ({ id: x._idRow, name: x._sName, image: imgUrl(x._aPreviewMedia?._aImages?.[0]), downloads: x._nDownloadCount })),
    more: !r._aMetadata._bIsComplete
  }
}

function plain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function gbModDetails(id: number): Promise<GbModDetails> {
  const r = await get<{
    _sName: string
    _sText?: string
    _sDescription?: string
    _aPreviewMedia?: { _aImages?: Img[] }
    _aFiles?: { _idRow: number; _sFile: string; _nFilesize: number; _sDownloadUrl: string; _sMd5Checksum?: string; _sAvResult?: string; _sAnalysisResult?: string }[]
  }>(`${base()}/Mod/${id}?_csvProperties=_sName,_sText,_sDescription,_aPreviewMedia,_aFiles`)
  const files: GbFile[] = (r._aFiles ?? []).map((f) => ({
    id: f._idRow,
    name: f._sFile,
    size: f._nFilesize,
    url: f._sDownloadUrl,
    md5: f._sMd5Checksum,
    // only files GameBanana's virus scan passed, in a format Starstation can unpack
    ok: (f._sAvResult ?? 'clean') === 'clean' && /\.(zip|7z|rar)$/i.test(f._sFile)
  }))
  return {
    id,
    name: r._sName,
    text: plain(r._sText || r._sDescription || '').slice(0, 700),
    image: imgUrl(r._aPreviewMedia?._aImages?.[0], '530'),
    files
  }
}

async function download(url: string, to: string): Promise<void> {
  const r = await net.fetch(url, { headers: { 'User-Agent': 'Starstation' } })
  if (!r.ok || !r.body) throw new Error(`Download failed (${r.status})`)
  await fsp.mkdir(path.dirname(to), { recursive: true })
  await fsp.writeFile(to, Buffer.from(await r.arrayBuffer()))
}

export async function installGbMod(g: Game, modId: number, fileId: number): Promise<AddModResult> {
  const d = await gbModDetails(modId)
  const f = d.files.find((x) => x.id === fileId)
  if (!f) return { ok: false, error: 'That file is no longer on GameBanana.' }
  if (!f.ok) return { ok: false, error: 'Starstation only installs .zip, .7z and .rar files that passed GameBanana\'s virus scan.' }
  const dl = dir('config', 'downloads', `gb-${f.id}-${f.name.replace(/[^\w.-]+/g, '_')}`)
  log.info(`downloading ${f.url} (${f.name})`)
  await download(f.url, dl)
  try {
    if (f.md5) {
      const md5 = crypto.createHash('md5').update(await fsp.readFile(dl)).digest('hex')
      if (md5.toLowerCase() !== f.md5.toLowerCase()) return { ok: false, error: 'The download was damaged (checksum mismatch). Try again.' }
    }
    const res = await addMod(g, dl, { name: d.name, description: d.text, source: { type: 'gamebanana', ref: `${modId}/${fileId}` } })
    if (res.ok && d.image) {
      try {
        const img = path.join(modsRoot(g), res.mod.id, 'preview' + (path.extname(new URL(d.image).pathname) || '.jpg'))
        await download(d.image, img)
        setModImage(g, res.mod.id, path.basename(img))
        res.mod.image = img
      } catch (e) {
        log.warn('preview image failed', e)
      }
    }
    return res
  } finally {
    await fsp.rm(dl, { force: true })
  }
}

