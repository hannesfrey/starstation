import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, makePresets, writeSettings } from './helpers'

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
    await expect(page.getByTestId('panel-whats-new')).toContainText('Settings is shorter')
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
