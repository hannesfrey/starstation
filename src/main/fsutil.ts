import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { referencedFiles } from './formats/gameid'

// File helpers shared by the importer, save backups and "Add games".

/**
 * Files that belong to a game file: .cue tracks, .m3u discs (and their tracks) — only those in the game's own
 * folder (or below it). These are moved with the game and binned with it, so a sheet naming a file elsewhere
 * ("..\..\Documents\x", "C:\…" in a downloaded .cue) must never pull that file along.
 */
export function partsOf(file: string, seen = new Set<string>(), root = path.dirname(path.resolve(file))): string[] {
  const ext = path.extname(file).toLowerCase()
  if (ext !== '.cue' && ext !== '.m3u') return []
  // playlists that point at each other (a.m3u → b.m3u → a.m3u) must not go round forever
  seen.add(file.toLowerCase())
  const out = new Set<string>()
  for (const r of referencedFiles(file)) {
    const real = realCase(r)
    if (!real || seen.has(real.toLowerCase())) continue
    const rel = path.relative(root, real)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue
    out.add(real)
    for (const p of partsOf(real, seen, root)) out.add(p)
  }
  return [...out]
}

/**
 * `rel` joined onto `root`, or null when it would land outside `root` (#06): an absolute path, a drive letter,
 * ".." climbing out, or an empty name. For paths that come from data files (mod lists, packages from friends).
 */
export function insideOf(root: string, rel: string): string | null {
  if (typeof rel !== 'string' || !rel.trim() || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel) || rel.includes('\0')) return null
  const base = path.resolve(root)
  const full = path.resolve(base, rel)
  const r = path.relative(base, full)
  if (!r || r === '..' || r.startsWith(`..${path.sep}`) || path.isAbsolute(r)) return null
  return full
}

export function realCase(lower: string): string | null {
  const d = path.dirname(lower)
  try {
    const hit = fs.readdirSync(d).find((n) => n.toLowerCase() === path.basename(lower))
    return hit ? path.join(d, hit) : null
  } catch {
    return null
  }
}


export async function sha1(file: string): Promise<string> {
  const h = crypto.createHash('sha1')
  const fh = await fsp.open(file, 'r')
  try {
    const buf = Buffer.alloc(1 << 20)
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null)
      if (!bytesRead) break
      h.update(buf.subarray(0, bytesRead))
    }
  } finally {
    await fh.close()
  }
  return h.digest('hex')
}

/** Copy a file or folder tree. Existing identical files are kept (so a stopped import can resume); existing different files are never overwritten. */
export async function copyTree(from: string, to: string, onFile: () => void, conflicts: string[]): Promise<void> {
  const st = await fsp.stat(from)
  if (st.isFile()) {
    await fsp.mkdir(path.dirname(to), { recursive: true })
    let existing: fs.Stats | null = null
    try {
      existing = await fsp.stat(to)
    } catch {
      /* none */
    }
    if (existing) {
      if (existing.size !== st.size) conflicts.push(to)
    } else {
      await fsp.copyFile(from, to)
      await fsp.utimes(to, st.atime, st.mtime)
    }
    onFile()
    return
  }
  const ents = await fsp.readdir(from)
  if (ents.length === 0) return // skip empty folders (e.g. leftover test folders)
  await fsp.mkdir(to, { recursive: true })
  // copy with a little parallelism; folders one by one
  const queue = [...ents]
  const worker = async () => {
    for (;;) {
      const name = queue.shift()
      if (!name) return
      await copyTree(path.join(from, name), path.join(to, name), onFile, conflicts)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
}

/**
 * Verify every file of `from` exists in `to` with the same size; small files (< 64 MB) are compared by SHA-1.
 * `full`: every file is compared by content, whatever its size — used whenever the original is deleted afterwards.
 */
export async function verifyTree(from: string, to: string, full = false): Promise<string[]> {
  const bad: string[] = []
  const walk = async (a: string, b: string) => {
    const st = await fsp.stat(a)
    if (st.isFile()) {
      let bs: fs.Stats
      try {
        bs = await fsp.stat(b)
      } catch {
        bad.push(b)
        return
      }
      if (bs.size !== st.size) bad.push(b)
      else if ((full || st.size < 64 * 1024 * 1024) && (await sha1(a)) !== (await sha1(b))) bad.push(b)
      return
    }
    for (const n of await fsp.readdir(a)) await walk(path.join(a, n), path.join(b, n))
  }
  await walk(from, to)
  return bad
}

/**
 * A folder path an old-style command-line tool can be started in. Tools that read paths in the PC's old code page
 * (extract-xiso) can't work inside a folder with e.g. Japanese or Cyrillic letters; Windows' short 8.3 form of the
 * folder ("C:\Users\A98B~1") is plain ASCII. Returns the path itself when it is already plain, or when Windows has
 * no short name for it (then the tool may fail — callers keep the original safe).
 */
export async function plainFolder(p: string): Promise<string> {
  if (/^[\x20-\x7e]*$/.test(p)) return p
  const ps = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; (New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:SS_DIR).ShortPath'
  const exe = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return new Promise((resolve) => {
    execFile(exe, ['-NoProfile', '-NonInteractive', '-Command', ps], { env: { ...process.env, SS_DIR: p }, windowsHide: true, timeout: 20_000 }, (err, out) => {
      const short = String(out ?? '').trim()
      resolve(!err && short && /^[\x20-\x7e]+$/.test(short) ? short : p)
    })
  })
}

/**
 * Rename, tried again for a few seconds when Windows briefly holds the file or folder (antivirus, search
 * indexer, Explorer showing the folder): a one-off "operation not permitted" must not cut a move in half.
 */
export async function renameRetry(from: string, to: string, tries = 12): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await fsp.rename(from, to)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? ''
      if (i >= tries - 1 || !['EPERM', 'EBUSY', 'EACCES'].includes(code)) throw e
      await new Promise((r) => setTimeout(r, 100 * (i + 1)))
    }
  }
}

export async function moveFile(from: string, to: string): Promise<void> {
  await fsp.mkdir(path.dirname(to), { recursive: true })
  if (fs.existsSync(to)) throw new Error(`${to} already exists`)
  try {
    await renameRetry(from, to) // same drive: instant, nothing copied
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    // other drive: copy, verify every file by content, then remove the original
    await copyTree(from, to, () => undefined, [])
    const bad = await verifyTree(from, to, true)
    if (bad.length) {
      await fsp.rm(to, { recursive: true, force: true }) // the bad copy goes, the original stays
      throw new Error(`copy of ${from} did not verify`)
    }
    await fsp.rm(from, { recursive: true })
  }
}
