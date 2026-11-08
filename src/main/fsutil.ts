import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { referencedFiles } from './formats/gameid'

// File helpers shared by the importer, save backups and "Add games".

/** Files that belong to a game file: .cue tracks, .m3u discs (and their tracks). */
export function partsOf(file: string, seen = new Set<string>()): string[] {
  const ext = path.extname(file).toLowerCase()
  if (ext !== '.cue' && ext !== '.m3u') return []
  // playlists that point at each other (a.m3u → b.m3u → a.m3u) must not go round forever
  seen.add(file.toLowerCase())
  const out = new Set<string>()
  for (const r of referencedFiles(file)) {
    const real = realCase(r)
    if (!real || seen.has(real.toLowerCase())) continue
    out.add(real)
    for (const p of partsOf(real, seen)) out.add(p)
  }
  return [...out]
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

/** Verify every file of `from` exists in `to` with the same size; small files (< 64 MB) are compared by SHA-1. */
export async function verifyTree(from: string, to: string): Promise<string[]> {
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
      else if (st.size < 64 * 1024 * 1024 && (await sha1(a)) !== (await sha1(b))) bad.push(b)
      return
    }
    for (const n of await fsp.readdir(a)) await walk(path.join(a, n), path.join(b, n))
  }
  await walk(from, to)
  return bad
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
    // other drive: copy, verify by hash, then remove the original
    await copyTree(from, to, () => undefined, [])
    const bad = await verifyTree(from, to)
    if (bad.length) throw new Error(`copy of ${from} did not verify`)
    await fsp.rm(from, { recursive: true })
  }
}
