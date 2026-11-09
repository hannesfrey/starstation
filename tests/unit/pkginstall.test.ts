import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({ net: { fetch: () => Promise.reject(new Error('offline')) }, app: { getVersion: () => '0.0.0', isPackaged: false, getAppPath: () => '.' } }))
process.env.STARSTATION_FILES = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'pkg-'))
const { pkgInstalled } = await import('../../src/main/convert')

/** #13: the .pkg goes to the Recycle Bin only after a real, complete install. */
describe('pkgInstalled', () => {
  const games = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'games-'))
  fs.mkdirSync(path.join(games, 'BLUS00001'))
  fs.writeFileSync(path.join(games, 'BLUS00001', 'PARAM.SFO'), 'sfo')
  fs.mkdirSync(path.join(games, 'BLUS00002')) // cut off: no PARAM.SFO yet

  it('needs RPCS3 to say it worked, a changed folder, and the game files', () => {
    expect(pkgInstalled(0, false, ['BLUS00001'], games)).toBe(true)
    // RPCS3 crashes on exit after a good headless install (code 0xC0000409); its log says it worked
    expect(pkgInstalled(3221226505, true, ['BLUS00001'], games)).toBe(true)
    expect(pkgInstalled(3221226505, false, ['BLUS00001'], games)).toBe(false) // error, and no success line
    expect(pkgInstalled(0, true, [], games)).toBe(false) // nothing changed
    expect(pkgInstalled(0, true, ['BLUS00001', 'BLUS00002'], games)).toBe(false) // one folder half-written
  })
})
