import fs from 'node:fs'
import path from 'node:path'
import { dir } from './paths'

type Level = 'info' | 'warn' | 'error'
let file: string | null = null

function logFile(): string {
  if (!file) {
    const d = dir('config', 'logs')
    fs.mkdirSync(d, { recursive: true })
    file = path.join(d, `starstation-${new Date().toISOString().slice(0, 10)}.log`)
    pruneOldLogs(d)
  }
  return file
}

function pruneOldLogs(d: string): void {
  try {
    const logs = fs.readdirSync(d).filter((f) => /^starstation-\d{4}-\d\d-\d\d\.log$/.test(f)).sort()
    for (const old of logs.slice(0, Math.max(0, logs.length - 14))) fs.rmSync(path.join(d, old), { force: true })
  } catch {
    /* ignore */
  }
}

function write(level: Level, scope: string, msg: string, extra?: unknown): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}${
    extra === undefined ? '' : ' ' + (extra instanceof Error ? extra.stack ?? extra.message : safeJson(extra))
  }\n`
  try {
    fs.appendFileSync(logFile(), line)
  } catch {
    /* logging must never crash the app */
  }
  if (process.env.STARSTATION_LOG_STDOUT) process.stdout.write(line)
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export function logger(scope: string) {
  return {
    info: (msg: string, extra?: unknown) => write('info', scope, msg, extra),
    warn: (msg: string, extra?: unknown) => write('warn', scope, msg, extra),
    error: (msg: string, extra?: unknown) => write('error', scope, msg, extra)
  }
}
