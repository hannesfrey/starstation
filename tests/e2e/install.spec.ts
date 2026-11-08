import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, writeSettings } from './helpers'

// Downloads real emulators from their official sources: NETWORK=1 npx playwright test install
// (several GB; each emulator gets its own throw-away Files folder)
test.skip(!process.env.NETWORK, 'network tests only on request')
// hidden runs only download for real when a test says so (the app refuses otherwise)
if (process.env.NETWORK) process.env.STARSTATION_TEST_NETWORK = '1'

const EMULATORS: [id: string, exe: string][] = [
  ['pcsx2', 'pcsx2-qt.exe'],
  ['duckstation', 'duckstation-qt-x64-ReleaseLTCG.exe'],
  ['rpcs3', 'rpcs3.exe'],
  ['retroarch', 'retroarch.exe'],
  ['dolphin', 'Dolphin.exe'],
  ['azahar', 'azahar.exe'],
  ['xemu', 'xemu.exe'],
  ['xenia', 'xenia_canary.exe'],
]

for (const [id, exe] of EMULATORS) {
  test(`emulator manager installs ${id} into Files\\emulators`, async () => {
    test.setTimeout(600_000)
    const files = makeFiles(`install-${id}`)
    writeSettings(files, { bootAnimation: false })
    const { app, page } = await launchApp(files)
    const before = await page.evaluate(() => window.starstation.checkEmulatorUpdates())
    const info = before.find((e) => e.id === id)!
    expect(info.installed).toBe(false)
    // GitHub emulators report their newest release; RetroArch/Dolphin use a fixed official URL
    const fixed: Record<string, string> = { retroarch: '1.22.2', dolphin: '2609a' }
    if (!fixed[id]) expect(info.latest).toBeTruthy()
    const r = await page.evaluate((i) => window.starstation.installEmulator(i), id)
    expect(r.ok, r.error).toBe(true)
    const emu = path.join(files, 'emulators', id)
    expect(fs.existsSync(path.join(emu, exe)), `${exe} in ${fs.readdirSync(emu).join(', ')}`).toBe(true)
    const marker = JSON.parse(fs.readFileSync(path.join(emu, '.starstation.json'), 'utf8'))
    expect(marker.version).toBe(fixed[id] ?? info.latest!.replace(/^v/, ''))
    const after = await page.evaluate(() => window.starstation.emulators())
    expect(after.find((e) => e.id === id)).toMatchObject({ installed: true, updateAvailable: false })

    if (id === 'retroarch') {
      // cores come from the libretro buildbot on first use
      for (const core of ['mesen', 'snes9x', 'mupen64plus_next']) {
        await page.evaluate((c) => window.starstation.runCommand('install-core', c), core)
        expect(fs.existsSync(path.join(emu, 'cores', `${core}_libretro.dll`)), core).toBe(true)
      }
    }

    // download cleaned up, nothing left in temp folders
    expect(fs.readdirSync(path.join(files, 'config', 'downloads'))).toEqual([])
    expect(fs.readdirSync(path.join(files, 'emulators')).filter((n) => n.includes('extract'))).toEqual([])
    await app.close()
    fs.rmSync(files, { recursive: true, force: true })
  })
}
