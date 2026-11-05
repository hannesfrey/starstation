import { test, expect, type Page, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, makePresets, writeSettings } from './helpers'

/** SPEC-v2 A: PS button menu over the game, Quit vs Save and quit, notifications wait for the game to end. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

async function overlayPage(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes('#overlay')), { timeout: 10_000 }).toBe(true)
  return app.windows().find((w) => w.url().includes('#overlay'))!
}

test('PS button menu: open over the game, Quit keeps the old resume state, Save and quit keeps the new one', async () => {
  test.setTimeout(90_000)
  const files = makeFiles('overlay')
  const presets = makePresets(files, 60_000, { quickResume: true }) // the fake emulator stays open until closed
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Alpha.tst'), 'a')
  const state = path.join(files, 'saves', 'testcon', 'states', 'Alpha.state')
  fs.mkdirSync(path.dirname(state), { recursive: true })
  fs.writeFileSync(state, 'state from last time')
  const gid = 'testcon:alpha.tst'
  const { app, page } = await launchApp(files, presets)
  try {
    const ov = await overlayPage(app)
    // every window stays hidden and silent in tests
    const shown = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible() || !w.webContents.isAudioMuted()))
    expect(shown.every((s) => !s)).toBe(true)

    // no game: the PS button does nothing
    await api(page, 'testHome')
    await expect(ov.getByTestId('overlay-closed')).toBeAttached()

    expect((await api<{ ok: boolean }>(page, 'launch', gid, 'resume')).ok).toBe(true)
    await api(page, 'testHome')
    await expect(ov.getByTestId('overlay')).toBeVisible()
    await expect(ov.getByTestId('overlay')).toContainText('Alpha')
    await expect(ov.getByTestId('overlay-resume')).toBeVisible()
    await expect(ov.getByTestId('overlay-savequit')).toContainText('Save and quit')
    await expect(ov.getByTestId('overlay-quit')).toBeVisible()
    await expect(ov.getByTestId('overlay-save')).toHaveCount(0) // the fake emulator has no save states
    // ○ = back to the game; the PS button again opens it again
    await ov.keyboard.press('Escape')
    await expect(ov.getByTestId('overlay-closed')).toBeAttached()
    await api(page, 'testHome')
    await expect(ov.getByTestId('overlay')).toBeVisible()
    // controller settings shows the pads (none in tests) and goes back
    await ov.getByTestId('overlay-pads').click()
    await expect(ov.getByTestId('overlay-pads')).toContainText('Player order')

    // a notification while playing waits until the game ends
    await api(page, 'backupNow', gid)
    await page.waitForTimeout(500)
    await expect(page.getByTestId('notices')).not.toContainText(/backed up|unchanged|No saves/)

    // the emulator writes a new resume state during the session; "Quit" puts the old one back
    fs.writeFileSync(state, 'state from this session')
    await ov.keyboard.press('Escape') // from Controller settings back to the menu
    await expect(ov.getByTestId('overlay-quit')).toBeVisible()
    await ov.getByTestId('overlay-quit').click()
    await expect.poll(async () => (await api<{ running: unknown }>(page, 'getState')).running, { timeout: 15_000 }).toBeNull()
    expect(fs.readFileSync(state, 'utf8')).toBe('state from last time')
    await expect(ov.getByTestId('overlay-closed')).toBeAttached()
    // now the held notification shows
    await expect(page.getByTestId('notices')).toContainText(/backed up|unchanged|No saves/)

    // "Save and quit" keeps what the emulator wrote
    expect((await api<{ ok: boolean }>(page, 'launch', gid, 'resume')).ok).toBe(true)
    fs.writeFileSync(state, 'state from the second session')
    await api(page, 'testHome')
    await ov.getByTestId('overlay-savequit').click()
    await expect.poll(async () => (await api<{ running: unknown }>(page, 'getState')).running, { timeout: 15_000 }).toBeNull()
    expect(fs.readFileSync(state, 'utf8')).toBe('state from the second session')
  } finally {
    await app.close()
  }
})
