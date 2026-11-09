import fs from 'node:fs'
import path from 'node:path'
import { logger } from './log'

const log = logger('store')
/** Damaged files already noted this session. */
const reported = new Set<string>()

/**
 * Read a JSON file, returning `fallback` if it is missing.
 * A file that is there but broken (cut off by a crash or power cut) is never just replaced: the last good
 * copy (`.bak`, kept by writeJson) is used, and the broken file is kept next to it as `.broken`.
 */
export function readJson<T>(file: string, fallback: T): T {
  let text: string
  try {
    text = pending.get(file)?.data ?? fs.readFileSync(file, 'utf8') // a write still waiting for Windows: its content
  } catch {
    return fallback // missing: that's what the fallback is for
  }
  const parsed = parse<T>(text)
  if (parsed.ok) {
    // valid JSON of another shape than expected (null or a list where an object belongs, e.g. after editing by
    // hand) would reach code that reads its fields: the fallback is used instead (the file stays as it is)
    if (sameShape(parsed.value, fallback)) return parsed.value
    if (!reported.has(file)) log.warn(`${file} doesn't hold what Starstation expects; trying the last good copy`)
    reported.add(file)
    return goodBackup(file, fallback) ?? fallback
  }
  // some files are read very often (secrets.json on every menu update): note and keep a damaged one only once
  const first = !reported.has(file)
  reported.add(file)
  if (first) {
    log.warn(`${file} is damaged; keeping it as .broken`)
    try {
      fs.copyFileSync(file, `${file}.broken`)
    } catch {
      /* best effort */
    }
  }
  const bak = goodBackup(file, fallback)
  if (bak !== null && first) log.warn(`${file}: using the last good copy`)
  return bak ?? fallback
}

/** The .bak copy, with the same checks as the file itself (#21): readable and of the expected shape. */
function goodBackup<T>(file: string, fallback: T): T | null {
  try {
    const bak = parse<T>(fs.readFileSync(`${file}.bak`, 'utf8'))
    return bak.ok && sameShape(bak.value, fallback) && bak.value !== null ? bak.value : null
  } catch {
    return null // no backup
  }
}

/**
 * Like readJson, for files that hold an object (key → value): valid JSON of another shape (null, a list, a
 * number — e.g. after editing by hand) gives the fallback instead of reaching code that expects an object.
 */
export function readObject<T extends object>(file: string, fallback: T): T {
  const v = readJson<unknown>(file, fallback)
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : fallback
}

/** The value is the same kind as the fallback: object ↔ object, list ↔ list (a null fallback accepts anything). */
function sameShape(value: unknown, fallback: unknown): boolean {
  if (fallback === null || fallback === undefined) return true
  if (Array.isArray(fallback)) return Array.isArray(value)
  if (typeof fallback === 'object') return !!value && typeof value === 'object' && !Array.isArray(value)
  return typeof value === typeof fallback
}

function parse<T>(text: string): { ok: true; value: T } | { ok: false } {
  try {
    const t = text.replace(/^﻿/, '')
    if (!t.trim() || t.includes('\0')) return { ok: false }
    return { ok: true, value: JSON.parse(t) as T }
  } catch {
    return { ok: false }
  }
}

/** Write JSON safely; the version it replaces stays as `.bak` (readJson falls back to it if the file breaks). */
export function writeJson(file: string, data: unknown): void {
  writeFileAtomic(file, JSON.stringify(data, null, 2), { backup: true, later: true })
  reported.delete(file)
}

let seq = 0
/**
 * Write a file so it is either fully the old or fully the new content, even after a crash or power cut:
 * temp file → flushed to disk → renamed over the old one. Windows sometimes holds a file for a moment
 * (antivirus, search indexer, an emulator reading it): the rename is tried again (see `later` below).
 */
export function writeFileAtomic(file: string, data: string | Buffer, opts: { backup?: boolean; later?: boolean } = {}): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const waiting = pending.get(file)
  if (waiting) {
    // an older write of this file is still waiting for Windows: this one replaces it
    pending.delete(file)
    fs.rmSync(waiting.tmp, { force: true })
  }
  const tmp = `${file}.${process.pid}.${seq++}.tmp`
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, data)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  if (opts.backup) {
    try {
      // only a good file becomes the backup (a broken one would replace the last good copy)
      if (parse(fs.readFileSync(file, 'utf8')).ok) fs.copyFileSync(file, `${file}.bak`)
    } catch {
      /* no old file yet */
    }
  }
  // #31 Starstation's own files (later): only a short wait here, then the rename is finished in the background —
  // a waiting main process can't answer the menu. Emulator settings must be on disk before the emulator starts:
  // they keep waiting up to ~1 s.
  const tries = opts.later ? 3 : 9
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? ''
      const busy = ['EPERM', 'EBUSY', 'EACCES'].includes(code)
      if (busy && opts.later && i >= tries - 1) {
        pending.set(file, { tmp, data: typeof data === 'string' ? data : data.toString('utf8') })
        finishLater(file, tmp)
        return
      }
      if (i >= tries - 1 || !busy) {
        fs.rmSync(tmp, { force: true })
        throw e
      }
      sleepSync(opts.later ? 10 * (i + 1) : 25 * (i + 1))
    }
  }
}

/** Writes Windows held up: file → its newest content (readJson reads it from here meanwhile). */
const pending = new Map<string, { tmp: string; data: string }>()

function finishLater(file: string, tmp: string, attempt = 0): void {
  setTimeout(() => {
    const p = pending.get(file)
    if (!p || p.tmp !== tmp) return // a newer write took over
    try {
      fs.renameSync(tmp, file)
      pending.delete(file)
      reported.delete(file)
    } catch (e) {
      if (attempt < 40) return finishLater(file, tmp, attempt + 1)
      log.error(`${file} could not be saved for a minute (held by another program); still trying with the next change`, e)
    }
  }, Math.min(2000, 50 * (attempt + 1))).unref?.()
}

/** Starstation is closing: writes still waiting get their last tries now (here waiting is fine). */
export function flushPendingWrites(): void {
  for (const [file, p] of [...pending]) {
    for (let i = 0; i < 10; i++) {
      try {
        fs.renameSync(p.tmp, file)
        pending.delete(file)
        break
      } catch {
        sleepSync(50)
      }
    }
    if (pending.has(file)) log.error(`${file} could not be saved before closing`)
  }
}

/** Tests: is a write still waiting? */
export function writesPending(): number {
  return pending.size
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}
