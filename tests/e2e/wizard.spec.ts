import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, writeSettings } from './helpers'

/** Step 11: the first-start wizard. */

test('first start shows the setup wizard; "Start fresh" walks through to the menu', async () => {
  const files = makeFiles('wizard', { wizard: true })
  writeSettings(files, { bootAnimation: false })
  const { app, page } = await launchApp(files)
  try {
    await expect(page.getByTestId('panel-wiz-welcome')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('panel-wiz-location')).toContainText(files)
    await page.keyboard.press('Enter') // Next
    await expect(page.getByTestId('panel-wiz-start')).toBeVisible()
    // ○ goes one step back
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('panel-wiz-location')).toBeVisible()
    await page.keyboard.press('Enter')
    await page.getByTestId('pitem-fresh').dblclick()
    await expect(page.getByTestId('panel-wiz-emulators')).toContainText('PCSX2')
    await page.getByTestId('pitem-next').dblclick()
    await expect(page.getByTestId('panel-wiz-bios')).toContainText('PS2')
    await page.getByTestId('pitem-next').dblclick()
    await expect(page.getByTestId('panel-wiz-controller')).toBeVisible()
    await page.getByTestId('pitem-next').dblclick()
    await expect(page.getByTestId('panel-wiz-artwork')).toBeVisible()
    await page.getByTestId('pitem-later').dblclick()
    await expect(page.getByTestId('panel-wiz-artwork')).toHaveCount(0)
    await expect(page.getByTestId('xmb')).toBeVisible()
    await expect.poll(() => fs.existsSync(path.join(files, 'config', 'setup.json'))).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(files, 'config', 'settings.json'), 'utf8')).artworkAuto).toBe(false)
  } finally {
    await app.close()
  }
  // next start: no wizard
  const again = await launchApp(files)
  try {
    await expect(again.page.getByTestId('xmb')).toBeVisible()
    await expect(again.page.getByTestId('panel-wiz-welcome')).toHaveCount(0)
  } finally {
    await again.app.close()
  }
})

test('an existing setup is offered "Continue where you left off"', async () => {
  const files = makeFiles('wizard-existing', { wizard: true })
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'nes'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'nes', 'Game.nes'), 'rom')
  const { app, page } = await launchApp(files)
  try {
    await expect(page.getByTestId('panel-wiz-welcome')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('pitem-continue')).toBeVisible()
    await page.getByTestId('pitem-continue').dblclick()
    await expect(page.getByTestId('xmb')).toBeVisible()
    await expect(page.getByTestId('items').getByText('Game')).toBeVisible()
  } finally {
    await app.close()
  }
})
