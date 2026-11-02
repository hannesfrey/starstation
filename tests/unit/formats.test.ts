import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseSfo } from '../../src/main/formats/sfo'
import { IsoReader } from '../../src/main/formats/iso9660'
import { cleanTitle, serialFromSystemCnf, referencedFiles } from '../../src/main/formats/gameid'
import { setIniValues, getIniValue, setKvValues } from '../../src/main/ini'
import { loadSerialDb } from '../../src/main/library/titledb'

function tmp(name: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'))
  return path.join(d, name)
}

/** Build a PARAM.SFO with string entries. */
export function makeSfo(entries: Record<string, string>): Buffer {
  const keys = Object.keys(entries)
  const keyTable = Buffer.concat(keys.map((k) => Buffer.from(k + '\0', 'utf8')))
  const keyPad = Buffer.alloc((4 - (keyTable.length % 4)) % 4)
  const values = keys.map((k) => {
    const v = Buffer.from(entries[k] + '\0', 'utf8')
    const max = Math.ceil(v.length / 4) * 4
    return { v, max }
  })
  const headerLen = 20 + keys.length * 16
  const keyStart = headerLen
  const dataStart = keyStart + keyTable.length + keyPad.length
  const header = Buffer.alloc(headerLen)
  header.writeUInt32LE(0x46535000, 0)
  header.writeUInt32LE(0x0101, 4)
  header.writeUInt32LE(keyStart, 8)
  header.writeUInt32LE(dataStart, 12)
  header.writeUInt32LE(keys.length, 16)
  let kOff = 0
  let dOff = 0
  keys.forEach((k, i) => {
    const e = 20 + i * 16
    header.writeUInt16LE(kOff, e)
    header.writeUInt16LE(0x0204, e + 2)
    header.writeUInt32LE(values[i].v.length, e + 4)
    header.writeUInt32LE(values[i].max, e + 8)
    header.writeUInt32LE(dOff, e + 12)
    kOff += Buffer.byteLength(k) + 1
    dOff += values[i].max
  })
  const data = Buffer.concat(values.map(({ v, max }) => Buffer.concat([v, Buffer.alloc(max - v.length)])))
  return Buffer.concat([header, keyTable, keyPad, data])
}

/** Minimal ISO9660 image: root dir with the given files (and optional one-level subdirectory). */
export function makeIso(files: Record<string, Buffer>): Buffer {
  const S = 2048
  const sectors: Buffer[] = []
  const alloc = (n: number) => {
    const at = sectors.length
    for (let i = 0; i < n; i++) sectors.push(Buffer.alloc(S))
    return at
  }
  alloc(16) // system area
  const pvd = alloc(1)
  const term = alloc(1)
  const rec = (name: string, lba: number, size: number, dir: boolean) => {
    const nb = Buffer.from(name, 'latin1')
    const len = 33 + nb.length + (nb.length % 2 === 0 ? 1 : 0)
    const r = Buffer.alloc(len)
    r[0] = len
    r.writeUInt32LE(lba, 2)
    r.writeUInt32BE(lba, 6)
    r.writeUInt32LE(size, 10)
    r.writeUInt32BE(size, 14)
    r[25] = dir ? 2 : 0
    r[32] = nb.length
    nb.copy(r, 33)
    return r
  }
  // group by directory
  const dirs = new Map<string, [string, Buffer][]>()
  for (const [p, data] of Object.entries(files)) {
    const parts = p.split('/')
    const d = parts.length > 1 ? parts[0] : ''
    if (!dirs.has(d)) dirs.set(d, [])
    dirs.get(d)!.push([parts[parts.length - 1], data])
    if (d && !dirs.has('')) dirs.set('', [])
  }
  const dirLba = new Map<string, number>()
  for (const d of dirs.keys()) dirLba.set(d, alloc(1))
  const fileLba = new Map<string, number>()
  for (const [p, data] of Object.entries(files)) {
    const at = alloc(Math.max(1, Math.ceil(data.length / S)))
    data.copy(sectors[at], 0, 0, Math.min(data.length, S))
    for (let i = 1; i * S < data.length; i++) data.copy(sectors[at + i], 0, i * S, Math.min(data.length, (i + 1) * S))
    fileLba.set(p, at)
  }
  for (const [d, list] of dirs) {
    const recs: Buffer[] = [rec('\0', dirLba.get(d)!, S, true), rec('\x01', dirLba.get('')!, S, true)]
    if (d === '') for (const sub of dirs.keys()) if (sub) recs.push(rec(sub, dirLba.get(sub)!, S, true))
    for (const [name, data] of list) recs.push(rec(name + ';1', fileLba.get(d ? `${d}/${name}` : name)!, data.length, false))
    Buffer.concat(recs).copy(sectors[dirLba.get(d)!])
  }
  const p = sectors[pvd]
  p[0] = 1
  p.write('CD001', 1, 'latin1')
  p[6] = 1
  rec('\0', dirLba.get('')!, S, true).copy(p, 156)
  const t = sectors[term]
  t[0] = 255
  t.write('CD001', 1, 'latin1')
  return Buffer.concat(sectors)
}

describe('PARAM.SFO', () => {
  it('reads title and id', () => {
    const sfo = parseSfo(makeSfo({ TITLE: 'Test Game', TITLE_ID: 'BLES01234', CATEGORY: 'DG' }))
    expect(sfo.TITLE).toBe('Test Game')
    expect(sfo.TITLE_ID).toBe('BLES01234')
    expect(sfo.CATEGORY).toBe('DG')
  })
  it('rejects other files', () => {
    expect(() => parseSfo(Buffer.from('hello world, not an sfo'))).toThrow()
  })
})

describe('ISO9660', () => {
  it('finds SYSTEM.CNF and nested files', () => {
    const f = tmp('test.iso')
    fs.writeFileSync(
      f,
      makeIso({ 'SYSTEM.CNF': Buffer.from('BOOT2 = cdrom0:\\SLES_537.17;1\r\nVER = 1.00\r\n'), 'PS3_GAME/PARAM.SFO': makeSfo({ TITLE: 'Nested' }) })
    )
    const iso = new IsoReader(f)
    const cnf = iso.readFile('SYSTEM.CNF')!.toString('latin1')
    expect(serialFromSystemCnf(cnf)).toBe('SLES-53717')
    expect(parseSfo(iso.readFile('PS3_GAME/PARAM.SFO')!).TITLE).toBe('Nested')
    expect(iso.readFile('MISSING.TXT')).toBeNull()
    iso.close()
  })
  it('reads the real PS2 game if present', () => {
    const real = 'C:/Users/Hannes/Desktop/Emulator/Emulation/roms/ps2/Midnight Club 3 - DUB Edition Remix (Europe, Australia) (En,Fr,De,Es,It).iso'
    if (!fs.existsSync(real)) return
    const iso = new IsoReader(real)
    expect(serialFromSystemCnf(iso.readFile('SYSTEM.CNF')!.toString('latin1'))).toBe('SLES-53717')
    iso.close()
  })
})

describe('serials and titles', () => {
  it('parses PS1 and PS2 boot lines', () => {
    expect(serialFromSystemCnf('BOOT = cdrom:\\SCUS_944.26;1')).toBe('SCUS-94426')
    expect(serialFromSystemCnf('BOOT=cdrom:SLUS_012.34;1')).toBe('SLUS-01234')
    expect(serialFromSystemCnf('BOOT2 = cdrom0:\\SLPM_123.45;1')).toBe('SLPM-12345')
    expect(serialFromSystemCnf('nothing')).toBeNull()
  })
  it('cleans file names', () => {
    expect(cleanTitle('Midnight Club 3 - DUB Edition Remix (Europe, Australia) (En,Fr,De,Es,It)')).toBe('Midnight Club 3 - DUB Edition Remix')
    expect(cleanTitle('Legend of Zelda, The - Ocarina of Time (USA) (Rev 1) [!]')).toBe('The Legend of Zelda - Ocarina of Time')
    expect(cleanTitle('super_mario_world')).toBe('super mario world')
  })
  it('lists files referenced by cue and m3u', () => {
    const cue = tmp('game.cue')
    fs.writeFileSync(cue, 'FILE "game (Track 1).bin" BINARY\n  TRACK 01 MODE2/2352\nFILE "game (Track 2).bin" BINARY\n')
    const refs = referencedFiles(cue)
    expect(refs).toHaveLength(2)
    expect(refs[0].endsWith('game (track 1).bin')).toBe(true)
    const m3u = tmp('ff7.m3u')
    fs.writeFileSync(m3u, '# discs\nFF7 (Disc 1).chd\nFF7 (Disc 2).chd\n')
    expect(referencedFiles(m3u)).toHaveLength(2)
  })
})

describe('ini editing', () => {
  it('changes only the given keys and keeps everything else', () => {
    const src = '[UI]\nTheme = dark\n\n[Folders]\nBios = old\nOpenPauseMenu = A\nOpenPauseMenu = B\n'
    const out = setIniValues(src, { Folders: { Bios: 'C:\\new', Cheats: 'x' }, New: { K: 'v' } })
    expect(out).toContain('Theme = dark')
    expect(out).toContain('Bios = C:\\new')
    expect(out).toContain('Cheats = x')
    expect(out.match(/OpenPauseMenu/g)).toHaveLength(2)
    expect(out).toContain('[New]\nK = v')
    expect(getIniValue(out, 'Folders', 'Bios')).toBe('C:\\new')
  })
  it('keeps CRLF line endings', () => {
    const out = setIniValues('[A]\r\nx = 1\r\n', { A: { x: '2' } })
    expect(out).toBe('[A]\r\nx = 2\r\n')
  })
  it('edits flat yaml', () => {
    const out = setKvValues('$(EmulatorDir): ""\n/dev_hdd0/: $(EmulatorDir)dev_hdd0/\n', { '/dev_hdd0/': 'C:/x/', '/games/': 'C:/g/' }, ': ')
    expect(out).toBe('$(EmulatorDir): ""\n/dev_hdd0/: C:/x/\n/games/: C:/g/\n')
  })
})

describe('title databases', () => {
  it('reads name, year, genre and players', () => {
    const f = tmp('gamedb.yaml')
    fs.writeFileSync(
      f,
      'SLUS-00001:\n  name: "Some Game (Disc 1)"\n  metadata:\n    releaseDate: "1998-06-18"\n    genre: "Racing"\n    maxPlayers: 2\nSLES-53717:\n  name: "Midnight Club 3 - DUB Edition Remix"\n  region: "PAL-M5"\n'
    )
    const db = loadSerialDb(f)
    expect(db.get('SLUS-00001')).toEqual({ name: 'Some Game (Disc 1)', year: '1998', genre: 'Racing', players: 2 })
    expect(db.get('SLES-53717')?.name).toBe('Midnight Club 3 - DUB Edition Remix')
  })
})
