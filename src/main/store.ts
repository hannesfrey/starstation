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
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return fallback // missing: that's what the fallback is for
  }
  const parsed = parse<T>(text)
  if (parsed.ok) return parsed.value
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
  try {
    const bak = parse<T>(fs.readFileSync(`${file}.bak`, 'utf8'))
    if (bak.ok) {
      if (first) log.warn(`${file}: using the last good copy`)
      return bak.value
    }
  } catch {
    /* no backup */
  }
  return fallback
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
  writeFileAtomic(file, JSON.stringify(data, null, 2), { backup: true })
  reported.delete(file)
}

let seq = 0
/**
 * Write a file so it is either fully the old or fully the new content, even after a crash or power cut:
 * temp file → flushed to disk → renamed over the old one. Windows sometimes holds a file for a moment
 * (antivirus, search indexer, an emulator reading it): the rename is tried again for up to ~1 s.
 */
export function writeFileAtomic(file: string, data: string | Buffer, opts: { backup?: boolean } = {}): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
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
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? ''
      if (i >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(code)) {
        fs.rmSync(tmp, { force: true })
        throw e
      }
      sleepSync(25 * (i + 1))
    }
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}
