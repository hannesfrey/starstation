import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, makePresets, writeSettings, SOURCE } from './helpers'

// look at New downloads every 300 ms instead of every 4 s
process.env.STARSTATION_DOWNLOADS_POLL = '300'

const TAR = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
const SEVEN = path.join(SOURCE, 'resources', 'bin', '7zr.exe')

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

/** GameCube disc header: Starstation tells it apart from other .iso files by its magic number. */
function gcIso(): Buffer {
  const b = Buffer.alloc(0x440)
  b.write('GALE01', 0, 'latin1')
  b.writeUInt32BE(0xc2339f3d, 0x1c)
  return b
}

test('New downloads: archives are unpacked and sorted, unclear files asked about, partial downloads left alone', async () => {
  test.setTimeout(90_000)
  const files = makeFiles('downloads')
  const presets = makePresets(files)
  writeSettings(files, { bootAnimation: false })
  const dl = path.join(files, 'games', 'New downloads')
  const staging = path.join(files, '_staging')
  fs.mkdirSync(dl, { recursive: true })
  const stage = (sub: string, entries: Record<string, string | Buffer>) => {
    const d = path.join(staging, sub)
    for (const [rel, data] of Object.entries(entries)) {
      fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true })
      fs.writeFileSync(path.join(d, rel), data)
    }
    return d
  }
  // zip with the game in a sub folder + a readme; 7z with a GameCube image; zip with an unclear .chd
  execFileSync(TAR, ['-a', '-cf', path.join(staging, 'Gamma.zip'), '-C', stage('gamma', { 'Gamma (USA)/Gamma.tst': 'gamma', 'Gamma (USA)/readme.txt': 'hi' }), 'Gamma (USA)'])
  execFileSync(SEVEN, ['a', '-bd', path.join(staging, 'Cube Game.7z'), path.join(stage('cube', { 'Cube Game.iso': gcIso() }), '*')], { stdio: 'ignore' })
  execFileSync(TAR, ['-a', '-cf', path.join(staging, 'Mystery.zip'), '-C', stage('mystery', { 'Mystery.chd': 'chd' }), 'Mystery.chd'])
  for (const n of ['Gamma.zip', 'Cube Game.7z', 'Mystery.zip']) fs.renameSync(path.join(staging, n), path.join(dl, n))
  fs.writeFileSync(path.join(dl, 'Delta.tst'), 'delta') // a plain game file
  fs.writeFileSync(path.join(dl, 'Broken.zip'), 'not really a zip')
  fs.writeFileSync(path.join(dl, 'notes.txt'), 'just notes')
  fs.writeFileSync(path.join(dl, 'Epsilon.tst.crdownload'), 'still downloading')

  const { app, page } = await launchApp(files, presets)
  const games = (c: string) => path.join(files, 'games', c)
  await expect.poll(() => fs.existsSync(path.join(games('testcon'), 'Gamma.tst')), { timeout: 20_000 }).toBe(true)
  await expect.poll(() => fs.existsSync(path.join(games('gc'), 'Cube Game.iso')), { timeout: 20_000 }).toBe(true)
  await expect.poll(() => fs.existsSync(path.join(games('testcon'), 'Delta.tst')), { timeout: 20_000 }).toBe(true)
  // unclear console: the file is kept in New downloads and the menu asks
  await expect.poll(() => fs.existsSync(path.join(dl, 'Mystery.chd')), { timeout: 20_000 }).toBe(true)
  await expect(page.getByText('Which console is this for?')).toBeVisible()
  // sorted archives are in the (test) Recycle Bin; the readme went with the unpacked leftovers
  await expect.poll(() => fs.readdirSync(dl).sort(), { timeout: 10_000 }).toEqual(['Broken.zip', 'Epsilon.tst.crdownload', 'Mystery.chd', 'notes.txt'])
  const trash = fs.readdirSync(path.join(files, 'config', 'test-trash'))
  for (const n of ['Gamma.zip', 'Cube Game.7z', 'Mystery.zip']) expect(trash.some((t) => t.endsWith(n)), n).toBe(true)
  expect(fs.readFileSync(path.join(games('testcon'), 'Gamma.tst'), 'utf8')).toBe('gamma')
  expect(fs.readdirSync(path.join(files, 'config', 'downloads')).filter((n) => n.startsWith('unpack-'))).toEqual([])
  await expect(page.getByTestId('notices')).toContainText('Could not unpack')

  // answering the question sorts it
  const r = await api<{ added: { console: string }[] }>(page, 'addGames', [path.join(dl, 'Mystery.chd')], 'ps2')
  expect(r.added[0].console).toBe('ps2')
  expect(fs.existsSync(path.join(games('ps2'), 'Mystery.chd'))).toBe(true)

  // the partial download is picked up once the browser renames it
  await page.waitForTimeout(1000)
  expect(fs.existsSync(path.join(dl, 'Epsilon.tst.crdownload'))).toBe(true)
  fs.renameSync(path.join(dl, 'Epsilon.tst.crdownload'), path.join(dl, 'Epsilon.tst'))
  // its time stamp is from "now", so it waits for the download to settle first
  await expect.poll(() => fs.existsSync(path.join(games('testcon'), 'Epsilon.tst')), { timeout: 20_000 }).toBe(true)
  const st = await api<{ library: { games: { title: string }[] } }>(page, 'getState')
  expect(st.library.games.map((g) => g.title)).toEqual(expect.arrayContaining(['Gamma', 'Delta', 'Epsilon']))

  // the same game downloaded again: not kept and tried again at every start, but binned with a word
  execFileSync(TAR, ['-a', '-cf', path.join(staging, 'Gamma again.zip'), '-C', path.join(staging, 'gamma'), 'Gamma (USA)'])
  fs.renameSync(path.join(staging, 'Gamma again.zip'), path.join(dl, 'Gamma again.zip'))
  await expect.poll(() => fs.existsSync(path.join(dl, 'Gamma again.zip')), { timeout: 20_000 }).toBe(false)
  expect(fs.readdirSync(path.join(files, 'config', 'test-trash')).some((t) => t.endsWith('Gamma again.zip'))).toBe(true)
  await expect(page.getByTestId('notices')).toContainText('Already in your library')

  // switched off: nothing is touched
  await api(page, 'setSetting', 'sortDownloads', false)
  fs.writeFileSync(path.join(dl, 'Zeta.tst'), 'zeta')
  await page.waitForTimeout(4000)
  expect(fs.existsSync(path.join(dl, 'Zeta.tst'))).toBe(true)
  expect(fs.readdirSync(dl).sort()).toEqual(['Broken.zip', 'Zeta.tst', 'notes.txt'])
  await app.close()
})
