import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, makePresets, writeSettings } from './helpers'

/** 3DS games that need a Mii (Mario Kart 7): Starstation puts its own Mii into an empty Mii database before the game starts. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

test('an empty Mii database gets one Mii at game start; one with Miis is left alone', async () => {
  const files = makeFiles('miidb')
  const emu = path.join(files, '_fakeemu')
  const db = path.join(emu, 'nand', 'CFL_DB.dat')
  const presets = makePresets(files, 300, { extra: { config: [{ type: 'mii-db', file: '{emu}/nand/CFL_DB.dat' }] } })
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Kart.tst'), 'k')
  const { app, page } = await launchApp(files, presets)
  try {
    const play = async () => {
      await expect.poll(async () => (await api<{ ok: boolean }>(page, 'launch', 'testcon:kart.tst')).ok, { timeout: 10_000 }).toBe(true)
      await expect.poll(async () => (await api<{ running: unknown }>(page, 'getState')).running, { timeout: 10_000 }).toBeNull()
    }
    await play()
    const first = fs.readFileSync(db)
    expect(first.length).toBe(0x4bd20)
    expect(first.toString('utf16le', 8 + 0x1a, 8 + 0x1a + 12)).toBe('Player')
    // the user's own Miis (here: a renamed one) are never replaced
    first.write('Me\0\0\0\0', 8 + 0x1a, 'utf16le')
    fs.writeFileSync(db, first)
    await play()
    expect(fs.readFileSync(db).toString('utf16le', 8 + 0x1a, 8 + 0x1a + 4)).toBe('Me')
  } finally {
    await app.close()
  }
})
