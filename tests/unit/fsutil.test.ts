import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { renameRetry } from '../../src/main/fsutil'

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
