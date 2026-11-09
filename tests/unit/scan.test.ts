import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({ net: { fetch: () => Promise.reject(new Error('offline')) }, app: { getVersion: () => '0.0.0', isPackaged: false, getAppPath: () => '.' } }))
const SOURCE = path.resolve(__dirname, '..', '..')
const FILES = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'scan-'))
process.env.STARSTATION_FILES = FILES
process.env.STARSTATION_PRESETS = path.join(SOURCE, 'presets')
const { loadPresets } = await import('../../src/main/presets')
const { rescan, loadLibrary } = await import('../../src/main/library/library')
loadPresets()
loadLibrary()

/** #28 the library scan: never blocking, one at a time, and a drive that is gone keeps its games. */
describe('library scan', () => {
  const nesDir = path.join(FILES, 'games', 'nes')
  const usb = path.join(FILES, 'usb-drive', 'nes')

  it('finds games', async () => {
    fs.mkdirSync(usb, { recursive: true })
    fs.writeFileSync(path.join(usb, 'Zelda.nes'), 'rom')
    fs.mkdirSync(path.dirname(nesDir), { recursive: true })
    fs.symlinkSync(usb, nesDir, 'junction') // the NES games live on a USB drive
    const lib = await rescan()
    expect(lib.games.filter((g) => g.console === 'nes').map((g) => g.title)).toEqual(['Zelda'])
  })

  it('a linked games folder whose drive is gone keeps its games', async () => {
    fs.renameSync(path.join(FILES, 'usb-drive'), path.join(FILES, 'usb-unplugged'))
    const lib = await rescan()
    expect(lib.games.filter((g) => g.console === 'nes').map((g) => g.title)).toEqual(['Zelda'])
    fs.renameSync(path.join(FILES, 'usb-unplugged'), path.join(FILES, 'usb-drive'))
  })

  it('a game deleted for real does go', async () => {
    fs.rmSync(path.join(usb, 'Zelda.nes'))
    const lib = await rescan()
    expect(lib.games.filter((g) => g.console === 'nes')).toEqual([])
  })

  it('scans asked for at the same time run one after the other', async () => {
    fs.writeFileSync(path.join(usb, 'Metroid.nes'), 'rom')
    const [a, b] = await Promise.all([rescan(), rescan()])
    expect(a.games.length).toBe(b.games.length)
    expect(b.games.map((g) => g.title)).toContain('Metroid')
  })
})
