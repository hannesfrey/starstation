import { test, expect } from '@playwright/test'
import { launchApp, makeFiles, writeSettings } from './helpers'

test('all 11 console presets load in the spec order', async () => {
  const files = makeFiles('presets')
  writeSettings(files, { bootAnimation: false, showEmptyConsoles: true })
  const { app, page } = await launchApp(files)
  const s = await page.evaluate(() => window.starstation.getState())
  expect(s.consoles.map((c) => c.short)).toEqual(['NES', 'SNES', 'N64', 'GameCube', 'Wii', '3DS', 'PS1', 'PS2', 'PS3', 'Xbox', 'Xbox 360'])
  expect(s.consoles.every((c) => c.status === 'missing-emulator')).toBe(true)
  const cats = await page.locator('.xmb-cat').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  expect(cats).toEqual(['cat-users', 'cat-settings', 'cat-photo', 'cat-collections', 'cat-nes', 'cat-snes', 'cat-n64', 'cat-gc', 'cat-wii', 'cat-3ds', 'cat-ps1', 'cat-ps2', 'cat-ps3', 'cat-xbox', 'cat-xbox360'])
  // Settings stays short (2.0.15): ten entries, the rest inside them
  await page.getByTestId('cat-settings').dispatchEvent('click')
  await expect(page.getByTestId('item-general')).toBeVisible()
  const settings = await page.locator('[data-testid^="item-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  expect(settings).toEqual(['item-general', 'item-look', 'item-consoles', 'item-controllers', 'item-games', 'item-online', 'item-system', 'item-help', 'item-about', 'item-power'])
  await app.close()
})