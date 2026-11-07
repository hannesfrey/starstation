import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { launchApp, makeFiles, makePresets, writeSettings } from './helpers'

/**
 * 2026-11-07: GT6 and Black Ops II crashed in RPCS3, and RPCS3's log was already overwritten by the next game.
 * After every session the emulator's log is kept (zipped); a fatal error in it becomes a notice.
 */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

test("the emulator's log is kept after every game, a fatal error is shown", async () => {
  test.setTimeout(60_000)
  const files = makeFiles('emulogs')
  const presets = makePresets(files, 400)
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Alpha.tst'), 'a')
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Crash Test.tst'), 'c')
  const kept = path.join(files, 'config', 'logs', 'emulators')
  const list = () => (fs.existsSync(kept) ? fs.readdirSync(kept).sort() : [])
  const running = () => api<{ running: unknown }>(page, 'getState').then((s) => s.running)
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    expect((await api<{ ok: boolean }>(page, 'launch', 'testcon:alpha.tst', 'fresh')).ok).toBe(true)
    await expect.poll(running, { timeout: 15_000 }).toBeNull()
    await expect.poll(list, { timeout: 5000 }).toHaveLength(1)
    expect(list()[0]).toMatch(/^fakeemu_\d{14}_Alpha\.log\.gz$/)
    expect(zlib.gunzipSync(fs.readFileSync(path.join(kept, list()[0]))).toString('utf8')).toContain('booting Alpha')
    await page.waitForTimeout(300)
    await expect(page.getByTestId('notices')).not.toContainText('stopped with an error')

    expect((await api<{ ok: boolean }>(page, 'launch', 'testcon:crash test.tst', 'fresh')).ok).toBe(true)
    await expect.poll(running, { timeout: 15_000 }).toBeNull()
    await expect.poll(list, { timeout: 5000 }).toHaveLength(2)
    await expect(page.getByTestId('notices')).toContainText('Crash Test stopped with an error in Fake Emu')
    await expect(page.getByTestId('notices')).toContainText('VM: Access violation')
  } finally {
    await app.close()
  }
})
