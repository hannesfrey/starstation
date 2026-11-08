import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, makePresets, writeSettings, SOURCE } from './helpers'

const VERSION = (JSON.parse(fs.readFileSync(path.join(SOURCE, 'package.json'), 'utf8')) as { version: string }).version

/** Rounding off the edges (2.0.13): things that used to go wrong quietly or end a game too early. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

const logText = (files: string) => {
  const d = path.join(files, 'config', 'logs')
  return fs.readdirSync(d).filter((n) => n.endsWith('.log')).map((n) => fs.readFileSync(path.join(d, n), 'utf8')).join('')
}
const stats = (files: string) => JSON.parse(fs.readFileSync(path.join(files, 'config', 'library', 'stats.json'), 'utf8'))

function setup(name: string, emuMs: number) {
  const files = makeFiles(name)
  const presets = makePresets(files, emuMs)
  writeSettings(files, { bootAnimation: false })
  const gdir = path.join(files, 'games', 'testcon')
  fs.mkdirSync(gdir, { recursive: true })
  fs.writeFileSync(path.join(gdir, 'Alpha.tst'), 'a')
  fs.writeFileSync(path.join(gdir, 'Beta.tst'), 'b')
  return { files, presets }
}

test('two starts at the same moment start one emulator; the other is refused quietly', async () => {
  const { files, presets } = setup('double-start', 2000)
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    // before 2.0.13 both passed the "already running?" check while the first was still being prepared
    const [a, b] = await page.evaluate(() => {
      const s = (window as unknown as { starstation: { launch: (id: string) => Promise<{ ok: boolean; busy?: boolean; error?: string }> } }).starstation
      return Promise.all([s.launch('testcon:alpha.tst'), s.launch('testcon:beta.tst')])
    })
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(false)
    expect(b.busy).toBe(true)
    await expect(page.getByTestId('running')).toHaveCount(0, { timeout: 15_000 })
    expect(logText(files).match(/\[launcher\] launch testcon:/g)).toHaveLength(1)
    // no error panel for the refused second press
    await expect(page.getByTestId('panel-error')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('closing Starstation while a game runs saves and closes the game first, then ends cleanly', async () => {
  // the fake emulator would run for a minute: Starstation has to close it
  const { files, presets } = setup('quit-while-playing', 60_000)
  const { app, page } = await launchApp(files, presets)
  await expect(page.getByTestId('game-info')).toContainText('Alpha')
  expect((await api<{ ok: boolean }>(page, 'launch', 'testcon:alpha.tst')).ok).toBe(true)
  await expect(page.getByTestId('running')).toBeVisible()
  const exited = new Promise<void>((r) => app.process().once('exit', () => r()))
  void api(page, 'quit').catch(() => undefined)
  await Promise.race([exited, new Promise((_, rej) => setTimeout(() => rej(new Error('Starstation did not end')), 20_000))])
  const log = logText(files)
  expect(log).toContain('the running game is saved and closed first')
  // the session was counted (before 2.0.13 the emulator was killed and the play time could be lost)
  expect(stats(files)['testcon:alpha.tst'].playCount).toBe(1)
  // a normal close, not a crash
  expect(JSON.parse(fs.readFileSync(path.join(files, 'config', 'updates', 'session.json'), 'utf8')).last.clean).toBe(true)
})

test('a half-finished profile switch blocks starting games until it is finished', async () => {
  const { files, presets } = setup('switch-pending', 300)
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    fs.writeFileSync(path.join(files, 'config', 'profiles-switch.json'), JSON.stringify({ from: 'p1', to: 'p2', steps: [] }))
    const r = await api<{ ok: boolean; error?: string }>(page, 'launch', 'testcon:alpha.tst')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('Switching profiles didn’t finish')
    fs.rmSync(path.join(files, 'config', 'profiles-switch.json'))
    expect((await api<{ ok: boolean }>(page, 'launch', 'testcon:alpha.tst')).ok).toBe(true)
    await expect(page.getByTestId('running')).toHaveCount(0, { timeout: 15_000 })
  } finally {
    await app.close()
  }
})

test('menu errors land in the log; a crashed menu page comes back by itself', async () => {
  const { files, presets } = setup('menu-errors', 300)
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('boom from a timer')
      })
      void Promise.reject(new Error('boom from a promise'))
    })
    await expect.poll(() => logText(files)).toContain('boom from a timer')
    await expect.poll(() => logText(files)).toContain('boom from a promise')

    // the menu's page process dies: Starstation stays and loads the menu again (before: it ended at once)
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => !w.webContents.getURL().includes('#overlay'))!
        .webContents.forcefullyCrashRenderer()
    })
    await expect.poll(() => logText(files), { timeout: 10_000 }).toContain('renderer gone')
    // the menu is drawn again (the game list is back)
    await expect
      .poll(
        () =>
          app.evaluate(async ({ BrowserWindow }) => {
            const w = BrowserWindow.getAllWindows().find((x) => !x.webContents.getURL().includes('#overlay'))
            if (!w || w.webContents.isCrashed() || w.webContents.isLoading()) return false
            return (await w.webContents.executeJavaScript('document.querySelector("[data-testid=game-info]")?.textContent ?? ""')) as string
          }),
        { timeout: 15_000 }
      )
      .toContain('Alpha')
    expect(app.process().exitCode).toBeNull()
  } finally {
    await app.close()
  }
})

test('updating from 2.0.12: settings, profile and play time stay, the old trophies file is ignored, What’s new shows', async () => {
  const { files, presets } = setup('upgrade', 300)
  const w = (rel: string, data: unknown) => {
    fs.mkdirSync(path.dirname(path.join(files, rel)), { recursive: true })
    fs.writeFileSync(path.join(files, rel), JSON.stringify(data, null, 2))
  }
  // shaped like a real Files folder before the update
  w('config/settings.json', { bootAnimation: false, graphicsDefault: 'max', crtDefault: true, buttonIcons: 'playstation', theme: 'monthly' })
  w('config/profiles.json', { list: [{ id: 'p1', name: 'Player 1', icon: 'p-star', createdAt: 1793912797774 }], main: 'p1', active: 'p1' })
  w('config/trophies.json', { unlocked: { 'first-mod': 1794052190588, 'console-ps3': 1794061173866 }, firsts: { mod: 1794052190584 } })
  w('config/library/stats.json', { 'testcon:alpha.tst': { playTime: 3600, playCount: 4, favorite: true } })
  w('config/updates/state.json', { lastVersion: '2.0.12' })
  w('config/updates/session.json', { last: { version: '2.0.12', startedAt: 1, clean: true }, crashesInARow: 0, cleanRuns: { '2.0.12': 5 }, versions: ['2.0.12'] })
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('panel-whats-new')).toBeVisible()
    await expect(page.getByTestId('panel-whats-new')).toContainText(`What's new in ${VERSION}`)
    const st = await api<{ settings: { graphicsDefault: string; buttonIcons: string }; library: { stats: Record<string, { playTime: number; favorite?: boolean }> } }>(page, 'getState')
    expect(st.settings.graphicsDefault).toBe('max')
    expect(st.settings.buttonIcons).toBe('playstation')
    expect(st.library.stats['testcon:alpha.tst']).toMatchObject({ playTime: 3600, favorite: true })
    expect((await api<{ name: string; main: boolean }[]>(page, 'profiles')).find((p) => p.main)?.name).toBe('Player 1')
    await expect(page.getByTestId('cat-trophies')).toHaveCount(0)
    expect(logText(files)).not.toMatch(/ ERROR /)
  } finally {
    await app.close()
  }
})

test('deleting a profile asks first, and the question opens on Cancel', async () => {
  const { files, presets } = setup('profile-delete', 300)
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    await api(page, 'profileAdd', 'Sis')
    await page.reload() // the Users column reads the profiles when the menu loads
    await page.getByTestId('cat-users').dispatchEvent('click')
    const sis = (await api<{ id: string; name: string }[]>(page, 'profiles')).find((p) => p.name === 'Sis')!
    await page.getByTestId(`item-user-${sis.id}`).dispatchEvent('click')
    await page.keyboard.press(' ') // △: the profile's options
    await expect(page.getByTestId('panel-profile')).toBeVisible()
    await page.getByTestId('pitem-del').dblclick()
    await expect(page.getByTestId('panel-profile-delete')).toBeVisible()
    await expect(page.getByTestId('pitem-no')).toHaveClass(/active/)
    await page.keyboard.press('Enter') // the second quick ✕: nothing happens
    await expect(page.getByTestId('panel-profile-delete')).toHaveCount(0)
    expect((await api<{ name: string }[]>(page, 'profiles')).some((p) => p.name === 'Sis')).toBe(true)

    await page.keyboard.press(' ')
    await page.getByTestId('pitem-del').dblclick()
    await page.getByTestId('pitem-yes').dblclick()
    await expect.poll(async () => (await api<{ name: string }[]>(page, 'profiles')).some((p) => p.name === 'Sis')).toBe(false)
  } finally {
    await app.close()
  }
})

test('a garbled play time in stats.json is counted on from 0, not kept broken', async () => {
  const { files, presets } = setup('stats-garbled', 300)
  fs.mkdirSync(path.join(files, 'config', 'library'), { recursive: true })
  fs.writeFileSync(path.join(files, 'config', 'library', 'stats.json'), JSON.stringify({ 'testcon:alpha.tst': { playTime: 'lots', playCount: null, favorite: true } }))
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    expect((await api<{ ok: boolean }>(page, 'launch', 'testcon:alpha.tst')).ok).toBe(true)
    await expect(page.getByTestId('running')).toHaveCount(0, { timeout: 15_000 })
    const s = stats(files)['testcon:alpha.tst']
    expect(Number.isFinite(s.playTime)).toBe(true)
    expect(s.playCount).toBe(1)
    expect(s.favorite).toBe(true) // the rest of the entry stays
    await expect(page.getByTestId('game-info')).not.toContainText('NaN')
  } finally {
    await app.close()
  }
})

test('settings.json with wrong kinds of values (edited by hand): Starstation starts with the defaults for those', async () => {
  const { files, presets } = setup('settings-garbled', 300)
  // every setting the wrong type, plus unknown ones
  writeSettings(files, {
    bootAnimation: 'no', sounds: 'yes', music: 1, screensaverMinutes: '5', showEmptyConsoles: null, buttonIcons: 7, graphicsDefault: ['max'],
    crtDefault: 'true', netplayNickname: { name: 'x' }, netplayRelay: 3, artworkAuto: 'false', sortDownloads: 0, tvMode: 'on', theme: false,
    videoPreviews: 'off', textSize: 42, buttonMap: { confirm: 1 }, startFullscreen: 'yes', startWithWindows: 'yes', someOldKey: true
  })
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('xmb')).toBeVisible({ timeout: 15_000 })
    const s = (await api<{ settings: Record<string, unknown> }>(page, 'getState')).settings
    expect(s.sounds).toBe(true)
    expect(s.screensaverMinutes).toBe(5)
    expect(s.theme).toBe('monthly')
    expect(s.netplayNickname).toBe('Player')
    expect(s.buttonMap).toBe('')
    expect(s.someOldKey).toBeUndefined()
    // the menu works: a game starts and a setting can be saved
    expect((await api<{ ok: boolean }>(page, 'launch', 'testcon:alpha.tst')).ok).toBe(true)
    await expect(page.getByTestId('running')).toHaveCount(0, { timeout: 15_000 })
    expect((await api<{ sounds: boolean }>(page, 'setSetting', 'sounds', false)).sounds).toBe(false)
    expect(logText(files)).not.toMatch(/ ERROR /)
  } finally {
    await app.close()
  }
})

test('settings.json with unknown choices (theme, text size, graphics…) still gives a working menu and game start', async () => {
  const { files, presets } = setup('settings-choices', 300)
  writeSettings(files, { bootAnimation: false, theme: 'bogus', textSize: 'huge', graphicsDefault: 'ultra', buttonIcons: 'nintendo', netplayRelay: 'mars', buttonMap: '{not json' })
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('xmb')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('running')).toBeVisible()
    await expect(page.getByTestId('running')).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByTestId('error-screen')).toHaveCount(0)
    expect(logText(files)).not.toMatch(/ ERROR /)
  } finally {
    await app.close()
  }
})

test('config files holding valid JSON of the wrong shape (edited by hand) never break the menu or a game start', async () => {
  const { files, presets } = setup('shapes', 300)
  const w = (rel: string, data: unknown) => {
    fs.mkdirSync(path.dirname(path.join(files, rel)), { recursive: true })
    fs.writeFileSync(path.join(files, rel), JSON.stringify(data))
  }
  w('config/library/collections.json', { not: 'a list' })
  w('config/library/library.json', { version: 4, games: 'nope' })
  w('config/library/game-options.json', null)
  w('config/library/compat.json', [1, 2, 3])
  w('config/controllers.json', { api: 'xinput', pads: 'one' })
  w('config/profiles.json', { list: 'abc', main: 1, active: 2 })
  w('config/ps3updates.json', 'x')
  w('config/mods-inbox.json', 5)
  w('config/secrets.json', null) // filled in by hand
  // read at start, before the window: none of them may stop Starstation from starting
  w('config/updates/session.json', 'x')
  w('config/updates/state.json', null)
  w('config/updates/skip.json', [1])
  w('config/guides.json', 'seen')
  w('config/safe-mode.json', null)
  w('mods/testcon/Alpha/mods.json', { mods: { a: 1 }, owners: [] })
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('xmb')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    // the game's options (mods, per-game choices) open, and it starts
    const d = await api<{ mods: { total: number } } | null>(page, 'gameDetails', 'testcon:alpha.tst')
    expect(d?.mods.total).toBe(0)
    expect((await api<{ ok: boolean; error?: string }>(page, 'launch', 'testcon:alpha.tst')).ok).toBe(true)
    await expect(page.getByTestId('running')).toHaveCount(0, { timeout: 15_000 })
    // and things can be saved again
    expect(Array.isArray(await api(page, 'collectionCreate', 'Couch'))).toBe(true)
    expect((await api<{ name: string }[]>(page, 'profiles')).length).toBeGreaterThan(0)
    await expect(page.getByTestId('error-screen')).toHaveCount(0)
    expect(logText(files)).not.toMatch(/ ERROR /)
  } finally {
    await app.close()
  }
})

test('a damaged user-made console file (config/consoles) is skipped; everything else works', async () => {
  const { files, presets } = setup('custom-garbled', 300)
  const w = (name: string, data: unknown) => {
    fs.mkdirSync(path.join(files, 'config', 'consoles'), { recursive: true })
    fs.writeFileSync(path.join(files, 'config', 'consoles', name), JSON.stringify(data))
  }
  w('x-broken.json', { console: { id: 'x-broken', name: 'Broken' }, emulator: { id: 'custom-x-broken' } })
  w('x-null.json', null)
  w('x-list.json', [1, 2])
  w('x-strings.json', { console: 'x', emulator: 'y' })
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('xmb')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    const s = await api<{ consoles: { id: string }[] }>(page, 'getState')
    expect(s.consoles.some((c) => c.id.startsWith('x-'))).toBe(false)
    expect((await api<{ ok: boolean }>(page, 'launch', 'testcon:alpha.tst')).ok).toBe(true)
    await expect(page.getByTestId('running')).toHaveCount(0, { timeout: 15_000 })
    expect(Array.isArray(await api(page, 'health'))).toBe(true)
    await expect(page.getByTestId('error-screen')).toHaveCount(0)
    expect(logText(files)).not.toMatch(/ ERROR /)
  } finally {
    await app.close()
  }
})

test('two mods switched on at the same moment both stay tracked: switching them off leaves nothing behind', async () => {
  const files = makeFiles('mod-race')
  const presets = makePresets(files, 300, { extra: { mods: { targets: [{ id: 'patches', label: 'Patch (.pnach)', dir: '{emu}/patches', match: '\.pnach$', flatten: true }] } } })
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Alpha.tst'), 'a')
  // saves exist: the first switch-on of each mod backs them up first (that wait is where two changes overlapped)
  fs.mkdirSync(path.join(files, 'saves', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'saves', 'testcon', 'Alpha.sav'), 'save')
  for (const n of ['Faster', 'Widescreen']) fs.writeFileSync(path.join(files, `${n}.pnach`), `patch=${n}`)
  const gid = 'testcon:alpha.tst'
  const placed = path.join(files, '_fakeemu', 'patches')
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    const a = await api<{ ok: boolean; mod: { id: string } }>(page, 'modAdd', gid, path.join(files, 'Faster.pnach'))
    const b = await api<{ ok: boolean; mod: { id: string } }>(page, 'modAdd', gid, path.join(files, 'Widescreen.pnach'))
    const [ra, rb] = await page.evaluate(
      ([g, x, y]) => {
        const s = (window as unknown as { starstation: { modToggle: (g: string, m: string, on: boolean) => Promise<{ ok: boolean }> } }).starstation
        return Promise.all([s.modToggle(g, x, true), s.modToggle(g, y, true)])
      },
      [gid, a.mod.id, b.mod.id] as const
    )
    expect(ra.ok && rb.ok).toBe(true)
    expect(fs.readdirSync(placed).sort()).toEqual(['Faster.pnach', 'Widescreen.pnach'])
    const mods = await api<{ mods: { id: string; enabled: boolean }[] }>(page, 'mods', gid)
    expect(mods.mods.every((m) => m.enabled)).toBe(true)
    // both off again: every file Starstation placed goes (an untracked one would stay for ever)
    await page.evaluate(
      ([g, x, y]) => {
        const s = (window as unknown as { starstation: { modToggle: (g: string, m: string, on: boolean) => Promise<{ ok: boolean }> } }).starstation
        return Promise.all([s.modToggle(g, x, false), s.modToggle(g, y, false)])
      },
      [gid, a.mod.id, b.mod.id] as const
    )
    expect(fs.existsSync(placed) ? fs.readdirSync(placed) : []).toEqual([])
  } finally {
    await app.close()
  }
})

test('a double press on a profile switches once; save folders are moved by one switch only', async () => {
  const { files, presets } = setup('profile-double', 300)
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    await api(page, 'profileAdd', 'Sis')
    const sis = (await api<{ id: string; name: string }[]>(page, 'profiles')).find((p) => p.name === 'Sis')!
    // a save that lives in an emulator (the Xbox hard disk): every switch moves it, so the first switch is
    // still busy when the second press arrives
    const hdd = path.join(files, 'bios', 'xbox', 'xbox_hdd.qcow2')
    fs.mkdirSync(path.dirname(hdd), { recursive: true })
    fs.writeFileSync(hdd, 'player 1 hard disk')
    const [a, b] = await page.evaluate((id) => {
      const s = (window as unknown as { starstation: { profileSwitch: (id: string) => Promise<{ ok: boolean; busy?: boolean }> } }).starstation
      return Promise.all([s.profileSwitch(id), s.profileSwitch(id)])
    }, sis.id)
    expect([a, b].filter((r) => r.ok)).toHaveLength(1)
    expect([a, b].filter((r) => r.busy)).toHaveLength(1)
    const prof = JSON.parse(fs.readFileSync(path.join(files, 'config', 'profiles.json'), 'utf8'))
    expect(prof.active).toBe(sis.id)
    expect(fs.existsSync(path.join(files, 'config', 'profiles-switch.json'))).toBe(false)
    // player 1's hard disk was put away exactly once, intact; Sis starts without one
    expect(fs.readFileSync(path.join(files, 'config', 'profiles', 'p1', 'emulator-saves', 'xbox-hdd.qcow2'), 'utf8')).toBe('player 1 hard disk')
    expect(fs.existsSync(hdd)).toBe(false)
    expect(logText(files).match(/\[profiles\] profile p1 → /g)).toHaveLength(1)
  } finally {
    await app.close()
  }
})

test('restoring a save backup twice at the same moment: one restore runs, the saves end up whole', async () => {
  const files = makeFiles('restore-double')
  const presets = makePresets(files, 300, { quickResume: true })
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Alpha.tst'), 'a')
  const saves = path.join(files, 'saves', 'testcon')
  fs.mkdirSync(saves, { recursive: true })
  fs.writeFileSync(path.join(saves, 'Alpha.sav'), 'old save')
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    const gid = 'testcon:alpha.tst'
    // a game session backs the save up first, then the fake emulator writes a new one
    expect((await api<{ ok: boolean }>(page, 'launch', gid)).ok).toBe(true)
    await expect(page.getByTestId('running')).toHaveCount(0, { timeout: 15_000 })
    const d = await api<{ backups: { id: string }[] }>(page, 'gameDetails', gid)
    const id = d.backups[d.backups.length - 1].id
    const [a, b] = await page.evaluate(
      ([g, bid]) => {
        const s = (window as unknown as { starstation: { restoreBackup: (g: string, b: string) => Promise<{ ok: boolean; error?: string }> } }).starstation
        return Promise.all([s.restoreBackup(g, bid), s.restoreBackup(g, bid)])
      },
      [gid, id] as const
    )
    expect([a, b].filter((r) => r.ok)).toHaveLength(1)
    expect([a, b].find((r) => !r.ok)?.error).toContain('being restored')
    expect(fs.readFileSync(path.join(saves, 'Alpha.sav'), 'utf8')).toBe('old save')
  } finally {
    await app.close()
  }
})

test('✕ still starts a game when part of its details can not be read (a broken backup folder)', async () => {
  const files = makeFiles('details-broken')
  const presets = makePresets(files, 300, { quickResume: true })
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Alpha.tst'), 'a')
  // a file where the game's backup folder belongs: reading its backups fails
  fs.mkdirSync(path.join(files, 'backups', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'backups', 'testcon', 'Alpha'), 'not a folder')
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    const d = await api<{ backups: unknown[] } | null>(page, 'gameDetails', 'testcon:alpha.tst')
    expect(d?.backups).toEqual([]) // the rest of the details still come
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('running')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('running')).toHaveCount(0, { timeout: 15_000 })
  } finally {
    await app.close()
  }
})

test('a .cue naming a file outside its folder: adding and deleting the game never move or bin that file', async () => {
  const files = makeFiles('cue-outside')
  writeSettings(files, { bootAnimation: false })
  // a download unpacked somewhere, and a private file elsewhere on the PC
  const drop = path.join(files, '_drop', 'Game')
  fs.mkdirSync(drop, { recursive: true })
  const privateFile = path.join(files, '_documents', 'taxes.pdf')
  fs.mkdirSync(path.dirname(privateFile), { recursive: true })
  fs.writeFileSync(privateFile, 'private')
  fs.writeFileSync(path.join(drop, 'Game (Track 1).bin'), Buffer.alloc(4096))
  fs.writeFileSync(
    path.join(drop, 'Game.cue'),
    ['FILE "Game (Track 1).bin" BINARY', '  TRACK 01 MODE2/2352', '    INDEX 01 00:00:00', 'FILE "..\\..\\_documents\\taxes.pdf" BINARY', `FILE "${privateFile}" BINARY`].join('\r\n')
  )
  const { app, page } = await launchApp(files)
  try {
    await expect(page.getByTestId('xmb')).toBeVisible()
    const r = await api<{ added: { path: string }[]; errors: string[] }>(page, 'addGames', [path.join(drop, 'Game.cue')], 'ps1')
    expect(r.added).toHaveLength(1)
    expect(fs.existsSync(path.join(files, 'games', 'ps1', 'Game (Track 1).bin'))).toBe(true) // its own track came along
    expect(fs.readFileSync(privateFile, 'utf8')).toBe('private') // the other file stayed where it was
    expect(fs.existsSync(path.join(files, 'games', 'ps1', 'taxes.pdf'))).toBe(false)

    await expect.poll(async () => (await api<{ library: { games: { id: string }[] } }>(page, 'getState')).library.games.length).toBe(1)
    const id = (await api<{ library: { games: { id: string }[] } }>(page, 'getState')).library.games[0].id
    expect((await api<{ ok: boolean }>(page, 'deleteGame', id, true)).ok).toBe(true)
    expect(fs.readFileSync(privateFile, 'utf8')).toBe('private') // not binned with the game
    expect(fs.existsSync(path.join(files, 'games', 'ps1', 'Game.cue'))).toBe(false)
  } finally {
    await app.close()
  }
})

test('a save folder with a link pointing back into itself: the game still starts (backup must not go round for ever)', async () => {
  test.setTimeout(60_000)
  const files = makeFiles('save-loop')
  const presets = makePresets(files, 300, { extra: { backup: [{ path: '{saves}/{basename}' }] } })
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Alpha.tst'), 'a')
  // the game's save folder, with a junction inside it that points back at the folder itself
  const saveDir = path.join(files, 'saves', 'testcon', 'Alpha')
  fs.mkdirSync(saveDir, { recursive: true })
  fs.writeFileSync(path.join(saveDir, 'slot1.sav'), 'progress')
  fs.symlinkSync(saveDir, path.join(saveDir, 'loop'), 'junction')
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    const t0 = Date.now()
    const r = await api<{ ok: boolean; error?: string }>(page, 'launch', 'testcon:alpha.tst')
    expect(r.ok, r.error).toBe(true)
    expect(Date.now() - t0).toBeLessThan(20_000)
    await expect(page.getByTestId('running')).toHaveCount(0, { timeout: 15_000 })
    expect(fs.readFileSync(path.join(saveDir, 'slot1.sav'), 'utf8')).toBe('progress')
  } finally {
    await app.close()
  }
})
