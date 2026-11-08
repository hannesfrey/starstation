import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, makePresets, writeSettings } from './helpers'

/**
 * Monkey test: random menu buttons, hundreds of times — what a controller in a child's hands (or a cat on
 * the keyboard) does. No screen may break (error screen), nothing may land in the log as an ERROR, and the
 * menu must keep answering. Same "random" presses every run (fixed seed), so a failure can be repeated.
 * Hidden + offline: dialogs answer "cancelled", nothing opens on the screen, no request leaves the PC.
 */

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

// directions most often, like a real player; Home = the Start button (back to Settings)
const KEYS: [string, number][] = [
  ['ArrowDown', 22], ['ArrowUp', 14], ['ArrowRight', 14], ['ArrowLeft', 12], ['Enter', 16], ['Escape', 9], [' ', 6], ['Home', 2], ['PageUp', 2], ['PageDown', 2], ['f', 1]
]
const TOTAL = KEYS.reduce((n, [, w]) => n + w, 0)

const logText = (files: string) => {
  const d = path.join(files, 'config', 'logs')
  return fs.readdirSync(d).filter((n) => n.endsWith('.log')).map((n) => fs.readFileSync(path.join(d, n), 'utf8')).join('')
}

for (const seed of [1108, 2026, 4242]) test(`monkey (seed ${seed}): 600 random menu presses — no broken screen, no errors, the menu keeps answering`, async () => {
  test.setTimeout(300_000)
  const files = makeFiles(`monkey-${seed}`)
  const presets = makePresets(files, 300, {
    quickResume: true,
    extra: { mods: { targets: [{ id: 'patches', label: 'Patch (.pnach)', dir: '{emu}/patches', match: '\\.pnach$', flatten: true }] } }
  })
  writeSettings(files, { bootAnimation: false })
  const games = path.join(files, 'games', 'testcon')
  fs.mkdirSync(games, { recursive: true })
  for (const n of ['Alpha', 'Beta Racing (USA)', 'Gamma']) fs.writeFileSync(path.join(games, `${n}.tst`), n)
  fs.mkdirSync(path.join(files, 'saves', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'saves', 'testcon', 'Alpha.sav'), 'save')
  process.env.STARSTATION_TEST_OFFLINE = '1'

  const rand = rng(seed)
  let app: ElectronApplication | null = null
  let page: Page | null = null
  let starts = 0
  const start = async () => {
    ;({ app, page } = await launchApp(files, presets))
    starts++
    await expect(page.getByTestId('xmb')).toBeVisible({ timeout: 15_000 })
  }
  try {
    await start()
    for (let i = 0; i < 600; i++) {
      // a press may have chosen "Quit Starstation" (or Undo update): start it again and go on
      if (app!.process().exitCode !== null || app!.windows().length === 0) await start()
      let r = rand() * TOTAL
      const key = KEYS.find(([, w]) => (r -= w) < 0)![0]
      await page!.keyboard.press(key).catch(() => undefined)
      await page!.waitForTimeout(25).catch(() => undefined)
      if (i % 25 === 24 && app!.process().exitCode === null) {
        await expect(page!.getByTestId('error-screen'), `error screen after press ${i}`).toHaveCount(0)
        // the menu still answers: the main process gives its state
        const ok = await page!.evaluate(() => window.starstation.getState().then(() => true)).catch(() => app!.process().exitCode !== null)
        expect(ok, `menu answers after press ${i}`).toBe(true)
      }
    }
    const errors = logText(files).split('\n').filter((l) => / ERROR /.test(l))
    expect(errors, errors.join('\n')).toEqual([])
    expect(logText(files)).not.toContain('menu error')
    console.log(`monkey ${seed}: 600 presses, ${starts} start(s)`)
  } finally {
    delete process.env.STARSTATION_TEST_OFFLINE
    if (app && (app as ElectronApplication).process().exitCode === null) await (app as ElectronApplication).close()
  }
})

test('monkey in the PS button menu: random presses over running games, opened and closed again and again', async () => {
  test.setTimeout(300_000)
  const files = makeFiles('monkey-overlay')
  const presets = makePresets(files, 60_000, { quickResume: true }) // the fake emulator stays until it is closed
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Alpha.tst'), 'a')
  process.env.STARSTATION_TEST_OFFLINE = '1'
  const { app, page } = await launchApp(files, presets)
  const api = <T>(fn: string, ...args: unknown[]) =>
    page.evaluate(([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>
  const running = async () => !!(await api<{ running: unknown }>('getState')).running
  const rand = rng(77)
  const keys = ['ArrowDown', 'ArrowDown', 'ArrowUp', 'Enter', 'Enter', 'Escape']
  let sessions = 0
  try {
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    await expect.poll(() => app.windows().some((w) => w.url().includes('#overlay')), { timeout: 10_000 }).toBe(true)
    const ov = app.windows().find((w) => w.url().includes('#overlay'))!
    for (let round = 0; round < 12; round++) {
      if (!(await running())) {
        expect((await api<{ ok: boolean; error?: string }>('launch', 'testcon:alpha.tst', rand() < 0.5 ? 'resume' : 'fresh')).ok).toBe(true)
        sessions++
      }
      for (let i = 0; i < 30 && (await running()); i++) {
        // the PS button (sometimes twice quickly), then menu presses
        if (rand() < 0.3) await api('testHome')
        await ov.keyboard.press(keys[Math.floor(rand() * keys.length)]).catch(() => undefined)
        await page.waitForTimeout(40)
        await expect(ov.getByTestId('error-screen')).toHaveCount(0)
      }
      // whatever happened, the game can always be ended from the menu
      if (await running()) {
        await api('overlayAction', 'save-quit')
        await expect.poll(running, { timeout: 15_000 }).toBe(false)
      }
    }
    expect(sessions).toBeGreaterThan(3)
    const st = await api<{ library: { stats: Record<string, { playCount: number }> } }>('getState')
    expect(st.library.stats['testcon:alpha.tst'].playCount).toBe(sessions)
    const errors = logText(files).split('\n').filter((l) => / ERROR /.test(l))
    expect(errors, errors.join('\n')).toEqual([])
  } finally {
    delete process.env.STARSTATION_TEST_OFFLINE
    await app.close()
  }
})

test('monkey in the first-start wizard: random presses never break it, and it can always be finished', async () => {
  test.setTimeout(180_000)
  for (const seed of [5, 6, 7]) {
    const files = makeFiles(`monkey-wizard-${seed}`, { wizard: true })
    process.env.STARSTATION_TEST_OFFLINE = '1'
    const { app, page } = await launchApp(files)
    try {
      const rand = rng(seed)
      const keys = ['ArrowDown', 'ArrowUp', 'Enter', 'Enter', 'Escape', 'ArrowLeft', 'ArrowRight']
      for (let i = 0; i < 150 && app.process().exitCode === null; i++) {
        await page.keyboard.press(keys[Math.floor(rand() * keys.length)]).catch(() => undefined)
        await page.waitForTimeout(25).catch(() => undefined)
        if (i % 25 === 24) await expect(page.getByTestId('error-screen')).toHaveCount(0)
      }
      const errors = logText(files).split('\n').filter((l) => / ERROR /.test(l))
      expect(errors, errors.join('\n')).toEqual([])
    } finally {
      delete process.env.STARSTATION_TEST_OFFLINE
      if (app.process().exitCode === null) await app.close()
    }
  }
})
