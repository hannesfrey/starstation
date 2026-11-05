import { test, expect, type Page, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, makePresets, writeSettings } from './helpers'

/** SPEC-v2 G: profiles — own saves (also inside emulators), play time, trophies, favorites; PIN; Guest. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

type P = { id: string; name: string; active: boolean; main: boolean; guest: boolean; hasPin: boolean }

/** After a switch the menu starts again: wait for it. */
async function reloaded(app: ElectronApplication): Promise<Page> {
  const page = app.windows().find((w) => !w.url().includes('#overlay'))!
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => !!(window as unknown as { starstation?: unknown }).starstation)
  return page
}

test('profiles: own saves (also inside the emulator), own play time, PIN, guest cleared', async () => {
  test.setTimeout(120_000)
  const files = makeFiles('profiles')
  const emu = path.join(files, '_fakeemu')
  // the fake console: writes where its saves go (like an emulator's ini) and keeps "internal" saves in its folder
  const presets = makePresets(files, 300, {
    extra: {
      config: [
        { type: 'write', file: '{emu}/savespath.txt', lines: ['{saves}'] },
        { type: 'mkdir', path: '{emu}/internal' },
        { type: 'link', path: '{saves}/internal', target: '{emu}/internal' }
      ]
    }
  })
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Alpha.tst'), 'a')
  fs.mkdirSync(path.join(emu, 'internal'), { recursive: true })
  fs.writeFileSync(path.join(emu, 'internal', 'card.sav'), 'main player progress')
  fs.mkdirSync(path.join(files, 'config', 'library'), { recursive: true })
  fs.writeFileSync(path.join(files, 'config', 'library', 'stats.json'), JSON.stringify({ 'testcon:alpha.tst': { playTime: 999, playCount: 3, favorite: true } }))

  const { app } = await launchApp(files, presets)
  let page = app.windows().find((w) => !w.url().includes('#overlay'))!
  const gid = 'testcon:alpha.tst'
  const play = async () => {
    expect((await api<{ ok: boolean }>(page, 'launch', gid)).ok).toBe(true)
    await expect.poll(async () => (await api<{ running: unknown }>(page, 'getState')).running, { timeout: 10_000 }).toBeNull()
  }
  try {
    // the existing setup is the first ("main") profile
    let list = await api<P[]>(page, 'profiles')
    expect(list.map((p) => [p.name, p.main, p.active, p.guest])).toEqual([
      ['Player 1', true, true, false],
      ['Guest', false, false, true]
    ])
    await play()
    expect(fs.readFileSync(path.join(emu, 'savespath.txt'), 'utf8').trim()).toBe(path.join(files, 'saves', 'testcon'))

    // a second profile with a PIN
    list = await api<P[]>(page, 'profileAdd', 'Sis')
    const sis = list.find((p) => p.name === 'Sis')!
    expect((await api<{ ok: boolean }>(page, 'profilePin', sis.id, '1234')).ok).toBe(true)
    expect((await api<{ ok: boolean; error?: string }>(page, 'profileSwitch', sis.id, '0000')).error).toContain('Wrong PIN')
    expect((await api<{ ok: boolean }>(page, 'profileSwitch', sis.id, '1234')).ok).toBe(true)
    page = await reloaded(app)
    // Sis starts with her own (empty) play time and favorites
    await expect.poll(async () => (await api<{ library: { stats: Record<string, unknown> } }>(page, 'getState')).library.stats[gid]).toBeUndefined()
    // the emulator's own saves were swapped: Sis's place is empty, Player 1's were put aside (+ a backup made once)
    expect(fs.existsSync(path.join(emu, 'internal', 'card.sav'))).toBe(false)
    expect(fs.readFileSync(path.join(files, 'config', 'profiles', 'p1', 'emulator-saves', 'testcon-internal', 'card.sav'), 'utf8')).toBe('main player progress')
    expect(fs.existsSync(path.join(files, 'backups', 'before-profiles', 'testcon-internal', 'card.sav'))).toBe(true)
    await play()
    expect(fs.readFileSync(path.join(emu, 'savespath.txt'), 'utf8').trim()).toBe(path.join(files, 'config', 'profiles', sis.id, 'saves', 'testcon'))
    fs.mkdirSync(path.join(emu, 'internal'), { recursive: true })
    fs.writeFileSync(path.join(emu, 'internal', 'card.sav'), 'sis progress')
    expect((await api<{ library: { stats: Record<string, { playCount: number }> } }>(page, 'getState')).library.stats[gid].playCount).toBe(1)

    // back to Player 1: his saves and play time are back, Sis's wait in her folder
    expect((await api<{ ok: boolean }>(page, 'profileSwitch', 'p1')).ok).toBe(true)
    page = await reloaded(app)
    expect(fs.readFileSync(path.join(emu, 'internal', 'card.sav'), 'utf8')).toBe('main player progress')
    expect(fs.readFileSync(path.join(files, 'config', 'profiles', sis.id, 'emulator-saves', 'testcon-internal', 'card.sav'), 'utf8')).toBe('sis progress')
    await expect.poll(async () => (await api<{ library: { stats: Record<string, { playTime: number; favorite?: boolean }> } }>(page, 'getState')).library.stats[gid]?.favorite).toBe(true)
    // the first profile may reset another profile's PIN
    expect((await api<{ ok: boolean }>(page, 'profilePin', sis.id, null)).ok).toBe(true)
    expect((await api<P[]>(page, 'profiles')).find((p) => p.id === sis.id)!.hasPin).toBe(false)

    // Guest: starts empty, cleared when the session ends
    expect((await api<{ ok: boolean }>(page, 'profileSwitch', 'guest')).ok).toBe(true)
    page = await reloaded(app)
    await play()
    expect(fs.existsSync(path.join(files, 'config', 'profiles', 'guest', 'stats.json'))).toBe(true)
    expect((await api<{ ok: boolean }>(page, 'profileSwitch', 'p1')).ok).toBe(true)
    page = await reloaded(app)
    expect(fs.existsSync(path.join(files, 'config', 'profiles', 'guest'))).toBe(false)
    expect(fs.readFileSync(path.join(emu, 'internal', 'card.sav'), 'utf8')).toBe('main player progress')
  } finally {
    await app.close()
  }

  // two profiles: "Who's playing?" at the next start
  const again = await launchApp(files, presets)
  try {
    await expect(again.page.getByTestId('panel-who')).toBeVisible({ timeout: 10_000 })
    await expect(again.page.getByTestId('panel-who')).toContainText('Sis')
  } finally {
    await again.app.close()
  }
})
