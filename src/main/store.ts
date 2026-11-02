import fs from 'node:fs'
import path from 'node:path'

/** Read a JSON file, returning `fallback` if it is missing or broken. */
export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as T
  } catch {
    return fallback
  }
}

/** Write JSON atomically (temp file + rename) so a crash never leaves a half-written file. */
export function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}
