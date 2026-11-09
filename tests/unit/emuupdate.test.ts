import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

vi.mock('electron', () => ({ net: { fetch: () => Promise.reject(new Error('offline')) }, app: { getVersion: () => '0.0.0', isPackaged: false, getAppPath: () => '.' } }))
const SOURCE = path.resolve(__dirname, '..', '..')
const FILES = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'emuupdate-'))
process.env.STARSTATION_FILES = FILES
process.env.STARSTATION_PRESETS = path.join(SOURCE, 'presets')
const { loadPresets, getEmulator, emulatorDir } = await import('../../src/main/presets')
const { installStaged, previousDir } = await import('../../src/main/emulators')
loadPresets()

const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
function zip(name: string, files: Record<string, string>): string {
  const d = fs.mkdtempSync(path.join(FILES, 'zipsrc-'))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true })
    fs.writeFileSync(path.join(d, rel), text)
  }
  const out = path.join(FILES, name)
  execFileSync(tar, ['-a', '-c', '-f', out, '-C', d, ...Object.keys(files).map((k) => k.split(path.sep)[0])])
  return out
}

/** #12: an emulator update never leaves a half-updated emulator. */
describe('emulator update', () => {
  const e = getEmulator('duckstation')!
  const live = emulatorDir(e)
  const exe = path.join(live, e.exe)

  it('new program files move in; settings stay; the replaced files are kept', async () => {
    fs.mkdirSync(live, { recursive: true })
    fs.writeFileSync(exe, 'old exe')
    fs.writeFileSync(path.join(live, 'settings.ini'), 'my settings')
    await installStaged(e, zip('new.zip', { [e.exe]: 'new exe', 'resources/a.dat': 'res' }))
    expect(fs.readFileSync(exe, 'utf8')).toBe('new exe')
    expect(fs.readFileSync(path.join(live, 'resources', 'a.dat'), 'utf8')).toBe('res')
    expect(fs.readFileSync(path.join(live, 'settings.ini'), 'utf8')).toBe('my settings')
    expect(fs.readFileSync(path.join(previousDir(e), e.exe), 'utf8')).toBe('old exe')
    expect(fs.readdirSync(path.dirname(live)).filter((n) => n.includes('.new-'))).toEqual([])
  })

  it('a download without the program changes nothing', async () => {
    await expect(installStaged(e, zip('broken.zip', { 'readme.txt': 'oops' }))).rejects.toThrow(/Nothing was changed/)
    expect(fs.readFileSync(exe, 'utf8')).toBe('new exe')
    expect(fs.existsSync(path.join(live, 'readme.txt'))).toBe(false)
  })

  it('a file that can not be replaced half-way puts the old version back', async () => {
    // a folder where a new file wants to go: that move fails after the exe was already swapped
    fs.mkdirSync(path.join(live, 'zzz'), { recursive: true })
    fs.writeFileSync(path.join(live, 'zzz', 'keep'), 'k') // a file where the update wants a folder
    const z = zip('half.zip', { [e.exe]: 'newer exe', 'zzz/keep/deeper.txt': 'cannot' })
    await expect(installStaged(e, z)).rejects.toThrow(/old version was kept/)
    expect(fs.readFileSync(exe, 'utf8')).toBe('new exe')
    expect(fs.readFileSync(path.join(live, 'zzz', 'keep'), 'utf8')).toBe('k')
  })
})
