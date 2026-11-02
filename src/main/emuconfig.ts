import fs from 'node:fs'
import path from 'node:path'
import { fill, getEmulator, emulatorDir, vars, type ConfigStep, type ConsolePreset } from './presets'
import { getIniValue, setIniValues, setKvValues } from './ini'
import { candidateBios } from './bios'
import { dir } from './paths'
import { logger } from './log'

const log = logger('emuconfig')

function str(v: string | number | boolean): string {
  return typeof v === 'string' ? v : String(v)
}

export function applyStep(step: ConfigStep, v: Record<string, string>): void {
  switch (step.type) {
    case 'touch': {
      const p = fill(step.path, v)
      if (!fs.existsSync(p)) {
        fs.mkdirSync(path.dirname(p), { recursive: true })
        fs.writeFileSync(p, '')
      }
      return
    }
    case 'mkdir':
      fs.mkdirSync(fill(step.path, v), { recursive: true })
      return
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
      fs.writeFileSync(p, step.lines.map((l) => fill(l, v)).join('\r\n') + '\r\n')
      return
    }
    case 'ini': {
      const p = fill(step.file, v)
      if (step.ifExists && !fs.existsSync(p)) return
      const set: Record<string, Record<string, string>> = {}
      for (const [sec, entries] of Object.entries(step.set)) {
        set[sec] = {}
        for (const [k, val] of Object.entries(entries)) {
          const filled = typeof val === 'string' ? fill(val, v) : str(val)
          set[sec][k] = step.quote && typeof val === 'string' ? `'${filled}'` : filled
        }
      }
      const before = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
      const after = setIniValues(before, set, step.spacing ?? ' = ')
      if (after !== before) {
        fs.mkdirSync(path.dirname(p), { recursive: true })
        fs.writeFileSync(p, after)
      }
      return
    }
    case 'kv': {
      const p = fill(step.file, v)
      const set = Object.fromEntries(Object.entries(step.set).map(([k, val]) => [k, fill(val, v)]))
      const before = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
      const after = setKvValues(before, set, step.sep)
      if (after !== before) {
        fs.mkdirSync(path.dirname(p), { recursive: true })
        fs.writeFileSync(p, after)
      }
      return
    }
  }
}

/** Make sure the emulator is portable and points at Starstation's folders. Safe to run before every launch. */
export function applyConsoleConfig(c: ConsolePreset): void {
  const e = getEmulator(c.emulator)
  if (!e) return
  const v = vars(c)
  for (const d of [dir('bios', c.id), dir('games', c.id), dir('saves', c.id), dir('media', 'screenshots', c.id)])
    fs.mkdirSync(d, { recursive: true })
  for (const step of [...e.portable, ...c.config]) {
    try {
      applyStep(step, v)
    } catch (err) {
      log.warn(`${c.id}: config step ${step.type} failed`, err)
    }
  }
  selectBios(c, v)
}

/** Pick BIOS files for emulators that need them named in their config (PCSX2, xemu). */
function selectBios(c: ConsolePreset, v: Record<string, string>): void {
  const raw = c.bios?.select
  const list = !raw ? [] : Array.isArray(raw) ? raw : [raw]
  for (const sel of list) {
    const file = fill(sel.file, v)
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    const unquote = (s?: string) => s?.replace(/^['"]|['"]$/g, '')
    const current = unquote(getIniValue(text, sel.section, sel.key))
    const candidates = candidateBios(c, sel.rule)
    if (!candidates.length) continue
    const asValue = (name: string) => (sel.fullPath ? path.join(v.bios, name) : name)
    if (current && candidates.some((n) => asValue(n).toLowerCase() === current.toLowerCase())) continue
    const prefer = sel.prefer ? new RegExp(sel.prefer, 'i') : null
    const pick = asValue((prefer && candidates.find((n) => prefer.test(n))) || [...candidates].sort()[0])
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, setIniValues(text, { [sel.section]: { [sel.key]: sel.quote ? `'${pick}'` : pick } }))
    log.info(`${c.id}: ${sel.key} set to ${pick}`)
  }
}

export function emulatorInstalled(c: ConsolePreset): boolean {
  const e = getEmulator(c.emulator)
  return !!e && fs.existsSync(path.join(emulatorDir(e), e.exe))
}
