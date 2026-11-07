import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, makePresets, writeSettings } from './helpers'

/**
 * 2026-11-07: the ✕ that chose "Save and quit" was still held when the game closed, and the menu took it as a
 * new press — the game started again, five times in a row. A button already down when the menu gets the focus
 * back only counts once it was let go.
 */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

test('a button held while the game closes does not start it again', async () => {
  test.setTimeout(60_000)
  const files = makeFiles('heldbutton')
  const presets = makePresets(files, 2500) // the fake game runs 2.5 s
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Alpha.tst'), 'a')
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    // one controller; the hidden test window counts as focused
    await page.evaluate(() => {
      const pad = { index: 0, id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', connected: true, mapping: 'standard', buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] }
      ;(window as unknown as { fakePad: typeof pad }).fakePad = pad
      navigator.getGamepads = () => [pad] as unknown as Gamepad[]
      document.hasFocus = () => true
    })
    const cross = (down: boolean) =>
      page.evaluate((d) => {
        ;(window as unknown as { fakePad: { buttons: { pressed: boolean }[] } }).fakePad.buttons[0].pressed = d
      }, down)
    const running = () => api<{ running: unknown }>(page, 'getState').then((s) => s.running)

    // ✕ starts the game (the pad works at all)
    await cross(true)
    await expect.poll(running, { timeout: 5000 }).not.toBeNull()
    // ...and is still held when the game ends
    await expect.poll(running, { timeout: 15_000 }).toBeNull()
    await page.waitForTimeout(1200)
    expect(await running()).toBeNull()
    // let go and press again: now it counts
    await cross(false)
    await page.waitForTimeout(1500) // (a hidden test window reads the pad only a few times a second)
    await cross(true)
    await expect.poll(running, { timeout: 5000 }).not.toBeNull()
    await cross(false)
  } finally {
    await app.close()
  }
})
