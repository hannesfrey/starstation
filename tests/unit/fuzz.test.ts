import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discImage, discSerial, n3dsEncrypted, n3dsTitleId, n64Header, nintendoDiscId, ps3FromIso, referencedFiles } from '../../src/main/formats/gameid'
import { parseSfo } from '../../src/main/formats/sfo'
import { x360TitleId, xboxImageKind } from '../../src/main/formats/xdvdfs'
import { applyBps, applyIps } from '../../src/main/formats/patch'
import { withOneMii } from '../../src/main/formats/miidb'
import { parseUpdateXml } from '../../src/main/formats/ps3update'
import { guessGame, serialsIn } from '../../src/main/formats/modguess'
import { partsOf } from '../../src/main/fsutil'

/**
 * Robustness: every file reader gets hundreds of random and half-valid files (right signature, garbage after
 * it — what a damaged or half-downloaded game looks like). Each must answer or fail with an Error, quickly:
 * a reader that loops or crashes would freeze Starstation while it scans the library.
 */

const dir = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'fuzz-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

/** Same "random" files on every run (a failure can be repeated). */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const rand = rng(20261107)
const bytes = (n: number) => Buffer.from(Array.from({ length: n }, () => Math.floor(rand() * 256)))
const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)]

/** A random file, sometimes with a reader's signature in the right place. */
function sample(i: number): Buffer {
  const size = pick([0, 1, 15, 64, 0x200, 0x1000, 40 * 1024, 100 * 1024])
  const b = bytes(size)
  const put = (at: number, s: string | Buffer) => {
    const src = typeof s === 'string' ? Buffer.from(s, 'latin1') : s
    if (at + src.length <= b.length) src.copy(b, at)
  }
  switch (i % 7) {
    case 0: // ISO9660: CD001 at sector 16, root directory record with random place and size
      put(16 * 2048 + 1, 'CD001')
      break
    case 1: // PARAM.SFO
      put(0, Buffer.from([0x00, 0x50, 0x53, 0x46]))
      break
    case 2: // Xbox disc file system
      put(32 * 2048, 'MICROSOFT*XBOX*MEDIA')
      break
    case 3: // 3DS cartridge
      put(0x100, 'NCSD')
      break
    case 4: // N64 ROM
      put(0, Buffer.from([0x80, 0x37, 0x12, 0x40]))
      break
    case 5: // GameCube disc id
      put(0, 'GALE01')
      break
  }
  return b
}

/** Runs fn; it must finish quickly and either return or throw an Error. */
function calm(name: string, fn: () => unknown): void {
  const t0 = performance.now()
  try {
    fn()
  } catch (e) {
    if (!(e instanceof Error)) throw new Error(`${name} threw a non-Error: ${String(e)}`)
  }
  const ms = performance.now() - t0
  if (ms > 1500) throw new Error(`${name} took ${Math.round(ms)} ms`)
}

describe('file readers on damaged / random files', () => {
  it('disc and cartridge readers', () => {
    for (let i = 0; i < 280; i++) {
      const data = sample(i)
      for (const ext of ['.iso', '.bin', '.3ds', '.z64', '.gcm', '.xex']) {
        const f = path.join(dir, `g${i}${ext}`)
        fs.writeFileSync(f, data)
        calm(`discSerial ${ext} #${i}`, () => discSerial(f))
        calm(`ps3FromIso #${i}`, () => ps3FromIso(f))
        calm(`nintendoDiscId #${i}`, () => nintendoDiscId(f))
        calm(`n3dsTitleId #${i}`, () => n3dsTitleId(f))
        calm(`n3dsEncrypted #${i}`, () => n3dsEncrypted(f))
        calm(`n64Header #${i}`, () => n64Header(f))
        calm(`xboxImageKind #${i}`, () => xboxImageKind(f))
        calm(`x360TitleId #${i}`, () => x360TitleId(f))
        fs.rmSync(f)
      }
      calm(`parseSfo #${i}`, () => parseSfo(data))
    }
  })

  it('patches, Mii database, update lists, mod guessing', () => {
    for (let i = 0; i < 300; i++) {
      const src = bytes(pick([0, 16, 512, 4096]))
      const ips = Buffer.concat([Buffer.from('PATCH'), bytes(pick([0, 3, 40, 300])), i % 2 ? Buffer.from('EOF') : Buffer.alloc(0)])
      const bps = Buffer.concat([Buffer.from('BPS1'), bytes(pick([0, 12, 60, 400]))])
      calm(`applyIps #${i}`, () => applyIps(src, ips))
      calm(`applyBps #${i}`, () => applyBps(src, bps))
      calm(`withOneMii #${i}`, () => withOneMii(i % 3 ? bytes(pick([0, 100, 0xe4c0])) : null))
      const text = bytes(pick([0, 50, 2000])).toString('latin1')
      calm(`parseUpdateXml #${i}`, () => parseUpdateXml(`<titlepatch><tag><package version="${text}" size="x" url="${text}"/></tag></titlepatch>${text}`))
      calm(`serialsIn #${i}`, () => serialsIn(text))
      calm(`guessGame #${i}`, () => guessGame(text.slice(0, 40), text, [{ id: 'a', title: 'Gran Turismo 4', serial: 'SCUS-97328' }]))
    }
  })

  it('playlists that point at each other end instead of going round forever', () => {
    const a = path.join(dir, 'Game (Disc 1).m3u')
    const b = path.join(dir, 'Game (Disc 2).m3u')
    fs.writeFileSync(a, 'Game (Disc 2).m3u\n')
    fs.writeFileSync(b, 'Game (Disc 1).m3u\n')
    const self = path.join(dir, 'Self.m3u')
    fs.writeFileSync(self, 'Self.m3u\n')
    // no error allowed here (a stack overflow would also be an Error): plain answers only
    expect(partsOf(a).map((p) => path.basename(p))).toEqual(['Game (Disc 2).m3u'])
    expect(partsOf(self)).toEqual([])
    expect(discImage(a)).toBeNull()
    expect(discSerial(a)).toBeNull()
    expect(referencedFiles(a)).toHaveLength(1)
  })
})
