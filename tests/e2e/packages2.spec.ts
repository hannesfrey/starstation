import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, makePresets, writeSettings } from './helpers'

/** SPEC-v2 F: smart packages (only what the other PC misses), only new since last time, profiles in packages. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

const CHOICE = { emulators: false, bios: false, games: 'all', mods: false, settings: false, saves: false, onlyNew: false, profiles: ['p1'] }

test('smart package by USB: only what the other PC misses; a profile merged; only new since last time', async () => {
  test.setTimeout(120_000)
  // sender A: Alpha + Beta, its profile has play time, a favorite and a save
  const a = makeFiles('pkg2-send')
  const ap = makePresets(a, 200)
  writeSettings(a, { bootAnimation: false })
  fs.mkdirSync(path.join(a, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(a, 'games', 'testcon', 'Alpha.tst'), 'alpha')
  fs.writeFileSync(path.join(a, 'games', 'testcon', 'Beta.tst'), 'beta game')
  fs.mkdirSync(path.join(a, 'saves', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(a, 'saves', 'testcon', 'Beta.sav'), 'beta progress')
  fs.mkdirSync(path.join(a, 'config', 'library'), { recursive: true })
  fs.writeFileSync(path.join(a, 'config', 'library', 'stats.json'), JSON.stringify({ 'testcon:beta.tst': { playTime: 3000, playCount: 4, favorite: true } }))
  // receiver B: has Alpha already; its own "Player 1" played Alpha
  const b = makeFiles('pkg2-recv')
  const bp = makePresets(b, 200)
  writeSettings(b, { bootAnimation: false })
  fs.mkdirSync(path.join(b, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(b, 'games', 'testcon', 'Alpha.tst'), 'alpha')
  fs.mkdirSync(path.join(b, 'config', 'library'), { recursive: true })
  fs.writeFileSync(path.join(b, 'config', 'library', 'stats.json'), JSON.stringify({ 'testcon:alpha.tst': { playTime: 100, playCount: 1 } }))

  const A = await launchApp(a, ap)
  const B = await launchApp(b, bp)
  try {
    // B puts "what I have" on the drive (in hidden tests the sender's drive is Files\backups\packages)
    const drive = path.join(a, 'backups', 'packages')
    fs.mkdirSync(drive, { recursive: true })
    expect(await api<string>(B.page, 'packagePrepareFolder', drive)).toBe(drive)
    expect(fs.existsSync(path.join(drive, 'Starstation inventory.json'))).toBe(true)

    // A saves the package there: Alpha is left out (B has it), Beta + the profile go in
    const saved = await api<{ ok: boolean; folder: string }>(A.page, 'packageSaveToFolder', CHOICE)
    expect(saved.ok).toBe(true)
    expect(fs.existsSync(path.join(saved.folder, 'games', 'testcon', 'Alpha.tst'))).toBe(false)
    expect(fs.existsSync(path.join(saved.folder, 'games', 'testcon', 'Beta.tst'))).toBe(true)
    expect(fs.existsSync(path.join(saved.folder, 'profiles', 'Player 1', 'stats.json'))).toBe(true)
    expect(fs.readFileSync(path.join(saved.folder, 'profiles', 'Player 1', 'saves', 'testcon', 'Beta.sav'), 'utf8')).toBe('beta progress')
    const m = JSON.parse(fs.readFileSync(path.join(saved.folder, 'manifest.json'), 'utf8'))
    expect(m.smart.left).toBeGreaterThanOrEqual(1)

    // B receives: "Player 1" exists here too → asked first, nothing unpacked yet
    await B.page.evaluate(() => {
      const w = window as unknown as { asks: unknown[]; starstation: { on: (c: string, f: (x: unknown) => void) => void } }
      w.asks = []
      w.starstation.on('package-ask', (x) => w.asks.push(x))
    })
    await api(B.page, 'packageReceiveFolder', false, saved.folder)
    await expect.poll(() => B.page.evaluate(() => (window as unknown as { asks: { profiles: string[] }[] }).asks[0]?.profiles)).toEqual(['Player 1'])
    expect(fs.existsSync(path.join(b, 'games', 'testcon', 'Beta.tst'))).toBe(false)
    await expect(B.page.getByTestId('panel-pkg-profiles')).toBeVisible()
    // merge: both play times, the favorite, the save
    expect((await api<{ ok: boolean }>(B.page, 'packageFinish', saved.folder, false, { 'Player 1': 'merge' })).ok).toBe(true)
    expect(fs.readFileSync(path.join(b, 'games', 'testcon', 'Beta.tst'), 'utf8')).toBe('beta game')
    expect(fs.readFileSync(path.join(b, 'saves', 'testcon', 'Beta.sav'), 'utf8')).toBe('beta progress')
    const stats = JSON.parse(fs.readFileSync(path.join(b, 'config', 'library', 'stats.json'), 'utf8'))
    expect(stats['testcon:alpha.tst'].playTime).toBe(100)
    expect(stats['testcon:beta.tst']).toMatchObject({ playTime: 3000, favorite: true })

    // only new since last time: nothing changed on A since → no games in the next package
    fs.rmSync(saved.folder, { recursive: true, force: true })
    const again = await api<{ ok: boolean; folder: string }>(A.page, 'packageSaveToFolder', { ...CHOICE, onlyNew: true, profiles: [] })
    expect(again.ok).toBe(true)
    expect(fs.existsSync(path.join(again.folder, 'games', 'testcon', 'Beta.tst'))).toBe(false)
    // a game added on A after that goes in
    fs.rmSync(again.folder, { recursive: true, force: true })
    fs.writeFileSync(path.join(a, 'games', 'testcon', 'Gamma.tst'), 'gamma')
    const third = await api<{ ok: boolean; folder: string }>(A.page, 'packageSaveToFolder', { ...CHOICE, onlyNew: true, profiles: [] })
    expect(fs.existsSync(path.join(third.folder, 'games', 'testcon', 'Gamma.tst'))).toBe(true)
    expect(fs.existsSync(path.join(third.folder, 'games', 'testcon', 'Beta.tst'))).toBe(false)
  } finally {
    await A.app.close()
    await B.app.close()
  }
})
