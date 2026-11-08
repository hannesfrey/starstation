import { describe, expect, it } from 'vitest'
import { getIniValue, setIniValues, setKvValues, setYamlPlayers, stripLines } from '../../src/main/ini'

/**
 * The emulator settings writers rewrite the user's own config files before every game. Properties checked on
 * hundreds of generated files (fixed seed): writing the same settings twice changes nothing more, the values
 * can be read back, every line Starstation doesn't own survives untouched, and the line endings stay as they were.
 */

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const rand = rng(8112026)
const int = (n: number) => Math.floor(rand() * n)
const pick = <T>(a: readonly T[]) => a[int(a.length)]
const KEYS = ['Renderer', 'Fullscreen', 'Volume', 'Pad1', 'Pad.Type', 'Some Key', 'a_b', 'X', 'HotkeyF1', 'PauseOnFocusLoss']
const SECTIONS = ['EmuCore/GS', 'UI', 'Main', 'Pad1', 'Achievements', 'Core']
const VALUES = ['true', 'false', '0', '1', '"C:\\Users\\x\\Saves"', "'quoted'", 'Borderless Fullscreen', 'SDL-0/A', '', 'ä ü ß', '1.5']

/** A messy but valid INI: comments, blank lines, duplicate keys, a key before any section, odd spacing. */
function iniText(): string {
  const eol = rand() < 0.5 ? '\r\n' : '\n'
  const lines: string[] = []
  if (rand() < 0.5) lines.push(`${pick(KEYS)} = ${pick(VALUES)}`)
  for (let s = int(4); s >= 0; s--) {
    if (rand() < 0.3) lines.push('; a comment line')
    lines.push(`[${pick(SECTIONS)}]`)
    for (let k = int(6); k > 0; k--) {
      const r = rand()
      if (r < 0.15) lines.push('')
      else if (r < 0.25) lines.push('# note = not a key')
      else lines.push(`${pick(['', ' '])}${pick(KEYS)}${pick([' = ', '=', ' =  '])}${pick(VALUES)}`)
    }
  }
  return lines.join(eol) + (rand() < 0.8 ? eol : '')
}

const eolOf = (t: string) => (t.includes('\r\n') ? '\r\n' : '\n')
const noMixedEols = (t: string) => {
  const crlf = (t.match(/\r\n/g) ?? []).length
  const lf = (t.match(/\n/g) ?? []).length
  return crlf === 0 || crlf === lf
}

describe('emulator settings writers on generated files', () => {
  it('INI: idempotent, readable, other lines kept, line endings kept', () => {
    for (let i = 0; i < 400; i++) {
      const text = iniText()
      const set: Record<string, Record<string, string>> = {}
      for (let n = int(3) + 1; n > 0; n--) (set[pick(SECTIONS)] ??= {})[pick(KEYS)] = pick(VALUES.filter(Boolean))
      const once = setIniValues(text, set)
      expect(setIniValues(once, set), `#${i}`).toBe(once)
      for (const [sec, entries] of Object.entries(set)) for (const [k, v] of Object.entries(entries)) expect(getIniValue(once, sec, k), `#${i} [${sec}] ${k}`).toBe(v)
      if (text.trim()) expect(eolOf(once)).toBe(eolOf(text))
      expect(noMixedEols(once), `#${i} mixed line endings`).toBe(true)
      // every comment and every line of a key Starstation didn't set is still there
      const owned = new Set(Object.values(set).flatMap((e) => Object.keys(e)))
      const keyOf = (l: string) => /^\s*([^=]+?)\s*=/.exec(l)?.[1]
      for (const l of text.split(/\r?\n/).filter((x) => x.trim() && !owned.has(keyOf(x) ?? ''))) expect(once.split(/\r?\n/), `#${i} lost "${l}"`).toContain(l)
    }
  })

  it('key = value files: idempotent, readable, other lines kept', () => {
    for (let i = 0; i < 300; i++) {
      const eol = rand() < 0.5 ? '\r\n' : '\n'
      const sep = pick([' = ', ': '])
      const lines = Array.from({ length: int(12) }, () => (rand() < 0.2 ? '# comment' : `${pick(['', '  '])}${pick(KEYS)}${sep}${pick(VALUES)}`))
      const text = lines.length ? lines.join(eol) + eol : ''
      const set = Object.fromEntries(Array.from({ length: int(3) + 1 }, () => [pick(KEYS), pick(VALUES)]))
      const once = setKvValues(text, set, sep)
      expect(setKvValues(once, set, sep), `#${i}`).toBe(once)
      for (const [k, v] of Object.entries(set)) expect(once.split(/\r?\n/).some((l) => l.trim() === `${k}${sep}${v}`.trim()), `#${i} ${k}`).toBe(true)
      for (const l of lines.filter((x) => x.startsWith('#'))) expect(once).toContain(l)
      expect(noMixedEols(once)).toBe(true)
    }
  })

  it('RPCS3 players: idempotent, other blocks kept', () => {
    const handlers = ['XInput', 'DualShock 4', '"Null"', 'Keyboard']
    for (let i = 0; i < 300; i++) {
      const eol = rand() < 0.5 ? '\r\n' : '\n'
      const blocks: string[] = []
      for (let p = 1; p <= int(5); p++) {
        blocks.push(`Player ${p} Input:`, `  Handler: ${pick(handlers)}`, `  Device: "Pad #${p}"`)
        if (rand() < 0.7) blocks.push('  Config:', ...Array.from({ length: int(8) }, (_v, j) => `    Button${j}: ${pick(['A', 'B', '""'])}`))
        blocks.push('  Buddy Device: ""')
      }
      blocks.push('Other Setting:', '  Keep: me')
      const text = blocks.join(eol) + eol
      const players = Array.from({ length: int(4) + 1 }, (_v, j) => ({ Handler: pick(handlers), Device: `"Pad #${j + 1}"` }))
      const config: Record<string, string> = rand() < 0.5 ? { 'PS Button': '""' } : {}
      const once = setYamlPlayers(text, players, config, { 'Vendor ID': '1356' })
      expect(setYamlPlayers(once, players, config, { 'Vendor ID': '1356' }), `#${i}`).toBe(once)
      expect(once).toContain(`Other Setting:${eol}  Keep: me`)
      for (const [j, pl] of players.entries()) expect(once).toContain(`Player ${j + 1} Input:${eol}  Handler: ${pl.Handler}${eol}  Device: ${pl.Device}`)
      expect(noMixedEols(once)).toBe(true)
    }
  })

  it('stripLines removes only matching lines, and says "nothing to do" when none match', () => {
    for (let i = 0; i < 200; i++) {
      const text = iniText()
      const out = stripLines(text, '^\\s*Volume\\s*=')
      const had = text.split(/\r?\n/).some((l) => /^\s*Volume\s*=/.test(l))
      if (!had) {
        expect(out).toBeNull()
        continue
      }
      expect(out!.split(/\r?\n/).some((l) => /^\s*Volume\s*=/.test(l))).toBe(false)
      expect(out!.split(/\r?\n/).length).toBe(text.split(/\r?\n/).length - text.split(/\r?\n/).filter((l) => /^\s*Volume\s*=/.test(l)).length)
    }
  })
})
