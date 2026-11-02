import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, writeSettings } from './helpers'

// Downloads real emulators from their official GitHub releases: NETWORK=1 npx playwright test install
test.skip(!process.env.NETWORK, 'network tests only on request')

test('emulator manager installs PCSX2 from GitHub into Files\\emulators', async () => {
  test.setTimeout(240_000)
  const files = makeFiles('install')
  writeSettings(files, { bootAnimation: false })
  const { app, page } = await launchApp(files)
  const before = await page.evaluate(() => window.starstation.checkEmulatorUpdates())
  const pcsx2 = before.find((e) => e.id === 'pcsx2')!
  expect(pcsx2.installed).toBe(false)
  expect(pcsx2.latest).toBeTruthy()
  const r = await page.evaluate(() => window.starstation.installEmulator('pcsx2'))
  expect(r.ok, r.error).toBe(true)
  expect(fs.existsSync(path.join(files, 'emulators', 'pcsx2', 'pcsx2-qt.exe'))).toBe(true)
  expect(fs.existsSync(path.join(files, 'emulators', 'pcsx2', 'portable.ini'))).toBe(true)
  const marker = JSON.parse(fs.readFileSync(path.join(files, 'emulators', 'pcsx2', '.starstation.json'), 'utf8'))
  expect(marker.version).toBe(pcsx2.latest!.replace(/^v/, ''))
  const after = await page.evaluate(() => window.starstation.emulators())
  expect(after.find((e) => e.id === 'pcsx2')).toMatchObject({ installed: true, updateAvailable: false })
  // download cleaned up, nothing left in temp folders
  expect(fs.readdirSync(path.join(files, 'config', 'downloads'))).toEqual([])
  expect(fs.readdirSync(path.join(files, 'emulators')).filter((n) => n.includes('extract'))).toEqual([])
  await app.close()
})
