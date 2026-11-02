import { test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, makePresets, writeSettings, SOURCE } from './helpers'

// Visual check only: SCREENSHOTS=1 npx playwright test screens
test.skip(!process.env.SCREENSHOTS, 'screenshots only on request')

test('capture screens', async () => {
  const files = makeFiles('screens')
  const presets = makePresets(files)
  writeSettings(files, { bootAnimation: true, sounds: false })
  for (const n of ['Cool Game (USA)', 'Another Game (Europe)', 'Space Racer 2000 (USA)', 'Puzzle Planet (Japan)'])
    fs.writeFileSync(path.join(fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true }) ?? path.join(files, 'games', 'testcon'), `${n}.tst`), 'x')
  const out = path.join(SOURCE, 'tools', 'cache', 'screens')
  fs.mkdirSync(out, { recursive: true })
  const { app, page } = await launchApp(files, presets)
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.waitForTimeout(900)
  await page.screenshot({ path: path.join(out, '1-boot.png') })
  await page.waitForTimeout(2800)
  await page.screenshot({ path: path.join(out, '2-xmb.png') })
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(out, '3-xmb-down.png') })
  await page.keyboard.press(' ')
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(out, '4-options.png') })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Home')
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(out, '5-settings.png') })
  await app.close()
})
