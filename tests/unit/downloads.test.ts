import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.STARSTATION_FILES ??= fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'dl-files-'))
const { stillWriting } = await import('../../src/main/downloads')

describe('New downloads: a file another program is still writing', () => {
  it('is busy while held open for writing (like an Explorer copy), free afterwards', async () => {
    const d = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'dl-'))
    const f = path.join(d, 'Game.iso')
    fs.writeFileSync(f, Buffer.alloc(1024))
    expect(stillWriting(f)).toBe(false)

    // a writer that only lets others read (what a copy does): Windows refuses a second writer
    const holder = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `$s=[IO.File]::Open('${f}','Open','ReadWrite','Read'); [Console]::Out.WriteLine('held'); Start-Sleep -Seconds 20; $s.Close()`],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    )
    await new Promise<void>((resolve) => holder.stdout!.on('data', (b: Buffer) => b.toString().includes('held') && resolve()))
    try {
      expect(stillWriting(f)).toBe(true)
    } finally {
      holder.kill()
      await new Promise((r) => holder.once('exit', r))
    }
    expect(stillWriting(f)).toBe(false)
    fs.rmSync(d, { recursive: true, force: true })
  }, 30_000)

  it('a missing file is not busy', () => {
    expect(stillWriting(path.join(os.tmpdir(), 'no-such-file-here.iso'))).toBe(false)
  })
})
