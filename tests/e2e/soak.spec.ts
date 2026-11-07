import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, makePresets, writeSettings } from './helpers'

/**
 * Many games in a row, like an evening on the couch: Starstation must not pile up timers, handles or memory,
 * and nothing may go wrong quietly (no ERROR in its log). Leaks only show after hours otherwise.
 */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

const CYCLES = 15

test('fifteen games in a row: no growing timers or memory, no errors, play counted every time', async () => {
  test.setTimeout(180_000)
  const files = makeFiles('soak')
  const presets = makePresets(files, 300, { quickResume: true })
  writeSettings(files, { bootAnimation: false })
  const gdir = path.join(files, 'games', 'testcon')
  fs.mkdirSync(gdir, { recursive: true })
  for (const n of ['Alpha', 'Beta', 'Gamma']) fs.writeFileSync(path.join(gdir, `${n}.tst`), n)
  const { app, page } = await launchApp(files, presets)
  // what the main process keeps open: timers, child processes, pipes (Node's own count)
  const resources = () =>
    app.evaluate(() => {
      const list = (process as unknown as { getActiveResourcesInfo: () => string[] }).getActiveResourcesInfo()
      return { timers: list.filter((r) => r === 'Timeout').length, all: list.length, heap: process.memoryUsage().heapUsed }
    })
  try {
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    const ids = ['testcon:alpha.tst', 'testcon:beta.tst', 'testcon:gamma.tst']
    const play = async (i: number) => {
      const r = await api<{ ok: boolean; error?: string }>(page, 'launch', ids[i % 3], i % 2 ? 'resume' : 'fresh')
      expect(r.ok, r.error).toBe(true)
      // the PS button menu over the game, then back (as a player would)
      await api(page, 'testHome')
      await api(page, 'overlayAction', 'resume')
      await expect.poll(async () => (await api<{ running: unknown }>(page, 'getState')).running, { timeout: 15_000 }).toBeNull()
    }
    // warm up: the first games create what stays (caches, the PS menu window)
    for (let i = 0; i < 3; i++) await play(i)
    await page.waitForTimeout(1000)
    const before = await resources()
    for (let i = 3; i < CYCLES; i++) await play(i)
    await page.waitForTimeout(1500)
    const after = await resources()

    // a leak grows with every game: allow a little noise, not one per game
    expect(after.timers, `timers ${before.timers} → ${after.timers}`).toBeLessThanOrEqual(before.timers + 2)
    expect(after.all, `resources ${before.all} → ${after.all}`).toBeLessThanOrEqual(before.all + 3)
    expect(after.heap, `heap ${before.heap} → ${after.heap}`).toBeLessThan(before.heap + 40 * 1024 ** 2)

    // every session counted
    const st = await api<{ library: { stats: Record<string, { playCount: number }> } }>(page, 'getState')
    expect(ids.reduce((n, id) => n + (st.library.stats[id]?.playCount ?? 0), 0)).toBe(CYCLES)
    // the menu still answers at once
    await expect(page.getByTestId('xmb')).toBeVisible()
    const log = fs.readdirSync(path.join(files, 'config', 'logs')).filter((n) => n.endsWith('.log')).map((n) => fs.readFileSync(path.join(files, 'config', 'logs', n), 'utf8')).join('')
    expect(log).not.toMatch(/ ERROR /)
  } finally {
    await app.close()
  }
})
