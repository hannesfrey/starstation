import { test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, writeSettings, SOURCE } from './helpers'

// Visual check of every icon and button glyph (the #icons page): SCREENSHOTS=1 npx playwright test icons-screens
// Rendered in an offscreen window (nothing on screen; hidden windows don't repaint for captures).
test.skip(!process.env.SCREENSHOTS, 'screenshots only on request')

test('icon sheet', async () => {
  const files = makeFiles('icons')
  writeSettings(files, { bootAnimation: false, sounds: false })
  const out = path.join(SOURCE, 'tools', 'cache', 'screens', 'icons')
  fs.mkdirSync(out, { recursive: true })
  const { app } = await launchApp(files)
  const shot = async (hash: string, file: string, w = 1600, h = 1000) => {
    const png = await app.evaluate(
      async ({ BrowserWindow }, { hash, w, h, html }) => {
        const win = new BrowserWindow({ show: false, width: w, height: h, webPreferences: { offscreen: true } })
        await win.loadFile(html, { hash })
        await new Promise((r) => setTimeout(r, 1200))
        const img = await win.webContents.capturePage()
        win.destroy()
        return img.toPNG().toString('base64')
      },
      { hash, w, h, html: path.join(SOURCE, 'out', 'renderer', 'index.html') }
    )
    fs.writeFileSync(path.join(out, file), Buffer.from(png, 'base64'))
  }
  await shot('icons', 'sheet.png', 1600, 1100)
  await app.close()
})

test('menu with every console', async () => {
  const files = makeFiles('icons-menu')
  writeSettings(files, { bootAnimation: false, sounds: false })
  const games: Record<string, string> = {
    nes: 'Game.nes',
    snes: 'Game.sfc',
    n64: 'Game.z64',
    gc: 'Game.rvz',
    wii: 'Game.wbfs',
    '3ds': 'Game.3ds',
    ps1: 'Game.chd',
    ps2: 'Game.iso',
    xbox: 'Game.xiso.iso'
  }
  for (const [c, f] of Object.entries(games)) {
    fs.mkdirSync(path.join(files, 'games', c), { recursive: true })
    fs.writeFileSync(path.join(files, 'games', c, f), 'x')
  }
  const out = path.join(SOURCE, 'tools', 'cache', 'screens', 'icons')
  const { app } = await launchApp(files)
  for (const [n, rights] of [
    ['menu-consoles.png', 3],
    ['menu-consoles-2.png', 8]
  ] as const) {
    const png = await app.evaluate(
      async ({ BrowserWindow }, { html, preload, rights }) => {
        const win = new BrowserWindow({ show: false, width: 1600, height: 900, webPreferences: { offscreen: true, preload, sandbox: true, contextIsolation: true } })
        await win.loadFile(html)
        await new Promise((r) => setTimeout(r, 2500))
        for (let i = 0; i < rights; i++) {
          win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' })
          win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
          await new Promise((r) => setTimeout(r, 250))
        }
        await new Promise((r) => setTimeout(r, 900))
        const img = await win.webContents.capturePage()
        win.destroy()
        return img.toPNG().toString('base64')
      },
      { html: path.join(SOURCE, 'out', 'renderer', 'index.html'), preload: path.join(SOURCE, 'out', 'preload', 'index.js'), rights }
    )
    fs.writeFileSync(path.join(out, n), Buffer.from(png, 'base64'))
  }
  await app.close()
})
