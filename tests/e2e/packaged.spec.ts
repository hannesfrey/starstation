import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { makeFiles, SOURCE, writeSettings } from './helpers'

/**
 * The installed program, not the development build: things that only break once packaged (a file left out of
 * the installer, a path that only exists in development) show up here. Runs on release/win-unpacked, which
 * `npm run release` builds; skipped when that build is missing or belongs to another version.
 */

const EXE = path.join(SOURCE, 'release', 'win-unpacked', 'Starstation.exe')
const VERSION = JSON.parse(fs.readFileSync(path.join(SOURCE, 'package.json'), 'utf8')).version as string
/** Set by scripts/release.mjs: there a missing or wrong build is a failure, not a skip. */
const REQUIRED = process.env.STARSTATION_REQUIRE_PACKAGED === '1'
/** Everything Starstation brings with it (resources\bin), see scripts/fetch-bin.mjs. */
const BUNDLED = ['7zr.exe', 'croc.exe', 'padhelper.exe', 'chdman.exe', 'xdelta3.exe', 'extract-xiso.exe', 'ds3-driver.ps1']

test('the packaged Starstation starts, finds its presets and every bundled tool', async () => {
  if (REQUIRED) expect(fs.existsSync(EXE), EXE).toBe(true)
  else test.skip(!fs.existsSync(EXE), 'no packaged build (npm run release builds one)')
  const files = makeFiles('packaged')
  writeSettings(files, { bootAnimation: false, showEmptyConsoles: true })
  const app = await electron.launch({
    executablePath: EXE,
    env: { ...process.env, STARSTATION_FILES: files, STARSTATION_HEADLESS: '1', ELECTRON_RENDERER_URL: '' }
  })
  try {
    const built = await app.evaluate(({ app: a }) => a.getVersion())
    if (REQUIRED) expect(built).toBe(VERSION)
    else test.skip(built !== VERSION, `packaged build is ${built}, the source is ${VERSION}`)
    let page = await app.firstWindow()
    if (page.url().includes('#overlay')) page = app.windows().find((w) => !w.url().includes('#overlay')) ?? (await app.waitForEvent('window'))
    await page.waitForFunction(() => !!(window as unknown as { starstation?: unknown }).starstation)
    const s = await page.evaluate(() => window.starstation.getState())
    expect(s.info.isPackaged).toBe(true)
    expect(s.info.filesDir.toLowerCase()).toBe(path.resolve(files).toLowerCase())
    expect(s.consoles.map((c) => c.short)).toEqual(['NES', 'SNES', 'N64', 'GameCube', 'Wii', '3DS', 'PS1', 'PS2', 'PS3', 'Xbox', 'Xbox 360'])
    await expect(page.getByTestId('xmb')).toBeVisible()

    const resources = await app.evaluate(() => process.resourcesPath)
    for (const f of BUNDLED) expect(fs.existsSync(path.join(resources, 'bin', f)), f).toBe(true)
    expect(fs.existsSync(path.join(resources, 'icon.ico'))).toBe(true)

    // nothing went wrong on the way up
    const log = fs.readdirSync(path.join(files, 'config', 'logs')).map((n) => fs.readFileSync(path.join(files, 'config', 'logs', n), 'utf8')).join('')
    expect(log).toContain(`Starstation ${VERSION} starting`)
    expect(log).not.toMatch(/ERROR/)
  } finally {
    await app.close()
  }
})
