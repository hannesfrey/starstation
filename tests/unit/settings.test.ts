import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const FILES = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'settings-test-'))
process.env.STARSTATION_FILES = FILES
const { getSettings, setSetting } = await import('../../src/main/settings')

/** #22: a setting changes only once it is saved — a failed save must not leave the menu showing a value that is lost at the next start. */
describe('setSetting', () => {
  it('keeps the old value when saving fails', () => {
    const before = getSettings().sounds
    // the settings file can't be written: a folder sits where it belongs
    fs.mkdirSync(path.join(FILES, 'config', 'settings.json'), { recursive: true })
    expect(() => setSetting('sounds', !before)).toThrow()
    expect(getSettings().sounds).toBe(before)
    fs.rmSync(path.join(FILES, 'config', 'settings.json'), { recursive: true })
    expect(setSetting('sounds', !before).sounds).toBe(!before)
    expect(getSettings().sounds).toBe(!before)
  })
})
