import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { launchApp, makeFiles, makePresets, writeSettings } from './helpers'

/**
 * Mods put into the mods folder are added by themselves (Hannes, 2026-11-07): game from the name or readme,
 * asked when unclear, switched on, original to the Recycle Bin; a patch for another game version is refused in words.
 */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

const TAR = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
function zip(out: string, folder: string, files: Record<string, string>, latin1: string[] = []): void {
  const src = path.join(path.dirname(out), '..', '..', '_zipsrc', path.basename(out))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(src, folder, rel)), { recursive: true })
    fs.writeFileSync(path.join(src, folder, rel), text, latin1.includes(rel) ? 'latin1' : 'utf8')
  }
  // build next to the inbox, then move in (like a finished download)
  const tmp = `${src}.zip`
  execFileSync(TAR, ['-a', '-cf', tmp, '-C', src, folder])
  fs.renameSync(tmp, out)
}

type Notice = { title: string; detail?: string }
/** The start of a real xdelta (VCDIFF) file. */
const VCDIFF = '\u00d6\u00c3\u00c4\u0000 not really a patch'
type ModsView = { mods: { id: string; name: string; enabled: boolean }[] }

test.afterEach(() => {
  delete process.env.STARSTATION_MODS_POLL
})

test('mods folder: recognised, asked when unclear, switched on, binned; wrong game version explained', async () => {
  test.setTimeout(120_000)
  process.env.STARSTATION_MODS_POLL = '400'
  const files = makeFiles('modinbox')
  const emu = path.join(files, '_fakeemu')
  const presets = makePresets(files, 300, {
    extra: {
      extensions: ['.tst', '.iso'],
      mods: {
        targets: [{ id: 'textures', label: 'Texture pack', dir: '{emu}/textures/{basename}', match: '\\.png$', anchor: '^replacements$', into: 'replacements' }]
      }
    }
  })
  writeSettings(files, { bootAnimation: false })
  const games = path.join(files, 'games', 'testcon')
  fs.mkdirSync(games, { recursive: true })
  fs.writeFileSync(path.join(games, 'Alpha.tst'), 'a')
  fs.writeFileSync(path.join(games, 'Beta Racing (USA).tst'), 'b')
  fs.writeFileSync(path.join(games, 'Gamma.iso'), 'gamma disc image')
  const inbox = path.join(files, 'mods', 'testcon')
  fs.mkdirSync(inbox, { recursive: true })
  // an empty folder made by hand (Hannes made one in mods\ps2 following a readme): ignored, no message
  fs.mkdirSync(path.join(inbox, 'SCUS-97328'))

  const { app, page } = await launchApp(files, presets)
  try {
    await page.waitForFunction(() => !!(window as unknown as { starstation?: unknown }).starstation)
    await page.evaluate(() => {
      const w = window as unknown as { __n: unknown[]; __ask: unknown[]; starstation: { on: (c: string, f: (x: unknown) => void) => void } }
      w.__n = []
      w.__ask = []
      w.starstation.on('notice', (n) => w.__n.push(n))
      w.starstation.on('mod-inbox-ask', (q) => w.__ask.push(q))
    })
    const notices = () => page.evaluate(() => (window as unknown as { __n: Notice[] }).__n.slice())
    await expect.poll(async () => (await api<{ library: { games: unknown[] } }>(page, 'getState')).library.games.length).toBe(3)

    // 1) the game's name is in the mod's name: added, on, extras ("Alternate Textures") not placed, zip binned
    zip(path.join(inbox, 'Beta Racing HD HUD pack v1.1.zip'), 'Beta Racing HD HUD pack', {
      'replacements/hud/a.png': 'hud',
      'Alternate Textures/glow/a.png': 'optional glow',
      'How to install.txt': 'put replacements into textures'
    })
    const beta = path.join(emu, 'textures', 'Beta Racing (USA)', 'replacements')
    await expect.poll(() => fs.existsSync(path.join(beta, 'hud', 'a.png')), { timeout: 20_000 }).toBe(true)
    expect(fs.readFileSync(path.join(beta, 'hud', 'a.png'), 'utf8')).toBe('hud')
    expect(fs.existsSync(path.join(beta, 'Alternate Textures'))).toBe(false)
    expect(fs.existsSync(path.join(inbox, 'Beta Racing HD HUD pack v1.1.zip'))).toBe(false)
    expect((await notices()).some((n) => n.title === 'Mod installed and on')).toBe(true)
    const betaMods = await api<ModsView>(page, 'mods', 'testcon:beta racing (usa).tst')
    expect(betaMods.mods.map((m) => [m.name, m.enabled])).toEqual([['Beta Racing HD HUD pack v1.1', true]])

    // 2) nothing tells the game: asked; the answer installs it
    zip(path.join(inbox, 'Retexture Mod 3.0.zip'), 'Retexture', { 'replacements/cars/car.png': 'car', 'replacements/cars/read this.txt': 'optional hood' })
    await expect.poll(() => page.evaluate(() => (window as unknown as { __ask: unknown[] }).__ask.length), { timeout: 20_000 }).toBe(1)
    const q = await page.evaluate(() => (window as unknown as { __ask: { id: string; name: string; games: string[] }[] }).__ask[0])
    expect(q.name).toBe('Retexture Mod 3.0')
    expect(q.games).toHaveLength(3)
    await api(page, 'modInboxAssign', q.id, 'testcon:alpha.tst')
    await expect.poll(() => fs.existsSync(path.join(emu, 'textures', 'Alpha', 'replacements', 'cars', 'car.png')), { timeout: 20_000 }).toBe(true)
    expect(fs.existsSync(path.join(inbox, 'Retexture Mod 3.0.zip'))).toBe(false)

    // 3) a patch whose readme names another version of the game (by MD5): refused in plain words, kept, not retried
    zip(path.join(inbox, 'Gamma Spec II.zip'), 'Gamma Spec II', {
      'Gamma Spec II.xdelta': VCDIFF,
      'Installation Instructions.txt': 'To get started, ensure you have the Online Public Beta of Gamma.\nUse a file hashing tool to verify that the MD5 hash is 3306538778dda2ded87ceaf52c944a98.'
    }, ['Gamma Spec II.xdelta'])
    await expect.poll(async () => (await notices()).find((n) => n.title === 'Mod not added: Gamma Spec II')?.detail ?? '', { timeout: 20_000 }).toContain('different version of the game')
    const detail = (await notices()).find((n) => n.title === 'Mod not added: Gamma Spec II')!.detail!
    expect(detail).toContain('Online Public Beta')
    expect(detail).toContain('Gamma.iso')
    expect(fs.existsSync(path.join(inbox, 'Gamma Spec II.zip'))).toBe(true)
    await page.waitForTimeout(2000)
    expect((await notices()).filter((n) => n.title === 'Mod not added: Gamma Spec II')).toHaveLength(1)

    // 4) nothing in it the emulator loads: kept with its instructions, not placed anywhere
    zip(path.join(inbox, 'Alpha Tool.zip'), 'Alpha Tool', { 'tool.exe': 'MZ', 'readme.txt': 'Run tool.exe on your save' })
    await expect.poll(async () => (await notices()).some((n) => n.title === 'Mod kept: install it by hand'), { timeout: 20_000 }).toBe(true)
    const alphaMods = await api<{ mods: { name: string; manual?: unknown }[] }>(page, 'mods', 'testcon:alpha.tst')
    expect(alphaMods.mods.find((m) => m.name === 'Alpha Tool')?.manual).toBeTruthy()
    expect(fs.existsSync(path.join(emu, 'textures', 'Alpha', 'replacements', 'tool.exe'))).toBe(false)

    expect((await notices()).some((n) => n.title.includes('SCUS-97328'))).toBe(false)
    // nothing left half-way
    expect(fs.readdirSync(path.join(files, 'mods', '.unpacking'))).toEqual([])
  } finally {
    await app.close()
  }
})
