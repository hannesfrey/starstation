import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { launchApp, makeFiles, makePresets, writeSettings, SOURCE } from './helpers'

/** SPEC-v2 E: patch-file mods — a patched copy of the game that starts while the mod is on. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

/** BPS patch that writes `target` (one TargetRead), made for `source` (its CRC32 is inside). */
function bps(source: Buffer, target: Buffer): Buffer {
  const num = (value: number) => {
    let n = value
    const out: number[] = []
    for (;;) {
      const x = n & 0x7f
      n = Math.floor(n / 128)
      if (n === 0) {
        out.push(0x80 | x)
        break
      }
      out.push(x)
      n--
    }
    return Buffer.from(out)
  }
  const body = Buffer.concat([Buffer.from('BPS1'), num(source.length), num(target.length), num(0), num((target.length - 1) * 4 + 1), target])
  const crcs = Buffer.alloc(8)
  crcs.writeUInt32LE(zlib.crc32(source), 0)
  crcs.writeUInt32LE(zlib.crc32(target), 4)
  const withCrcs = Buffer.concat([body, crcs])
  const own = Buffer.alloc(4)
  own.writeUInt32LE(zlib.crc32(withCrcs), 0)
  return Buffer.concat([withCrcs, own])
}

test('IPS / BPS / xdelta on a ROM, PPF on a compressed 2-track disc; the patched copy is what starts', async () => {
  test.setTimeout(120_000)
  const files = makeFiles('patchmods')
  const emu = path.join(files, '_fakeemu')
  const presets = makePresets(files, 300)
  writeSettings(files, { bootAnimation: false })
  const rom = Buffer.from('ORIGINAL ROM DATA 0123456789')
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Hero.tst'), rom)
  const inbox = path.join(files, '_in')
  fs.mkdirSync(inbox)
  // IPS: "ORIGINAL" → "PATCHED!" at 0
  fs.writeFileSync(path.join(inbox, 'English.ips'), Buffer.concat([Buffer.from('PATCH'), Buffer.from([0, 0, 0, 0, 8]), Buffer.from('PATCHED!'), Buffer.from('EOF')]))
  fs.writeFileSync(path.join(inbox, 'Hard Mode.bps'), bps(rom, Buffer.from('HARD MODE ROM')))
  fs.writeFileSync(path.join(inbox, 'Other Version.bps'), bps(Buffer.from('some other dump'), Buffer.from('x')))
  // xdelta, made with the real tool
  fs.writeFileSync(path.join(inbox, 'new.bin'), Buffer.from('XDELTA ROM DATA 0123456789!'))
  execFileSync(path.join(SOURCE, 'resources', 'bin', 'xdelta3.exe'), ['-e', '-f', '-s', path.join(files, 'games', 'testcon', 'Hero.tst'), path.join(inbox, 'new.bin'), path.join(inbox, 'Remix.xdelta')])

  // PS1: a 2-track disc (compressed to CHD by Starstation itself below) and a PPF3 patch for the data track
  const ps1 = path.join(files, 'games', 'ps1')
  fs.mkdirSync(ps1, { recursive: true })
  fs.writeFileSync(path.join(ps1, 'Racer (Track 1).bin'), Buffer.alloc(2352 * 300, 1))
  fs.writeFileSync(path.join(ps1, 'Racer (Track 2).bin'), Buffer.alloc(2352 * 100, 2))
  fs.writeFileSync(path.join(ps1, 'Racer.cue'), 'FILE "Racer (Track 1).bin" BINARY\r\n  TRACK 01 MODE2/2352\r\n    INDEX 01 00:00:00\r\nFILE "Racer (Track 2).bin" BINARY\r\n  TRACK 02 AUDIO\r\n    INDEX 01 00:00:00\r\n')
  const ppfHead = Buffer.alloc(60)
  ppfHead.write('PPF30', 0, 'latin1')
  const rec = Buffer.alloc(8 + 1 + 4)
  rec.writeBigUInt64LE(100n, 0)
  rec[8] = 4
  rec.write('EN!!', 9, 'latin1')
  fs.writeFileSync(path.join(inbox, 'Translation.ppf'), Buffer.concat([ppfHead, rec]))

  const { app, page } = await launchApp(files, presets)
  try {
    type Games = { library: { games: { id: string; console: string }[] } }
    await expect.poll(async () => (await api<Games>(page, 'getState')).library.games.length, { timeout: 10_000 }).toBe(2)
    const gid = 'testcon:hero.tst'
    const add = (n: string, g = gid) => api<{ ok: boolean; mod?: { id: string; target: string }; error?: string }>(page, 'modAdd', g, path.join(inbox, n))
    const ips = await add('English.ips')
    expect(ips.ok).toBe(true)
    expect(ips.mod!.target).toBe('Patched copy of the game')
    const bad = await add('Other Version.bps')
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('different version')
    const hard = await add('Hard Mode.bps')
    const remix = await add('Remix.xdelta')
    expect([hard.ok, remix.ok]).toEqual([true, true])

    const patched = (id: string) => path.join(files, 'mods', 'testcon', 'Hero', id, 'patched', 'Hero.tst')
    expect(fs.readFileSync(patched(ips.mod!.id), 'utf8')).toBe('PATCHED! ROM DATA 0123456789')
    expect(fs.readFileSync(patched(hard.mod!.id), 'utf8')).toBe('HARD MODE ROM')
    expect(fs.readFileSync(patched(remix.mod!.id), 'utf8')).toBe('XDELTA ROM DATA 0123456789!')

    // on: the patched copy starts; only one at a time; off: the game itself
    const launched = async () => {
      expect((await api<{ ok: boolean }>(page, 'launch', gid)).ok).toBe(true)
      await expect.poll(async () => (await api<{ running: unknown }>(page, 'getState')).running, { timeout: 10_000 }).toBeNull()
      const args = JSON.parse(fs.readFileSync(path.join(emu, 'launched.json'), 'utf8')) as string[]
      return args[args.length - 1]
    }
    await api(page, 'modToggle', gid, ips.mod!.id, true)
    expect(await launched()).toBe(patched(ips.mod!.id))
    await api(page, 'modToggle', gid, hard.mod!.id, true)
    const v = await api<{ mods: { id: string; enabled: boolean }[] }>(page, 'mods', gid)
    expect(v.mods.filter((m) => m.enabled).map((m) => m.id)).toEqual([hard.mod!.id])
    expect(await launched()).toBe(patched(hard.mod!.id))
    await api(page, 'modToggle', gid, hard.mod!.id, false)
    expect(await launched()).toBe(path.join(files, 'games', 'testcon', 'Hero.tst'))
    expect(fs.readFileSync(path.join(files, 'games', 'testcon', 'Hero.tst'))).toEqual(rom) // the game itself never changes

    // PS1: compressed first, then the PPF goes onto an unpacked copy
    const ps1Id = (await api<Games>(page, 'getState')).library.games.find((g) => g.console === 'ps1')!.id
    expect((await api<{ ok: boolean }>(page, 'compressGame', ps1Id)).ok).toBe(true)
    const chdId = (await api<Games>(page, 'getState')).library.games.find((g) => g.console === 'ps1')!.id
    const tr = await add('Translation.ppf', chdId)
    expect(tr.ok).toBe(true)
    const out = path.join(files, 'mods', 'ps1', 'Racer', tr.mod!.id, 'patched')
    const cue = fs.readdirSync(out).find((n) => n.endsWith('.cue'))!
    expect(cue).toBe('Racer (patched).cue')
    const t1 = fs.readFileSync(path.join(out, 'game (Track 1).bin'))
    expect(t1.toString('latin1', 100, 104)).toBe('EN!!')
    expect(t1[99]).toBe(1)
    expect(fs.readFileSync(path.join(out, 'game (Track 2).bin'))[0]).toBe(2)
    expect(fs.readFileSync(path.join(out, cue), 'latin1')).toContain('FILE "game (Track 2).bin"')
    expect(fs.readdirSync(path.join(files, 'mods', 'ps1', 'Racer')).filter((n) => n.startsWith('.patch-'))).toEqual([])
  } finally {
    await app.close()
  }
})
