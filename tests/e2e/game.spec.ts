import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, makePresets, writeSettings } from './helpers'

/** Step 6: quick resume, save backups, search, collections, delete, add games. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

async function waitIdle(page: Page) {
  await expect(page.getByTestId('running')).toHaveCount(0, { timeout: 15_000 })
}

function setup(name: string, games: string[]) {
  const files = makeFiles(name)
  const presets = makePresets(files, 400, { quickResume: true })
  writeSettings(files, { bootAnimation: false })
  const gdir = path.join(files, 'games', 'testcon')
  fs.mkdirSync(gdir, { recursive: true })
  for (const g of games) fs.writeFileSync(path.join(gdir, g), g)
  return { files, presets, gdir, saves: path.join(files, 'saves', 'testcon') }
}

test('quick resume and save backups (before launch, restore, keep 5)', async () => {
  const { files, presets, saves } = setup('resume', ['Alpha.tst'])
  fs.mkdirSync(saves, { recursive: true })
  fs.writeFileSync(path.join(saves, 'Alpha.sav'), 'v1')
  const { app, page } = await launchApp(files, presets)
  await expect(page.getByTestId('game-info')).toContainText('Alpha')
  const id = 'testcon:alpha.tst'

  // first play: no resume state yet → plays straight away, saves are backed up first
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('running')).toBeVisible()
  await waitIdle(page)
  const launched1 = JSON.parse(fs.readFileSync(path.join(files, '_fakeemu', 'launched.json'), 'utf8')) as string[]
  expect(launched1).not.toContain('--resume')
  type Details = { resume: { savedAt: number } | null; backups: { id: string; reason: string; folder: string }[]; ownSaves: number }
  let d = await api<Details>(page, 'gameDetails', id)
  expect(d.backups).toHaveLength(1)
  expect(fs.readFileSync(path.join(d.backups[0].folder, '0-Alpha.sav'), 'utf8')).toBe('v1')
  expect(d.resume).not.toBeNull()

  // second play: Resume / Start fresh is offered; Resume passes the state to the emulator
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('panel-resume')).toBeVisible()
  await expect(page.getByTestId('pitem-resume')).toHaveClass(/active/)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('running')).toBeVisible()
  await waitIdle(page)
  const launched2 = JSON.parse(fs.readFileSync(path.join(files, '_fakeemu', 'launched.json'), 'utf8')) as string[]
  // (Node hides the script name: the recorded args start right after fake-emu.js, where `at: 1` put them)
  expect(launched2[0]).toBe('--resume')
  expect(launched2[1]).toContain(path.join('states', 'Alpha.state'))
  expect(launched2[2]).toContain('Alpha.tst')

  // Triangle menu: Start fresh
  await page.keyboard.press(' ')
  await expect(page.getByTestId('panel-game')).toBeVisible()
  await expect(page.getByTestId('pitem-resume')).toBeVisible()
  await page.getByTestId('pitem-fresh').dblclick()
  await expect(page.getByTestId('running')).toBeVisible()
  await waitIdle(page)
  const launched3 = JSON.parse(fs.readFileSync(path.join(files, '_fakeemu', 'launched.json'), 'utf8')) as string[]
  expect(launched3).not.toContain('--resume')
  // the resume state from before "Start fresh" was kept and can be brought back
  expect((await api<{ previousResume: number | null }>(page, 'gameDetails', id)).previousResume).not.toBeNull()
  expect((await api<{ ok: boolean }>(page, 'restorePreviousResume', id)).ok).toBe(true)

  // restore the very first backup: Alpha.sav is "v1" again, and the current saves were backed up first
  d = await api<Details>(page, 'gameDetails', id)
  const first = d.backups[d.backups.length - 1]
  expect(fs.readFileSync(path.join(saves, 'Alpha.sav'), 'utf8')).not.toBe('v1')
  expect((await api<{ ok: boolean }>(page, 'restoreBackup', id, first.id)).ok).toBe(true)
  expect(fs.readFileSync(path.join(saves, 'Alpha.sav'), 'utf8')).toBe('v1')
  d = await api<Details>(page, 'gameDetails', id)
  expect(d.backups[0].reason).toBe('before-restore')

  // many launches: only the newest 5 backups stay
  for (let i = 0; i < 4; i++) {
    expect((await api<{ ok: boolean }>(page, 'launch', id, 'fresh')).ok).toBe(true)
    await waitIdle(page)
  }
  d = await api<Details>(page, 'gameDetails', id)
  expect(d.backups).toHaveLength(5)
  await app.close()
})

test('search with the on-screen keyboard, collections, delete and add games', async () => {
  const { files, presets, gdir, saves } = setup('library', ['Alpha.tst', 'Beta Racer.tst'])
  const { app, page } = await launchApp(files, presets)
  await expect(page.getByTestId('game-info')).toContainText('Alpha')

  // ---- search: Ctrl+F, type on the real keyboard, Enter → results, Enter → play
  await page.keyboard.press('Control+f')
  await expect(page.getByTestId('entry-search')).toBeVisible()
  await page.keyboard.type('rac')
  await expect(page.getByTestId('entry-value')).toContainText('rac')
  const results = page.getByTestId('entry-results')
  await expect(results.getByText('Beta Racer')).toBeVisible()
  await expect(results.getByText('Alpha')).toHaveCount(0)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('running')).toBeVisible()
  await waitIdle(page)
  const launched = JSON.parse(fs.readFileSync(path.join(files, '_fakeemu', 'launched.json'), 'utf8')) as string[]
  expect(launched[launched.length - 1]).toContain('Beta Racer.tst')

  // on-screen keys (mouse/controller) write Title case; Delete removes a letter; Escape closes
  await page.keyboard.press('ArrowLeft') // results → keyboard
  for (let i = 0; i < 3; i++) await page.getByTestId('key-DELETE').click()
  await page.getByTestId('key-A').click()
  await page.getByTestId('key-L').click()
  await expect(page.getByTestId('entry-value')).toHaveText('Al')
  await expect(results.getByText('Alpha')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('entry-search')).toHaveCount(0)

  // ---- collections: Triangle → Add to collection → New collection → name it
  await page.keyboard.press(' ')
  await expect(page.getByTestId('panel-game')).toBeVisible()
  await page.getByTestId('pitem-collect').dblclick()
  await expect(page.getByTestId('panel-add-to-collection')).toBeVisible()
  await page.getByTestId('pitem-new').dblclick()
  await expect(page.getByTestId('entry-new-collection')).toBeVisible()
  await page.keyboard.type('Racing')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('notices')).toContainText('Collection created')
  type State = { collections: { id: string; name: string; games: string[] }[]; library: { games: { id: string; title: string; path: string }[] } }
  let st = await api<State>(page, 'getState')
  expect(st.collections).toHaveLength(1)
  expect(st.collections[0].name).toBe('Racing')
  const selected = st.collections[0].games[0]
  expect(['testcon:alpha.tst', 'testcon:beta racer.tst']).toContain(selected)
  // it shows in the Collections column, plus automatic ones
  await page.getByTestId('cat-collections').click()
  await expect(page.getByTestId('items').getByText('Racing')).toBeVisible()
  await expect(page.getByTestId('items').getByText('Recently added')).toBeVisible()
  await expect(page.getByTestId('items').getByText('Not played yet')).toBeVisible()

  // ---- delete Beta with its saves: game + own save go to the (test) trash, library forgets it
  expect(fs.existsSync(path.join(saves, 'Beta Racer.sav'))).toBe(true)
  expect((await api<{ ok: boolean }>(page, 'deleteGame', 'testcon:beta racer.tst', true)).ok).toBe(true)
  expect(fs.existsSync(path.join(gdir, 'Beta Racer.tst'))).toBe(false)
  expect(fs.existsSync(path.join(saves, 'Beta Racer.sav'))).toBe(false)
  expect(fs.readdirSync(path.join(files, 'config', 'test-trash')).some((n) => n.endsWith('Beta Racer.tst'))).toBe(true)
  st = await api<State>(page, 'getState')
  expect(st.library.games.map((g) => g.title)).toEqual(['Alpha'])
  expect(st.collections[0].games).not.toContain('testcon:beta racer.tst')

  // ---- add games: a known file type is moved straight in; an ambiguous one asks which console
  const incoming = path.join(files, '_incoming')
  fs.mkdirSync(incoming, { recursive: true })
  fs.writeFileSync(path.join(incoming, 'Gamma.tst'), 'g')
  fs.writeFileSync(path.join(incoming, 'Mystery.chd'), 'c')
  type Add = { added: { path: string; console: string; title?: string }[]; ask: { path: string; options: string[] }[]; errors: string[] }
  const r = await api<Add>(page, 'addGames', [path.join(incoming, 'Gamma.tst'), path.join(incoming, 'Mystery.chd')])
  expect(r.added.map((a) => a.console)).toEqual(['testcon'])
  expect(r.added[0].title).toBe('Gamma')
  expect(fs.existsSync(path.join(gdir, 'Gamma.tst'))).toBe(true)
  expect(fs.existsSync(path.join(incoming, 'Gamma.tst'))).toBe(false)
  expect(r.ask).toHaveLength(1)
  expect(r.ask[0].options).toEqual(expect.arrayContaining(['ps1', 'ps2']))
  const r2 = await api<Add>(page, 'addGames', [path.join(incoming, 'Mystery.chd')], 'ps2')
  expect(r2.added[0].console).toBe('ps2')
  expect(fs.existsSync(path.join(files, 'games', 'ps2', 'Mystery.chd'))).toBe(true)
  // adding the same file again is refused, nothing is overwritten
  fs.writeFileSync(path.join(incoming, 'Gamma.tst'), 'other')
  const r3 = await api<Add>(page, 'addGames', [path.join(incoming, 'Gamma.tst')])
  expect(r3.added).toHaveLength(0)
  expect(r3.errors[0]).toContain('already')
  expect(fs.readFileSync(path.join(gdir, 'Gamma.tst'), 'utf8')).toBe('g')
  await app.close()
})

test('add games tells disc images apart by their contents', async () => {
  const { files, presets } = setup('sniff', [])
  const incoming = path.join(files, '_incoming')
  fs.mkdirSync(incoming, { recursive: true })
  const gc = Buffer.alloc(0x440)
  gc.write('GALE01', 0, 'latin1')
  gc.writeUInt32BE(0xc2339f3d, 0x1c)
  fs.writeFileSync(path.join(incoming, 'Cube Game.iso'), gc)
  const wii = Buffer.alloc(0x440)
  wii.write('RSPE01', 0, 'latin1')
  wii.writeUInt32BE(0x5d1c9ea3, 0x18)
  fs.writeFileSync(path.join(incoming, 'Wii Game.iso'), wii)
  // rebuilt Xbox xiso: XDVDFS volume descriptor at 0x10000, root directory naming default.xbe
  const xbox = Buffer.alloc(0x12000)
  xbox.write('MICROSOFT*XBOX*MEDIA', 0x10000, 'latin1')
  xbox.writeUInt32LE(0x22, 0x10014) // root dir sector
  xbox.writeUInt32LE(0x800, 0x10018)
  xbox.write('default.xbe', 0x22 * 2048 + 14, 'latin1')
  fs.writeFileSync(path.join(incoming, 'Box Game.iso'), xbox)
  const { app, page } = await launchApp(files, presets)
  type Add = { added: { console: string }[]; ask: unknown[]; errors: string[] }
  const r = await api<Add>(page, 'addGames', ['Cube Game.iso', 'Wii Game.iso', 'Box Game.iso'].map((n) => path.join(incoming, n)))
  expect(r.errors).toEqual([])
  expect(r.ask).toEqual([])
  expect(r.added.map((a) => a.console).sort()).toEqual(['gc', 'wii', 'xbox'])
  expect(fs.existsSync(path.join(files, 'games', 'gc', 'Cube Game.iso'))).toBe(true)
  expect(fs.existsSync(path.join(files, 'games', 'xbox', 'Box Game.iso'))).toBe(true)
  await app.close()
})

test('per-game graphics, CRT filter and patches; controller mapping follows the connected pad', async () => {
  const files = makeFiles('options')
  const level = (n: string) => ({ steps: [{ type: 'ini', file: '{emu}/gfx.ini', set: { GS: { scale: n } } }] })
  const presets = makePresets(files, 1500, {
    extra: {
      shaderHint: true,
      controls: [{ type: 'ini', file: '{emu}/controls.ini', set: { Pad1: { Cross: '{pad}/A' }, Players: { Count: '{players}' }, Hotkeys: { Screenshot: ['Keyboard/F12', '{padshot}', '{padshare}'] } } }],
      graphics: { original: level('1'), enhanced: level('3'), max: level('6') },
      crt: { on: { args: ['--crt'] }, off: {} },
      patches: [
        {
          id: 'wide',
          label: 'Widescreen patch',
          on: { steps: [{ type: 'ini', file: '{emu}/gfx.ini', set: { Patches: { wide: 'true' } } }] },
          off: { steps: [{ type: 'ini', file: '{emu}/gfx.ini', set: { Patches: { wide: 'false' } } }] }
        }
      ]
    }
  })
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Alpha.tst'), 'a')
  const emu = path.join(files, '_fakeemu')
  const { app, page } = await launchApp(files, presets)
  await expect(page.getByTestId('game-info')).toContainText('Alpha')

  // Triangle menu shows the options with their defaults; ✕ cycles / toggles them
  await page.keyboard.press(' ')
  await expect(page.getByTestId('pitem-graphics')).toContainText('Enhanced')
  await page.getByTestId('pitem-graphics').dblclick()
  await expect(page.getByTestId('pitem-graphics')).toContainText('Max')
  await expect(page.getByTestId('pitem-crt')).toContainText('Off')
  await page.getByTestId('pitem-crt').dblclick()
  await expect(page.getByTestId('pitem-crt')).toContainText('On')
  await page.getByTestId('pitem-patch-wide').dblclick()
  await expect(page.getByTestId('pitem-patch-wide')).toContainText('On')

  // first start of a console with a shader hint: the notice shows, then the game starts
  await page.getByTestId('pitem-play').dblclick()
  await expect(page.getByTestId('notices')).toContainText('may stutter')
  await expect(page.getByTestId('running')).toBeVisible({ timeout: 10_000 })
  await waitIdle(page)
  const gfx = fs.readFileSync(path.join(emu, 'gfx.ini'), 'utf8')
  expect(gfx).toContain('scale = 6')
  expect(gfx).toContain('wide = true')
  expect(JSON.parse(fs.readFileSync(path.join(emu, 'launched.json'), 'utf8'))).toContain('--crt')
  let controls = fs.readFileSync(path.join(emu, 'controls.ini'), 'utf8')
  expect(controls).toContain('Cross = XInput-0/A')
  expect(controls.match(/^Screenshot = /gm)).toHaveLength(1)

  // a DualShock 4 without XInput driver: bindings switch to SDL, touchpad + share take screenshots too
  await api(page, 'reportPads', ['Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', 'G29 Driving Force Racing Wheel'])
  await api(page, 'setGameOption', 'testcon:alpha.tst', 'crt', false)
  expect((await api<{ ok: boolean }>(page, 'launch', 'testcon:alpha.tst', 'fresh')).ok).toBe(true)
  await waitIdle(page)
  controls = fs.readFileSync(path.join(emu, 'controls.ini'), 'utf8')
  expect(controls).toContain('Cross = SDL-0/A')
  expect(controls).toContain('Screenshot = SDL-0/Touchpad')
  expect(controls).toContain('Screenshot = SDL-0/Misc1')
  expect(controls).toContain('Count = 1') // the wheel isn't a player

  // 2026-11-07: two pads, started without choosing an order (○ "usual order"): player 2 is set up too
  await api(page, 'reportPads', ['Xbox 360 Controller (XInput STANDARD GAMEPAD)', 'Xbox 360 Controller (XInput STANDARD GAMEPAD)'])
  expect((await api<{ ok: boolean }>(page, 'launch', 'testcon:alpha.tst', 'fresh')).ok).toBe(true)
  await waitIdle(page)
  controls = fs.readFileSync(path.join(emu, 'controls.ini'), 'utf8')
  expect(controls).toContain('Cross = XInput-0/A')
  expect(controls).toContain('Count = 2')
  expect(JSON.parse(fs.readFileSync(path.join(emu, 'launched.json'), 'utf8'))).not.toContain('--crt')
  await app.close()
})

test('#34 right-click opens the menu of the game that was clicked, not the one selected before', async () => {
  const { files, presets } = setup('rightclick', ['Alpha.tst', 'Beta.tst'])
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    await page.locator('[data-testid^="item-"]', { hasText: 'Beta' }).click({ button: 'right' })
    await expect(page.getByTestId('panel-game')).toBeVisible()
    await expect(page.getByTestId('panel-game').locator('.panel-title')).toContainText('Beta')
  } finally {
    await app.close()
  }
})
