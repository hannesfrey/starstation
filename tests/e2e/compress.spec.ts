import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { launchApp, makeFiles, writeSettings } from './helpers'

/** SPEC-v2 D: Compress (CHD / RVZ) and Decompress back to bit-identical files; play time follows the new file. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

const sha1 = (f: string) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex')
const DOLPHIN_TOOL = path.resolve(__dirname, '..', '..', '..', 'emulators', 'dolphin', 'DolphinTool.exe')
type Lib = { library: { games: { id: string; console: string; title: string; path: string }[]; stats: Record<string, { playTime: number }> } }

test('compress PS1 (2-track CD), PS2 (DVD) and GameCube games, then back to the exact originals', async () => {
  test.setTimeout(180_000)
  const files = makeFiles('compress')
  writeSettings(files, { bootAnimation: false })
  const ps1 = path.join(files, 'games', 'ps1')
  const ps2 = path.join(files, 'games', 'ps2')
  const gc = path.join(files, 'games', 'gc')
  for (const d of [ps1, ps2, gc]) fs.mkdirSync(d, { recursive: true })
  // PS1: data track + audio track, as a cue sheet with its own spacing (must come back exactly)
  fs.writeFileSync(path.join(ps1, 'Racer (Track 1).bin'), crypto.randomBytes(2352 * 400))
  fs.writeFileSync(path.join(ps1, 'Racer (Track 2).bin'), Buffer.alloc(2352 * 200, 5))
  const cueText = 'FILE "Racer (Track 1).bin" BINARY\r\n  TRACK 01 MODE2/2352\r\n    INDEX 01 00:00:00\r\nFILE "Racer (Track 2).bin" BINARY\r\n  TRACK 02 AUDIO\r\n    INDEX 00 00:00:00\r\n    INDEX 01 00:02:00\r\n'
  fs.writeFileSync(path.join(ps1, 'Racer.cue'), cueText)
  const tracks = ['Racer (Track 1).bin', 'Racer (Track 2).bin'].map((n) => sha1(path.join(ps1, n)))
  // PS2: a DVD image
  fs.writeFileSync(path.join(ps2, 'Flyer.iso'), Buffer.concat([crypto.randomBytes(2048 * 300), Buffer.alloc(2048 * 3000)]))
  const isoSha = sha1(path.join(ps2, 'Flyer.iso'))
  // GameCube: disc header + data; DolphinTool (copied from the real Dolphin) does the RVZ part
  const gcIso = Buffer.alloc(2 * 1024 * 1024)
  gcIso.write('GALE01', 0, 'latin1')
  gcIso.writeUInt32BE(0xc2339f3d, 0x1c)
  crypto.randomBytes(4096).copy(gcIso, 0x10000)
  fs.writeFileSync(path.join(gc, 'Cube.iso'), gcIso)
  const gcSha = sha1(path.join(gc, 'Cube.iso'))
  const haveDolphin = fs.existsSync(DOLPHIN_TOOL)
  if (haveDolphin) {
    fs.mkdirSync(path.join(files, 'emulators', 'dolphin'), { recursive: true })
    fs.copyFileSync(DOLPHIN_TOOL, path.join(files, 'emulators', 'dolphin', 'DolphinTool.exe'))
  }
  // some play time, to check it follows the game to its new file
  fs.mkdirSync(path.join(files, 'config', 'library'), { recursive: true })
  fs.writeFileSync(path.join(files, 'config', 'library', 'stats.json'), JSON.stringify({ 'ps1:racer.cue': { playTime: 3600, playCount: 2, favorite: true } }))

  const { app, page } = await launchApp(files)
  try {
    const game = async (c: string) => (await api<Lib>(page, 'getState')).library.games.find((g) => g.console === c)!
    const trash = () => fs.readdirSync(path.join(files, 'config', 'test-trash'))

    await expect.poll(async () => (await api<Lib>(page, 'getState')).library.games.length, { timeout: 10_000 }).toBe(3)

    // ---- PS1 → CHD
    let g = await game('ps1')
    expect((await api<{ compress?: { action: string } }>(page, 'gameDetails', g.id)).compress?.action).toBe('compress')
    expect(await api<{ ok: boolean }>(page, 'compressGame', g.id)).toEqual({ ok: true })
    expect(fs.readdirSync(ps1)).toEqual(['Racer.chd'])
    expect(trash().filter((n) => n.includes('Racer')).length).toBe(3) // cue + both tracks
    g = await game('ps1')
    expect(g.id).toBe('ps1:racer.chd')
    let st = await api<Lib>(page, 'getState')
    expect(st.library.stats['ps1:racer.chd']?.playTime).toBe(3600)
    expect(st.library.stats['ps1:racer.cue']).toBeUndefined()
    // ---- and back, bit for bit (same track names, same cue sheet)
    expect(await api<{ ok: boolean }>(page, 'compressGame', g.id)).toEqual({ ok: true })
    expect(fs.readdirSync(ps1).sort()).toEqual(['Racer (Track 1).bin', 'Racer (Track 2).bin', 'Racer.cue'])
    expect(['Racer (Track 1).bin', 'Racer (Track 2).bin'].map((n) => sha1(path.join(ps1, n)))).toEqual(tracks)
    expect(fs.readFileSync(path.join(ps1, 'Racer.cue'), 'latin1')).toBe(cueText)
    st = await api<Lib>(page, 'getState')
    expect(st.library.stats['ps1:racer.cue']?.playTime).toBe(3600)

    // ---- PS2 DVD → CHD → ISO
    g = await game('ps2')
    expect(await api<{ ok: boolean }>(page, 'compressGame', g.id)).toEqual({ ok: true })
    expect(fs.readdirSync(ps2)).toEqual(['Flyer.chd'])
    expect(fs.statSync(path.join(ps2, 'Flyer.chd')).size).toBeLessThan(2048 * 1000)
    g = await game('ps2')
    expect(await api<{ ok: boolean }>(page, 'compressGame', g.id)).toEqual({ ok: true })
    expect(sha1(path.join(ps2, 'Flyer.iso'))).toBe(isoSha)

    // ---- GameCube → RVZ → ISO
    if (haveDolphin) {
      g = await game('gc')
      expect(await api<{ ok: boolean }>(page, 'compressGame', g.id)).toEqual({ ok: true })
      expect(fs.readdirSync(gc)).toEqual(['Cube.rvz'])
      g = await game('gc')
      expect(await api<{ ok: boolean }>(page, 'compressGame', g.id)).toEqual({ ok: true })
      expect(sha1(path.join(gc, 'Cube.iso'))).toBe(gcSha)
    }
    // no work folders left, nothing in Documents
    expect(fs.readdirSync(path.join(files, 'config', 'compress')).filter((n) => n.startsWith('work-'))).toEqual([])

    // ---- storage overview
    const s = await api<{ consoles: { id: string; games: number }[]; free: number }>(page, 'storage', true)
    expect(s.consoles.find((c) => c.id === 'ps2')!.games).toBeGreaterThan(2048 * 3000)
    expect(s.free).toBeGreaterThan(0)
  } finally {
    await app.close()
  }
})
