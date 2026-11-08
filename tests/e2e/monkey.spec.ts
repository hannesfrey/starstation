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
