import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.STARSTATION_FILES ??= fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'emulogs-files-'))
const { readEnds } = await import('../../src/main/emulogs')
const { fatalLines } = await import('../../src/main/formats/emulog')

describe('emulator logs of long sessions', () => {
  it('a 70 MB log: the refused setting at its start and the fatal error at its end are both found', async () => {
    const d = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'emulog-'))
    const f = path.join(d, 'RPCS3.log')
    const filler = Buffer.alloc(70 * 1024 * 1024, 'x\n')
    fs.writeFileSync(f, Buffer.concat([Buffer.from('·E 0:00:00.2 CFG: bad value for Fullscreen\n'), filler, Buffer.from('\n·F 0:32:59.1 {PPU} VM: Access violation\n')]))
    const text = await readEnds(f, fs.statSync(f).size)
    expect(text.length).toBeLessThan(70 * 1024 * 1024)
    expect(fatalLines(text, String.raw`^·F \S+ (.*)$`)).toEqual(['{PPU} VM: Access violation'])
    expect(fatalLines(text, String.raw`^·E \S+ CFG: (.*)$`)).toEqual(['bad value for Fullscreen'])
    fs.rmSync(d, { recursive: true, force: true })
  }, 30_000)
})
