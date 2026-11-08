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
