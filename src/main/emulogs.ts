import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { dir } from './paths'
import { emulatorDir, getConsole, getEmulator } from './presets'
import { getGame } from './library/library'
import { notify } from './notify'
import { logger } from './log'
import { fatalLines } from './formats/emulog'

/**
 * Emulators overwrite their log at every start, so a crash left no trace once the next game ran
 * (2026-11-07: GT6 and Black Ops II crashed in RPCS3; the log was already gone). After every session the
 * emulator's log is kept in config\logs\emulators (zipped, the last KEEP per emulator), and an error the
 * emulator itself calls fatal is shown as a notice.
 */

const log = logger('emulogs')
const KEEP = 10
const MAX_FATAL_SCAN = 64 * 1024 * 1024

export const keptLogsDir = (): string => dir('config', 'logs', 'emulators')

/** The whole log if it is small, else its first and last MAX_FATAL_SCAN / 2 bytes. */
export async function readEnds(file: string, size: number): Promise<string> {
  if (size <= MAX_FATAL_SCAN) return fsp.readFile(file, 'utf8')
  const half = MAX_FATAL_SCAN / 2
  const fh = await fsp.open(file, 'r')
  try {
    const head = Buffer.alloc(half)
    const tail = Buffer.alloc(half)
    await fh.read(head, 0, half, 0)
    await fh.read(tail, 0, half, size - half)
    // the cut lines at the seams are dropped by the line-based search anyway
    return `${head.toString('utf8')}\n${tail.toString('utf8')}`
  } finally {
    await fh.close()
  }
}


export async function keepEmulatorLog(gameId: string, startedAt: number): Promise<string | null> {
  const g = getGame(gameId)
  const c = g ? getConsole(g.console) : undefined
  const e = c ? getEmulator(c.emulator) : undefined
  if (!g || !e?.log) return null
  const src = e.log.file.replace('{emu}', emulatorDir(e))
  let st: fs.Stats
  try {
    st = await fsp.stat(src)
  } catch {
    return null
  }
  if (st.mtimeMs < startedAt - 2000) return null // not written in this session
  const stamp = new Date(startedAt).toISOString().replace(/\D/g, '').slice(0, 14)
  const safeTitle = g.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 60)
  const out = path.join(keptLogsDir(), `${e.id}_${stamp}_${safeTitle}.log.gz`)
  await fsp.mkdir(keptLogsDir(), { recursive: true })
  await pipeline(fs.createReadStream(src), zlib.createGzip(), fs.createWriteStream(out))
  // only the newest KEEP of this emulator stay
  const mine = (await fsp.readdir(keptLogsDir())).filter((f) => f.startsWith(`${e.id}_`) && f.endsWith('.log.gz')).sort()
  for (const old of mine.slice(0, Math.max(0, mine.length - KEEP))) await fsp.rm(path.join(keptLogsDir(), old), { force: true })

  // a long session's log can be gigabytes: then only its start (refused settings are written while it starts)
  // and its end (where a fatal error stops it) are read — before, a big log was not looked at all
  const text = e.log.fatal || e.log.config ? await readEnds(src, st.size) : ''
  // a setting the emulator refused (2026-11-07: RPCS3 ignored "Prefer borderless fullscreen", its GUI label):
  // only for Starstation's log, the player can't do anything about it
  if (e.log.config && text) for (const bad of new Set(fatalLines(text, e.log.config))) log.warn(`${e.name} refused a setting: ${bad}`)
  if (e.log.fatal && text) {
    const fatal = fatalLines(text, e.log.fatal)
    if (fatal.length) {
      const last = fatal[fatal.length - 1]
      log.warn(`${gameId}: ${e.name} reported a fatal error: ${last}`)
      notify({
        kind: 'error',
        title: `${g.title} stopped with an error in ${e.name}`,
        detail: `${last.length > 160 ? last.slice(0, 157) + '…' : last} — the emulator's log is kept in Files\\config\\logs\\emulators.`,
        action: { label: 'Open logs', command: 'open-folder', arg: 'logs' }
      })
    }
  }
  return out
}
