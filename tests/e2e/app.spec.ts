import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, makePresets, writeSettings } from './helpers'

test('boot animation shows and can be skipped', async () => {
  const files = makeFiles('boot')
  const { app, page } = await launchApp(files)
  // tests must never pop up on the real screen or play sound
  const shown = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible() || !w.webContents.isAudioMuted()))
  expect(shown).toEqual([false])
  await expect(page.getByTestId('boot')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('boot')).toHaveCount(0, { timeout: 3000 })
  await expect(page.getByTestId('xmb')).toBeVisible()
  await expect(page.getByTestId('clock')).toBeVisible()
  // empty consoles are hidden by default
  await expect(page.getByTestId('cat-settings')).toBeVisible()
  await expect(page.getByTestId('cat-photo')).toBeVisible()
  await expect(page.getByTestId('cat-collections')).toBeVisible()
  await expect(page.getByTestId('cat-ps2')).toHaveCount(0)
  // all data stays in the Files folder
  expect(fs.existsSync(path.join(files, 'config', 'electron'))).toBe(true)
  expect(fs.readdirSync(path.join(files, 'config', 'logs')).some((f) => f.endsWith('.log'))).toBe(true)
  await app.close()
})

test('games are found, launched, and the menu comes back with play time', async () => {
  const files = makeFiles('launch')
  const presets = makePresets(files, 2500)
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Cool Game (USA) [!].tst'), 'x')
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Another Game (Europe).tst'), 'y')

  const { app, page } = await launchApp(files, presets)
  await expect(page.getByTestId('cat-testcon')).toBeVisible()
  // starts on the first console with games; A–Z order
  const items = page.getByTestId('items')
  await expect(items.getByText('Another Game')).toBeVisible()
  await expect(items.getByText('Cool Game')).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('game-info')).toContainText('Cool Game')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('running')).toBeVisible()
  await expect(page.getByTestId('running')).toHaveCount(0, { timeout: 10_000 })

  const launched = JSON.parse(fs.readFileSync(path.join(files, '_fakeemu', 'launched.json'), 'utf8'))
  expect(launched[0]).toContain('Cool Game (USA) [!].tst')
  await expect(page.getByTestId('game-info')).toContainText('Played less than a minute')
  const stats = JSON.parse(fs.readFileSync(path.join(files, 'config', 'library', 'stats.json'), 'utf8'))
  const entry = Object.values(stats)[0] as { playCount: number; playTime: number }
  expect(entry.playCount).toBe(1)
  expect(entry.playTime).toBeGreaterThanOrEqual(2)

  // Favorite via F (Select)
  await page.keyboard.press('f')
  await expect(page.getByTestId('notices')).toContainText('Added to Favorites')
  await expect(page.getByTestId('items').getByText('Favorites')).toBeVisible()
  await app.close()
})

test('settings: show empty consoles, options menu, clear launch errors', async () => {
  const files = makeFiles('settings')
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'ps2'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'ps2', 'Some Game (USA).iso'), Buffer.alloc(4096))
  const { app, page } = await launchApp(files)

  await expect(page.getByTestId('cat-ps2')).toBeVisible()
  await expect(page.getByTestId('cat-ps1')).toHaveCount(0)

  // Launch without PCSX2 installed → clear error with a fix
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('panel-error')).toContainText('PCSX2 is not installed')
  await expect(page.getByTestId('pitem-fix')).toContainText('Install PCSX2')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('panel-error')).toHaveCount(0)

  // Triangle menu (Space)
  await page.keyboard.press(' ')
  await expect(page.getByTestId('panel-game')).toBeVisible()
  await page.keyboard.press('Escape')

  // Start → Settings → General → Show empty consoles
  await page.keyboard.press('Home')
  await expect(page.getByTestId('cat-settings')).toHaveClass(/active/)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('panel-general')).toBeVisible()
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('pitem-empty')).toHaveClass(/active/)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('pitem-empty')).toContainText('On')
  await expect(page.getByTestId('cat-ps1')).toBeAttached()
  await expect(page.getByTestId('cat-ps3')).toBeAttached()
  const s = JSON.parse(fs.readFileSync(path.join(files, 'config', 'settings.json'), 'utf8'))
  expect(s.showEmptyConsoles).toBe(true)
  await app.close()
})
