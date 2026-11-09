import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { moveFile, moveGroup, partsOf, renameRetry, verifyTree } from '../../src/main/fsutil'

describe('partsOf: the files of a game', () => {
  it('only files in the game folder (or below), never ones a sheet names elsewhere', () => {
    const d = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'parts-'))
    const game = path.join(d, 'games', 'ps1')
    fs.mkdirSync(path.join(game, 'Tracks'), { recursive: true })
    fs.mkdirSync(path.join(d, 'Documents'), { recursive: true })
    const mine = path.join(d, 'Documents', 'taxes.pdf')
    fs.writeFileSync(mine, 'private')
    fs.writeFileSync(path.join(game, 'Game (Track 1).bin'), 't1')
    fs.writeFileSync(path.join(game, 'Tracks', 'Game (Track 2).bin'), 't2')
    const cue = path.join(game, 'Game.cue')
    fs.writeFileSync(
      cue,
      ['FILE "Game (Track 1).bin" BINARY', 'FILE "Tracks\\Game (Track 2).bin" BINARY', 'FILE "..\\..\\Documents\\taxes.pdf" BINARY', `FILE "${mine}" BINARY`].join('\r\n')
    )
    // (folder names may come back in another case: Windows doesn't mind)
    expect(partsOf(cue).map((p) => path.relative(game, p).toLowerCase()).sort()).toEqual(['game (track 1).bin', path.join('tracks', 'game (track 2).bin')])
    fs.rmSync(d, { recursive: true, force: true })
  })
})

const busy = (code: string) => Object.assign(new Error(`${code}: operation not permitted`), { code })

describe('renameRetry', () => {
  afterEach(() => vi.restoreAllMocks())

  it('tries again while Windows holds the folder for a moment (antivirus, indexer)', async () => {
    const d = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'rename-'))
    fs.mkdirSync(path.join(d, 'saves'))
    const real = fsp.rename.bind(fsp)
    let calls = 0
    vi.spyOn(fsp, 'rename').mockImplementation(async (a, b) => {
      if (++calls <= 2) throw busy('EPERM')
      return real(a, b)
    })
    await renameRetry(path.join(d, 'saves'), path.join(d, 'moved'))
    expect(calls).toBe(3)
    expect(fs.existsSync(path.join(d, 'moved'))).toBe(true)
    fs.rmSync(d, { recursive: true, force: true })
  })

  it('gives up after its tries, and at once for other errors', async () => {
    vi.spyOn(fsp, 'rename').mockRejectedValue(busy('EBUSY'))
    await expect(renameRetry('a', 'b', 3)).rejects.toThrow('EBUSY')
    expect(fsp.rename).toHaveBeenCalledTimes(3)

    vi.restoreAllMocks()
    vi.spyOn(fsp, 'rename').mockRejectedValue(busy('ENOENT'))
    await expect(renameRetry('a', 'b')).rejects.toThrow('ENOENT')
    expect(fsp.rename).toHaveBeenCalledTimes(1)
  })
})

describe('#01 checking copies by content before an original is deleted', () => {
  afterEach(() => vi.restoreAllMocks())

  it('full check finds a big file that has the right size but different content', async () => {
    const d = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'verify-'))
    fs.mkdirSync(path.join(d, 'a'))
    fs.mkdirSync(path.join(d, 'b'))
    const big = Buffer.alloc(65 * 1024 * 1024, 7)
    fs.writeFileSync(path.join(d, 'a', 'game.iso'), big)
    big[big.length - 1] = 8
    fs.writeFileSync(path.join(d, 'b', 'game.iso'), big)
    expect(await verifyTree(path.join(d, 'a'), path.join(d, 'b'))).toEqual([]) // quick check: size only
    expect(await verifyTree(path.join(d, 'a'), path.join(d, 'b'), true)).toEqual([path.join(d, 'b', 'game.iso')])
    fs.rmSync(d, { recursive: true, force: true })
  })

  it('a move to another drive keeps the original when the copy came out wrong', async () => {
    const d = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'move-'))
    const from = path.join(d, 'src', 'game.iso')
    const to = path.join(d, 'dst', 'game.iso')
    fs.mkdirSync(path.dirname(from))
    fs.writeFileSync(from, 'the real game')
    vi.spyOn(fsp, 'rename').mockRejectedValue(Object.assign(new Error('EXDEV'), { code: 'EXDEV' }))
    vi.spyOn(fsp, 'copyFile').mockImplementation(async (_a, b) => fs.writeFileSync(b as string, 'the real gamX'))
    await expect(moveFile(from, to)).rejects.toThrow('did not verify')
    expect(fs.readFileSync(from, 'utf8')).toBe('the real game')
    expect(fs.existsSync(to)).toBe(false)
    fs.rmSync(d, { recursive: true, force: true })
  })
})

describe('#09 #10 moving the files of one game together', () => {
  afterEach(() => vi.restoreAllMocks())
  const setup = () => {
    const d = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'group-'))
    fs.mkdirSync(path.join(d, 'src'))
    fs.mkdirSync(path.join(d, 'dst'))
    for (const [n, t] of [['Game.cue', 'cue'], ['Track 1.bin', 'mine 1'], ['Track 2.bin', 'mine 2']]) fs.writeFileSync(path.join(d, 'src', n), t)
    const items = ['Track 1.bin', 'Track 2.bin', 'Game.cue'].map((n) => ({ from: path.join(d, 'src', n), to: path.join(d, 'dst', n) }))
    return { d, items }
  }

  it('a different track with the same name already there: nothing moves', async () => {
    const { d, items } = setup()
    fs.writeFileSync(path.join(d, 'dst', 'Track 2.bin'), 'another game')
    await expect(moveGroup(items)).rejects.toThrow(/different file named Track 2.bin/)
    expect(fs.readdirSync(path.join(d, 'src')).sort()).toEqual(['Game.cue', 'Track 1.bin', 'Track 2.bin'])
    expect(fs.readFileSync(path.join(d, 'dst', 'Track 2.bin'), 'utf8')).toBe('another game')
  })

  it('the very same file already there is fine', async () => {
    const { d, items } = setup()
    fs.writeFileSync(path.join(d, 'dst', 'Track 1.bin'), 'mine 1')
    const r = await moveGroup(items)
    expect(r.alreadyThere).toEqual([path.join(d, 'dst', 'Track 1.bin')])
    expect(fs.readFileSync(path.join(d, 'dst', 'Game.cue'), 'utf8')).toBe('cue')
  })

  it('a move failing half-way puts the moved files back', async () => {
    const { d, items } = setup()
    const real = fsp.rename.bind(fsp)
    vi.spyOn(fsp, 'rename').mockImplementation(async (a, b) => {
      if (String(a).endsWith('Game.cue')) throw Object.assign(new Error('ENOENT: gone'), { code: 'ENOENT' })
      return real(a, b)
    })
    await expect(moveGroup(items)).rejects.toThrow()
    vi.restoreAllMocks()
    expect(fs.readdirSync(path.join(d, 'src')).sort()).toEqual(['Game.cue', 'Track 1.bin', 'Track 2.bin'])
    expect(fs.readdirSync(path.join(d, 'dst'))).toEqual([])
  })
})
