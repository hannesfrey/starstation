import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({ net: { fetch: () => Promise.reject(new Error('offline')) }, app: { getVersion: () => '0.0.0', isPackaged: false, getAppPath: () => '.' } }))
const SOURCE = path.resolve(__dirname, '..', '..')
process.env.STARSTATION_FILES = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'newdl-'))
process.env.STARSTATION_PRESETS = path.join(SOURCE, 'presets')
process.env.STARSTATION_DOWNLOADS_POLL = '20'
process.env.STARSTATION_DOWNLOADS_RETRY = '400'
const { loadPresets } = await import('../../src/main/presets')
const { checkDownloads, downloadsDir } = await import('../../src/main/downloads')
loadPresets()

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** #29: handled folders are not walked again every few seconds; a failed item is tried again later. */
describe('New downloads folder', () => {
  const notices: string[] = []
  const hooks = {
    addGames: async () => ({ added: [], ask: [], errors: [] }),
    trash: async () => undefined,
    notify: (n: { title: string }) => void notices.push(n.title),
    ask: () => undefined,
    paused: () => false
  }
  const look = async (times = 3) => {
    for (let i = 0; i < times; i++) {
      await checkDownloads(hooks)
      await wait(40)
    }
  }

  it('a damaged archive is reported, then tried again a little later (not every look)', async () => {
    fs.mkdirSync(downloadsDir(), { recursive: true })
    const bad = path.join(downloadsDir(), 'Broken.zip')
    fs.writeFileSync(bad, 'this is not a zip')
    fs.utimesSync(bad, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
    await look()
    const first = notices.filter((t) => t === 'Could not unpack a download').length
    expect(first).toBe(1)
    await look(3)
    expect(notices.filter((t) => t === 'Could not unpack a download').length).toBe(1) // not again right away
    await wait(450)
    await look(2)
    expect(notices.filter((t) => t === 'Could not unpack a download').length).toBe(2) // tried again later
    fs.rmSync(bad)
  })

  it('a handled folder is not walked file by file on every look', async () => {
    const folder = path.join(downloadsDir(), 'Extras')
    fs.mkdirSync(path.join(folder, 'deep'), { recursive: true })
    for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(folder, 'deep', `f${i}.txt`), 'x')
    const old = new Date(Date.now() - 60_000)
    fs.utimesSync(path.join(folder, 'deep'), old, old)
    fs.utimesSync(folder, old, old)
    await look()
    expect(notices).toContain('No game found in a folder')
    const spy = vi.spyOn(fs, 'readdirSync')
    await look(3)
    const deepWalks = spy.mock.calls.filter((c) => String(c[0]).endsWith(`${path.sep}deep`)).length
    spy.mockRestore()
    expect(deepWalks).toBe(0)
  })
})
