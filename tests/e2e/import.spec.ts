import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, writeSettings } from './helpers'

/** A fake Desktop\Emulator-style setup (never the real one). */
function makeSource(root: string): void {
  const w = (rel: string, data: string | Buffer = 'x') => {
    const f = path.join(root, rel)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, data)
  }
  w('Emulators/PCSX2-Qt/pcsx2-qt.exe', 'fake exe')
  w('Emulators/PCSX2-Qt/portable.ini', '')
  w('Emulators/PCSX2-Qt/inis/PCSX2.ini', '[Folders]\nBios = C:\\old\\bios\n\n[Pad1]\nCross = XInput-0/A\n')
  w('Emulators/PCSX2-Qt/resources/GameIndex.yaml', 'SLUS-99999:\n  name: "Imported Game"\n')
  w('Emulators/RPCS3/rpcs3.exe', 'fake exe')
  w('Emulators/RPCS3/dev_flash/vsh/module/vsh.self', 'fw')
  w('Emulation/bios/SCPH-70004_BIOS_V12_EUR_200.BIN', Buffer.alloc(4 * 1024 * 1024, 1))
  w('Emulation/bios/SCPH-70004_BIOS_V12_EUR_200.NVM', Buffer.alloc(1024, 2))
  w('Emulation/bios/random-notes.txt', 'not a bios')
  w('Emulation/saves/pcsx2/memcards/Mcd001.ps2', Buffer.alloc(8 * 1024 * 1024, 3))
  w('Emulation/saves/pcsx2/sstates/SLUS-99999.01.p2s', 'state')
  w('Emulation/storage/rpcs3/dev_hdd0/home/00000001/savedata/BLUS0001/SAVE.DAT', 'ps3 save')
  fs.mkdirSync(path.join(root, 'Emulation/storage/rpcs3/dev_hdd0/game/EMPTY0001/USRDIR'), { recursive: true })
  w('Emulation/roms/ps2/Imported Game (USA).iso', Buffer.alloc(64 * 1024, 4))
  w('Emulation/roms/ps2/Imported Game (USA).7z', 'archive')
  w('Emulation/roms/ps2/systeminfo.txt', 'es-de info')
}

test('import copies and verifies everything, then moves only games', async () => {
  const files = makeFiles('import')
  const src = path.join(files, '_source', 'Emulator')
  makeSource(src)
  writeSettings(files, { bootAnimation: false })
  process.env.STARSTATION_IMPORT_SOURCE = src
  const { app, page } = await launchApp(files)
  delete process.env.STARSTATION_IMPORT_SOURCE

  await page.getByTestId('cat-settings').dispatchEvent('click')
  // further down the Settings list: move there first (only items near the selection are drawn)
  for (let i = 0; i < 30 && !(await page.getByTestId('item-import').count()); i++) await page.keyboard.press('ArrowDown')
  await page.getByTestId('item-import').click()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('panel-import')).toContainText('Games: 1')
  await expect(page.getByTestId('panel-import')).toContainText('Emulators: 2')
  await page.getByTestId('pitem-run0').click()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('panel-import')).toContainText('Done: 1 game(s) moved', { timeout: 30_000 })

  const F = (rel: string) => path.join(files, rel)
  const S = (rel: string) => path.join(src, rel)
  // copied (originals untouched)
  expect(fs.existsSync(F('emulators/pcsx2/pcsx2-qt.exe'))).toBe(true)
  expect(fs.existsSync(S('Emulators/PCSX2-Qt/pcsx2-qt.exe'))).toBe(true)
  expect(fs.statSync(F('bios/ps2/SCPH-70004_BIOS_V12_EUR_200.BIN')).size).toBe(4 * 1024 * 1024)
  expect(fs.existsSync(F('bios/ps2/SCPH-70004_BIOS_V12_EUR_200.NVM'))).toBe(true)
  expect(fs.existsSync(F('bios/ps2/random-notes.txt'))).toBe(false)
  expect(fs.existsSync(S('Emulation/bios/SCPH-70004_BIOS_V12_EUR_200.BIN'))).toBe(true)
  expect(fs.statSync(F('saves/ps2/memcards/Mcd001.ps2')).size).toBe(8 * 1024 * 1024)
  expect(fs.existsSync(F('saves/ps2/sstates/SLUS-99999.01.p2s'))).toBe(true)
  expect(fs.existsSync(S('Emulation/saves/pcsx2/memcards/Mcd001.ps2'))).toBe(true)
  expect(fs.readFileSync(F('emulators/rpcs3/dev_hdd0/home/00000001/savedata/BLUS0001/SAVE.DAT'), 'utf8')).toBe('ps3 save')
  // PS3 saves are reachable through the saves folder link
  expect(fs.readFileSync(F('saves/ps3/savedata/BLUS0001/SAVE.DAT'), 'utf8')).toBe('ps3 save')
  // moved: only the game; archives and notes stay
  expect(fs.existsSync(F('games/ps2/Imported Game (USA).iso'))).toBe(true)
  expect(fs.existsSync(S('Emulation/roms/ps2/Imported Game (USA).iso'))).toBe(false)
  expect(fs.existsSync(S('Emulation/roms/ps2/Imported Game (USA).7z'))).toBe(true)
  expect(fs.existsSync(S('Emulation/roms/ps2/systeminfo.txt'))).toBe(true)
  // emulator config now points at Starstation's folders, other settings kept
  const ini = fs.readFileSync(F('emulators/pcsx2/inis/PCSX2.ini'), 'utf8')
  expect(ini).toContain(`Bios = ${F('bios\\ps2')}`)
  expect(ini).toContain('Cross = XInput-0/A')
  expect(ini).toContain('BIOS = SCPH-70004_BIOS_V12_EUR_200.BIN')
  expect(fs.readFileSync(F('emulators/rpcs3/config/vfs.yml'), 'utf8')).toContain('/dev_hdd0/: ' + F('emulators/rpcs3/dev_hdd0').replace(/\\/g, '/') + '/')
  // the game shows up in the menu
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('cat-ps2')).toBeVisible()
  await app.close()
})

test('hidden test runs never see the real PC', async () => {
  const files = makeFiles('import-none')
  writeSettings(files, { bootAnimation: false })
  const { app, page } = await launchApp(files)
  const sources = await page.evaluate(() => window.starstation.importScan())
  expect(sources).toEqual([])
  await app.close()
})
