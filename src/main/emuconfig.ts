import fs from 'node:fs'
import path from 'node:path'
import { fill, getEmulator, emulatorDir, vars, type ConfigStep, type ConsolePreset } from './presets'
import { getIniValue, setIniValues, setKvValues, setXemuPadButtons, setYamlPlayers, stripLines } from './ini'
import { candidateBios } from './bios'
import { dir } from './paths'
import { writeFileAtomic } from './store'
import { logger } from './log'
import { withOneMii } from './formats/miidb'
import { quoted, xeniaSlots, XUID } from './formats/xeniaprofile'

const log = logger('emuconfig')

/**
 * A quoted value (xemu's TOML): a literal string '…' — which can't hold an apostrophe, so a path like
 * C:\Users\O'Brien\… becomes a basic string "…" with its backslashes escaped instead (else xemu can't read its settings).
 */
export function quoteValue(s: string): string {
  return s.includes("'") ? JSON.stringify(s) : `'${s}'`
}

/** The text of a value written either way (or unquoted). */
export function unquoteValue(s?: string): string | undefined {
  if (s === undefined) return s
  const t = s.trim()
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      return JSON.parse(t) as string
    } catch {
      return t.slice(1, -1)
    }
  }
  return t.replace(/^'|'$/g, '')
}

function str(v: string | number | boolean): string {
  return typeof v === 'string' ? v : String(v)
}

/**
 * Emulators don't always create the folders they are pointed at (PCSX2 then can't create its memory
 * cards). Every setting that names a folder inside saves\ or media\ is created before launch.
 */
function ensureFolders(values: string[]): void {
  const roots = [dir('saves'), dir('media')].map((r) => path.resolve(r).toLowerCase() + path.sep)
  for (const raw of values) {
    const val = raw.replace(/^['"]|['"]$/g, '')
    if (!path.isAbsolute(val) || path.extname(val)) continue
    const abs = path.resolve(val)
    if (roots.some((r) => abs.toLowerCase().startsWith(r))) fs.mkdirSync(abs, { recursive: true })
  }
}

export function applyStep(step: ConfigStep, v: Record<string, string>): void {
  switch (step.type) {
    case 'touch': {
      const p = fill(step.path, v)
      if (!fs.existsSync(p)) {
        fs.mkdirSync(path.dirname(p), { recursive: true })
        writeFileAtomic(p, '')
      }
      return
    }
    case 'mkdir':
      fs.mkdirSync(fill(step.path, v), { recursive: true })
      return
    case 'mii-db': {
      const file = fill(step.file, v)
      const next = withOneMii(fs.existsSync(file) ? fs.readFileSync(file) : null)
      if (next) {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        writeFileAtomic(file, next)
        log.info(`Mii database: Starstation's Mii added (${file})`)
      }
      return
    }
    case 'link': {
      const p = fill(step.path, v)
      const target = fill(step.target, v)
      fs.mkdirSync(target, { recursive: true })
      let existing: fs.Stats | null = null
      try {
        existing = fs.lstatSync(p)
      } catch {
        /* missing */
      }
      if (existing?.isSymbolicLink()) {
        if (path.resolve(fs.readlinkSync(p)).toLowerCase() === path.resolve(target).toLowerCase()) return
        fs.rmSync(p)
      } else if (existing) {
        // A real folder is there: only replace it if it is empty, never delete files.
        if (fs.readdirSync(p).length) return
        fs.rmdirSync(p)
      }
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.symlinkSync(target, p, 'junction')
      return
    }
    case 'write': {
      const p = fill(step.file, v)
      if (step.ifMissing && fs.existsSync(p)) return
      fs.mkdirSync(path.dirname(p), { recursive: true })
      writeFileAtomic(p, step.lines.map((l) => fill(l, v)).join('\r\n') + '\r\n')
      return
    }
    case 'ini': {
      const p = fill(step.file, v)
      if (step.ifExists && !fs.existsSync(p)) return
      const set: Record<string, Record<string, string | string[]>> = {}
      const one = (val: string | number | boolean) => {
        const filled = typeof val === 'string' ? fill(val, v) : str(val)
        return step.quote && typeof val === 'string' ? quoteValue(filled) : filled
      }
      for (const [sec, entries] of Object.entries(step.set)) {
        set[sec] = {}
        for (const [k, val] of Object.entries(entries)) set[sec][k] = Array.isArray(val) ? val.map((x) => fill(x, v)) : one(val)
      }
      ensureFolders(Object.values(set).flatMap((e) => Object.values(e).flat()))
      const before = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
      const after = setIniValues(before, set, step.spacing ?? ' = ')
      if (after !== before) {
        fs.mkdirSync(path.dirname(p), { recursive: true })
        writeFileAtomic(p, after)
      }
      return
    }
    case 'yaml-players': {
      const p = fill(step.file, v)
      const upTo = Math.max(1, Math.min(step.players.length, Number(fill(step.upTo, v)) || 1))
      const before = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
      const after = setYamlPlayers(
        before,
        step.players.slice(0, upTo).map((pl) => ({ Handler: fill(pl.Handler, v), Device: fill(pl.Device, v) })),
        step.config ?? {},
        step.fresh ?? {}
      )
      if (after !== before) {
        fs.mkdirSync(path.dirname(p), { recursive: true })
        writeFileAtomic(p, after)
      }
      return
    }
    case 'xenia-profile': {
      const p = fill(step.file, v)
      const content = fill(step.content, v)
      if (!fs.existsSync(p) || !fs.existsSync(content)) return
      const text = fs.readFileSync(p, 'utf8')
      const profiles = fs
        .readdirSync(content, { withFileTypes: true })
        .filter((d) => d.isDirectory() && XUID.test(d.name) && fs.existsSync(path.join(content, d.name, 'FFFE07D1')))
        .map((d) => ({ xuid: d.name, mtime: fs.statSync(path.join(content, d.name)).mtimeMs }))
      const slots = [0, 1, 2, 3].map((i) => quoted(getIniValue(text, 'Profiles', `logged_profile_slot_${i}_xuid`)))
      const next = xeniaSlots(slots, profiles)
      if (!next) return
      const set = Object.fromEntries(next.map((x, i) => [`logged_profile_slot_${i}_xuid`, `"${x}"`]))
      writeFileAtomic(p, setIniValues(text, { Profiles: set }))
      log.info(`Xenia: profile ${next[0]} signed in as player 1 at start`)
      return
    }
    case 'xemu-pads': {
      const p = fill(step.file, v)
      if (!fs.existsSync(p)) return
      const after = setXemuPadButtons(fs.readFileSync(p, 'utf8'), step.buttons)
      if (after !== null) writeFileAtomic(p, after)
      return
    }
    case 'strip-lines': {
      // every file with this extension under the folder, without the matching lines (only files that have one change)
      const ext = step.ext.toLowerCase()
      const walk = (d: string): void => {
        let entries: fs.Dirent[]
        try {
          entries = fs.readdirSync(d, { withFileTypes: true })
        } catch {
          return
        }
        for (const e of entries) {
          const p = path.join(d, e.name)
          if (e.isDirectory()) walk(p)
          else if (e.name.toLowerCase().endsWith(ext)) {
            const after = stripLines(fs.readFileSync(p, 'utf8'), step.match)
            if (after !== null) writeFileAtomic(p, after)
          }
        }
      }
      walk(fill(step.dir, v))
      return
    }
    case 'kv': {
      const p = fill(step.file, v)
      const set = Object.fromEntries(Object.entries(step.set).map(([k, val]) => [k, fill(val, v)]))
      ensureFolders(Object.values(set))
      const before = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
      const after = setKvValues(before, set, step.sep)
      if (after !== before) {
        fs.mkdirSync(path.dirname(p), { recursive: true })
        writeFileAtomic(p, after)
      }
      return
    }
  }
}

/** Make sure the emulator is portable and points at Starstation's folders. Safe to run before every launch. */
export function applyConsoleConfig(c: ConsolePreset, extra: Record<string, string> = {}): void {
  const e = getEmulator(c.emulator)
  if (!e) return
  const v = vars(c, extra)
  for (const d of [dir('bios', c.id), dir('games', c.id), dir('saves', c.id), dir('media', 'screenshots', c.id)])
    fs.mkdirSync(d, { recursive: true })
  for (const step of [...e.portable, ...c.config, ...(c.controls ?? [])]) {
    try {
      applyStep(step, v)
    } catch (err) {
      log.warn(`${c.id}: config step ${step.type} failed`, err)
    }
  }
  try {
    selectBios(c, v)
  } catch (err) {
    log.warn(`${c.id}: BIOS selection failed`, err)
  }
}

/** Pick BIOS files for emulators that need them named in their config (PCSX2, xemu). */
function selectBios(c: ConsolePreset, v: Record<string, string>): void {
  const raw = c.bios?.select
  const list = !raw ? [] : Array.isArray(raw) ? raw : [raw]
  for (const sel of list) {
    const file = fill(sel.file, v)
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    const current = unquoteValue(getIniValue(text, sel.section, sel.key))
    const candidates = candidateBios(c, sel.rule)
    if (!candidates.length) continue
    const asValue = (name: string) => (sel.fullPath ? path.join(v.bios, name) : name)
    if (current && candidates.some((n) => asValue(n).toLowerCase() === current.toLowerCase())) continue
    const prefer = sel.prefer ? new RegExp(sel.prefer, 'i') : null
    const pick = asValue((prefer && candidates.find((n) => prefer.test(n))) || [...candidates].sort()[0])
    fs.mkdirSync(path.dirname(file), { recursive: true })
    writeFileAtomic(file, setIniValues(text, { [sel.section]: { [sel.key]: sel.quote ? quoteValue(pick) : pick } }))
    log.info(`${c.id}: ${sel.key} set to ${pick}`)
  }
}

export function emulatorInstalled(c: ConsolePreset): boolean {
  const e = getEmulator(c.emulator)
  return !!e && fs.existsSync(path.join(emulatorDir(e), e.exe))
}
