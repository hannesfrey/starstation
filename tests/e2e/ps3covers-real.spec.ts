import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { launchApp, makeFiles, writeSettings, SOURCE } from './helpers'

/**
 * Opt-in (STARSTATION_REAL_PS3=1): Hannes's real PS3 games (junction, only read) get their box covers from the real
 * GameTDB into a test Files folder; a picture of the PS3 column goes to tools\cache\screens\icons (offscreen, nothing shown).
 */
test.skip(process.env.STARSTATION_REAL_PS3 !== '1', 'uses Hannes’s real PS3 games and the internet (STARSTATION_REAL_PS3=1)')

const REAL = path.resolve(__dirname, '..', '..', '..')
const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

test('real PS3 games get box covers', async () => {
  test.setTimeout(10 * 60_000)
  process.env.STARSTATION_ARTWORK_BASE = 'https://thumbnails.libretro.com' // lets the hidden app look online
  const files = makeFiles('ps3covers')
  writeSettings(files, { bootAnimation: false, sounds: false })
  fs.mkdirSync(path.join(files, 'games'), { recursive: true })
  execFileSync('cmd.exe', ['/c', 'mklink', '/J', path.join(files, 'games', 'ps3'), path.join(REAL, 'games', 'ps3')], { stdio: 'ignore' })
  const { app, page } = await launchApp(files)
  try {
    type G = { title: string; console: string; icon?: string }
    const ps3 = async () => (await api<{ library: { games: G[] } }>(page, 'getState')).library.games.filter((g) => g.console === 'ps3')
    await expect.poll(async () => (await ps3()).length, { timeout: 60_000 }).toBeGreaterThan(10)
    await expect
      .poll(async () => (await ps3()).filter((g) => !/icon\.png$/i.test(g.icon ?? '')).map((g) => g.title), { timeout: 8 * 60_000, intervals: [5000] })
      .toEqual([])
    for (const g of await ps3()) console.log(`${g.title}: ${path.relative(files, g.icon ?? '')}`)
    const png = await app.evaluate(
      async ({ BrowserWindow }, { html, preload }) => {
        const win = new BrowserWindow({ show: false, width: 1600, height: 900, webPreferences: { offscreen: true, preload, sandbox: true, contextIsolation: true } })
        await win.loadFile(html)
        await new Promise((r) => setTimeout(r, 2500))
        await win.webContents.executeJavaScript(`document.querySelector('[data-testid="cat-ps3"]').click()`)
        await new Promise((r) => setTimeout(r, 400))
        for (let i = 0; i < 2; i++) {
          win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' })
          win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' })
          await new Promise((r) => setTimeout(r, 300))
        }
        await new Promise((r) => setTimeout(r, 1500))
        const img = await win.webContents.capturePage()
        win.destroy()
        return img.toPNG().toString('base64')
      },
      { html: path.join(SOURCE, 'out', 'renderer', 'index.html'), preload: path.join(SOURCE, 'out', 'preload', 'index.js') }
    )
    fs.mkdirSync(path.join(SOURCE, 'tools', 'cache', 'screens', 'icons'), { recursive: true })
    fs.writeFileSync(path.join(SOURCE, 'tools', 'cache', 'screens', 'icons', 'ps3-covers.png'), Buffer.from(png, 'base64'))
  } finally {
    await app.close()
    execFileSync('cmd.exe', ['/c', 'rmdir', path.join(files, 'games', 'ps3')], { stdio: 'ignore' })
    fs.rmSync(files, { recursive: true, force: true })
    delete process.env.STARSTATION_ARTWORK_BASE
  }
})
