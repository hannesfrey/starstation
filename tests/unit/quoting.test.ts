import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getIniValue, setIniValues } from '../../src/main/ini'

process.env.STARSTATION_FILES ??= fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'quoting-files-'))
const { quoteValue, unquoteValue } = await import('../../src/main/emuconfig')

/** Paths from PCs that aren't Hannes's: accents, spaces, an apostrophe, "&", even a double quote in a name. */
const PATHS = [
  String.raw`C:\Users\Hannes\Desktop\Starstation\Files\bios\xbox\mcpx_1.0.bin`,
  String.raw`C:\Users\O'Brien\Desktop\Starstation\Files\bios\xbox\mcpx_1.0.bin`,
  String.raw`C:\Users\José Müller\Desktop\Star Station & Co\Files\bios\xbox\Complex_4627.bin`,
  String.raw`D:\Spiele\Ünïcödé 日本 (1)\Files\bios\xbox\xbox_hdd.qcow2`,
  String.raw`C:\Users\a"b\Files\x.bin`
]

describe('quoted paths in emulator settings (xemu TOML)', () => {
  it('every path reads back exactly as written', () => {
    for (const p of PATHS) expect(unquoteValue(quoteValue(p))).toBe(p)
  })

  it('an apostrophe never ends up inside a single-quoted (TOML literal) string', () => {
    for (const p of PATHS) {
      const q = quoteValue(p)
      if (q.startsWith("'")) expect(q.slice(1, -1)).not.toContain("'")
      else expect(q.startsWith('"') && q.endsWith('"')).toBe(true)
    }
    // the basic-string form escapes backslashes, as TOML wants
    expect(quoteValue(String.raw`C:\Users\O'Brien\x.bin`)).toBe(String.raw`"C:\\Users\\O'Brien\\x.bin"`)
  })

  it('through the settings file and back: unchanged, and writing it again changes nothing', () => {
    for (const p of PATHS) {
      const once = setIniValues('[sys.files]\nbootrom_path = \'\'\n', { 'sys.files': { bootrom_path: quoteValue(p) } })
      expect(unquoteValue(getIniValue(once, 'sys.files', 'bootrom_path'))).toBe(p)
      expect(setIniValues(once, { 'sys.files': { bootrom_path: quoteValue(p) } })).toBe(once)
    }
  })
})
