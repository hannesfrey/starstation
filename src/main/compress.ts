import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { binDir, dir } from './paths'
import { readJson, writeJson } from './store'
import { emulatorDir, getEmulator } from './presets'
import { logger } from './log'
import { renameRetry } from './fsutil'
import type { Game } from '../shared/types'

/**
 * Compress / Decompress (SPEC-v2 D), only when the user asks for it, one game at a time.
 * PS1 / PS2 → CHD (MAME's chdman), GameCube / Wii → RVZ (Dolphin's DolphinTool). Both are lossless.
 * The original is deleted (Recycle Bin) only after the new file was checked: it opens, and its data has
 * the same SHA-1 as the original (CDs: every track is extracted again and compared). What's needed to
 * restore the original bit for bit (cue sheet text, track names, hashes) is kept in config\compress.
 */

const log = logger('compress')
type Progress = (text: string) => void
type Trash = (p: string) => Promise<void>

interface Meta {
  kind: 'cd' | 'dvd' | 'rvz'
  /** CD: the .cue as it was, and its tracks (name + SHA-1) in order. */
  cue?: { name: string; text: string }
  files: { name: string; size: number; sha1: string }[]
  compressedAt: string
}

const metaFile = (g: Game, compressed: string) => dir('config', 'compress', g.console, `${path.basename(compressed)}.json`)

export async function sha1File(file: string, onBytes?: (n: number) => void): Promise<string> {
  const h = crypto.createHash('sha1')
  let done = 0
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024 })) {
    h.update(chunk as Buffer)
    done += (chunk as Buffer).length
    onBytes?.(done)
  }
  return h.digest('hex')
}

function run(exe: string, args: string[], cwd: string, onLine?: (l: string) => void): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(exe, args, { cwd, windowsHide: true })
    let out = ''
    const feed = (d: Buffer) => {
      const s = d.toString('utf8')
      out += s
      for (const l of s.split(/[\r\n]+/)) if (l.trim()) onLine?.(l.trim())
    }
    p.stdout.on('data', feed)
    p.stderr.on('data', feed)
    p.once('error', (e) => resolve({ code: -1, out: String(e) }))
    p.once('exit', (code) => resolve({ code: code ?? -1, out }))
  })
}

const chdman = () => path.join(binDir(), 'chdman.exe')
function dolphinTool(): string | null {
  const e = getEmulator('dolphin')
  const exe = e ? path.join(emulatorDir(e), 'DolphinTool.exe') : ''
  return exe && fs.existsSync(exe) ? exe : null
}

/** Track files of a .cue, with their real names (as written in the sheet), in order. */
export function cueTracks(cue: string): string[] {
  const text = fs.readFileSync(cue, 'latin1')
  return [...text.matchAll(/FILE\s+(?:"([^"]+)"|(\S+))/gi)].map((m) => path.resolve(path.dirname(cue), m[1] ?? m[2]))
}

/** What the Triangle menu can offer for this game. */
export function compressOption(g: Game): { action: 'compress' | 'decompress'; format: string } | null {
  if (g.kind !== 'file') return null
  const ext = path.extname(g.path).toLowerCase()
  if (g.console === 'ps1' || g.console === 'ps2') {
    if (ext === '.cue' || (g.console === 'ps2' && ext === '.iso')) return { action: 'compress', format: 'CHD' }
    if (ext === '.chd') return { action: 'decompress', format: fs.existsSync(metaFile(g, g.path)) ? 'the original files' : 'BIN/CUE or ISO' }
  }
  if (g.console === 'gc' || g.console === 'wii') {
    if ((ext === '.iso' || ext === '.gcm') && dolphinTool()) return { action: 'compress', format: 'RVZ' }
    if (ext === '.rvz' && dolphinTool()) return { action: 'decompress', format: 'ISO' }
  }
  return null
}

function freeBytes(p: string): number {
  try {
    const s = fs.statfsSync(p)
    return s.bavail * s.bsize
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}

const pct = (l: string) => /(\d+(?:\.\d+)?)%/.exec(l)?.[1]

/**
 * Compress a game. Returns the new file (the library entry follows it) or an error; the original
 * stays untouched on any problem.
 */
export async function compressGame(g: Game, progress: Progress, trash: Trash): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const opt = compressOption(g)
  if (opt?.action !== 'compress') return { ok: false, error: 'This game can’t be compressed.' }
  const src = g.path
  const ext = path.extname(src).toLowerCase()
  const isCd = ext === '.cue'
  const inputs = isCd ? [src, ...cueTracks(src)] : [src]
  for (const f of inputs) if (!fs.existsSync(f)) return { ok: false, error: `${path.basename(f)} is missing.` }
  const size = inputs.reduce((n, f) => n + fs.statSync(f).size, 0)
  // the compressed file + (CD) every track once more for the check
  if (freeBytes(path.dirname(src)) < size * (isCd ? 2 : 1) + 1024 ** 3) return { ok: false, error: 'Not enough free disk space to compress and check this game.' }
  const work = dir('config', 'compress', `work-${Date.now()}`)
  await fsp.mkdir(work, { recursive: true })
  const outExt = opt.format === 'RVZ' ? '.rvz' : '.chd'
  const out = path.join(work, `out${outExt}`)
  try {
    // 1. what the data looks like now
    progress('Reading the game…')
    const tracks = isCd ? inputs.slice(1) : inputs
    const files: Meta['files'] = []
    for (const f of tracks) files.push({ name: path.basename(f), size: fs.statSync(f).size, sha1: await sha1File(f) })
    // 2. compress
    let r: { code: number; out: string }
    if (opt.format === 'RVZ') {
      const tool = dolphinTool()!
      // -u: DolphinTool's own scratch folder inside Starstation (otherwise it creates one in Documents)
      r = await run(tool, ['convert', '-u', path.join(work, 'user'), '-i', src, '-o', out, '-f', 'rvz', '-b', '131072', '-c', 'zstd', '-l', '5'], work, (l) => pct(l) && progress(`Compressing… ${pct(l)}%`))
    } else r = await run(chdman(), [isCd ? 'createcd' : 'createdvd', '-i', src, '-o', out, '-f'], work, (l) => /Compressing/.test(l) && pct(l) && progress(`Compressing… ${pct(l)}%`))
    if (r.code !== 0 || !fs.existsSync(out)) throw new Error(`the compressor stopped (code ${r.code})`)
    // 3. check: it opens and holds exactly the same data
    progress('Checking the compressed file…')
    if (opt.format === 'RVZ') {
      const v = await run(dolphinTool()!, ['verify', '-u', path.join(work, 'user'), '-i', out, '-a', 'sha1'], work)
      const sha = /([0-9a-f]{40})/i.exec(v.out)?.[1]?.toLowerCase()
      if (v.code !== 0 || sha !== files[0].sha1) throw new Error('the RVZ file does not match the original')
    } else {
      const v = await run(chdman(), ['verify', '-i', out], work)
      if (v.code !== 0) throw new Error('the CHD file is damaged')
      if (isCd) {
        const x = await run(chdman(), ['extractcd', '-i', out, '-o', path.join(work, 'check.cue'), ...(tracks.length > 1 ? ['-sb'] : ['-ob', path.join(work, 'check.bin')])], work)
        if (x.code !== 0) throw new Error('the CHD file could not be read back')
        const back = tracks.length > 1 ? tracks.map((_t, i) => path.join(work, `check (Track ${i + 1}).bin`)) : [path.join(work, 'check.bin')]
        for (let i = 0; i < back.length; i++) if (!fs.existsSync(back[i]) || (await sha1File(back[i])) !== files[i].sha1) throw new Error(`track ${i + 1} does not match the original`)
      } else {
        const info = await run(chdman(), ['info', '-i', out], work)
        const data = /Data SHA1:\s*([0-9a-f]{40})/i.exec(info.out)?.[1]?.toLowerCase()
        if (data !== files[0].sha1) throw new Error('the CHD file does not match the original')
      }
    }
    // 4. checked: the compressed file takes the original's place, the original goes to the Recycle Bin
    const final = path.join(path.dirname(src), path.basename(src, path.extname(src)) + outExt)
    if (fs.existsSync(final)) throw new Error(`${path.basename(final)} already exists`)
    const meta: Meta = { kind: opt.format === 'RVZ' ? 'rvz' : isCd ? 'cd' : 'dvd', files, compressedAt: new Date().toISOString() }
    if (isCd) meta.cue = { name: path.basename(src), text: fs.readFileSync(src, 'latin1') }
    await renameRetry(out, final)
    writeJson(metaFile(g, final), meta)
    for (const f of inputs) await trash(f)
    const saved = size - fs.statSync(final).size
    log.info(`${g.id}: compressed to ${final} (${Math.round(size / 1024 ** 2)} → ${Math.round(fs.statSync(final).size / 1024 ** 2)} MB)`)
    progress(`Saved ${(saved / 1024 ** 3).toFixed(1)} GB`)
    return { ok: true, path: final }
  } catch (e) {
    log.warn(`${g.id}: compress failed`, e)
    return { ok: false, error: `Not compressed: ${(e as Error).message}. The game stays as it was.` }
  } finally {
    await fsp.rm(work, { recursive: true, force: true })
  }
}

/** Back to the original files (bit for bit when Starstation compressed it), the compressed file goes to the Recycle Bin. */
export async function decompressGame(g: Game, progress: Progress, trash: Trash): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const opt = compressOption(g)
  if (opt?.action !== 'decompress') return { ok: false, error: 'This game isn’t compressed.' }
  const src = g.path
  const ext = path.extname(src).toLowerCase()
  const meta = readJson<Meta | null>(metaFile(g, src), null)
  const folder = path.dirname(src)
  const base = path.basename(src, ext)
  const need = (meta?.files.reduce((n, f) => n + f.size, 0) ?? fs.statSync(src).size * 3) + 1024 ** 3
  if (freeBytes(folder) < need) return { ok: false, error: 'Not enough free disk space to decompress this game.' }
  const work = dir('config', 'compress', `work-${Date.now()}`)
  await fsp.mkdir(work, { recursive: true })
  try {
    progress('Decompressing…')
    let made: { tmp: string; name: string; sha1?: string }[] = []
    let cueText: string | null = null
    let cueName = `${base}.cue`
    if (ext === '.rvz') {
      const r = await run(dolphinTool()!, ['convert', '-u', path.join(work, 'user'), '-i', src, '-o', path.join(work, 'out.iso'), '-f', 'iso'], work, (l) => pct(l) && progress(`Decompressing… ${pct(l)}%`))
      if (r.code !== 0) throw new Error(`DolphinTool stopped (code ${r.code})`)
      made = [{ tmp: path.join(work, 'out.iso'), name: meta?.files[0]?.name ?? `${base}.iso`, sha1: meta?.files[0]?.sha1 }]
    } else {
      const info = await run(chdman(), ['info', '-i', src], work)
      const isCd = meta ? meta.kind === 'cd' : /CHCD|CHT2|CHTR|cdrom/i.test(info.out)
      if (isCd) {
        const tracks = meta?.files.length ?? 1
        const r = await run(chdman(), ['extractcd', '-i', src, '-o', path.join(work, 'out.cue'), ...(tracks > 1 ? ['-sb'] : ['-ob', path.join(work, 'out.bin')])], work, (l) => pct(l) && progress(`Decompressing… ${pct(l)}%`))
        if (r.code !== 0) throw new Error(`chdman stopped (code ${r.code})`)
        const back = tracks > 1 ? Array.from({ length: tracks }, (_x, i) => path.join(work, `out (Track ${i + 1}).bin`)) : [path.join(work, 'out.bin')]
        made = back.map((tmp, i) => ({ tmp, name: meta?.files[i]?.name ?? `${base}.bin`, sha1: meta?.files[i]?.sha1 }))
        // the original sheet when known, else chdman's with the new track name
        cueText = meta?.cue?.text ?? fs.readFileSync(path.join(work, 'out.cue'), 'latin1').replace(/out\.bin/g, `${base}.bin`)
        if (meta?.cue) cueName = meta.cue.name
      } else {
        const r = await run(chdman(), ['extractdvd', '-i', src, '-o', path.join(work, 'out.iso')], work, (l) => pct(l) && progress(`Decompressing… ${pct(l)}%`))
        if (r.code !== 0) throw new Error(`chdman stopped (code ${r.code})`)
        made = [{ tmp: path.join(work, 'out.iso'), name: meta?.files[0]?.name ?? `${base}.iso`, sha1: meta?.files[0]?.sha1 }]
      }
    }
    progress('Checking…')
    for (const m of made) {
      if (!fs.existsSync(m.tmp)) throw new Error('a file is missing after decompressing')
      if (m.sha1 && (await sha1File(m.tmp)) !== m.sha1) throw new Error(`${m.name} does not match the original`)
    }
    const targets = [...made.map((m) => path.join(folder, m.name)), ...(cueText !== null ? [path.join(folder, cueName)] : [])]
    for (const t of targets) if (fs.existsSync(t)) throw new Error(`${path.basename(t)} already exists`)
    for (const m of made) await renameRetry(m.tmp, path.join(folder, m.name))
    if (cueText !== null) await fsp.writeFile(path.join(folder, cueName), cueText, 'latin1')
    await trash(src)
    await fsp.rm(metaFile(g, src), { force: true })
    const main = cueText !== null ? path.join(folder, cueName) : path.join(folder, made[0].name)
    log.info(`${g.id}: decompressed to ${main}`)
    return { ok: true, path: main }
  } catch (e) {
    log.warn(`${g.id}: decompress failed`, e)
    return { ok: false, error: `Not decompressed: ${(e as Error).message}. The compressed file stays.` }
  } finally {
    await fsp.rm(work, { recursive: true, force: true })
  }
}
