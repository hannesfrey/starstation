import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => path.resolve(__dirname, '..', '..') } }))
const { splitAnswer } = await import('../../src/main/padhelper')

/** #26: every request to the pad helper has its own number; a late answer can't confirm another request. */
describe('pad helper answers', () => {
  it('numbered answers are matched by number', () => {
    expect(splitAnswer('#12 ok close')).toEqual({ id: 12, line: 'ok close' })
    expect(splitAnswer('#3 bt [{"address":"A"}]')).toEqual({ id: 3, line: 'bt [{"address":"A"}]' })
  })
  it('lines the helper sends by itself have no number', () => {
    expect(splitAnswer('home xinput:0')).toEqual({ id: null, line: 'home xinput:0' })
    expect(splitAnswer('xpads 0:1,2,3,4,5,6,7')).toEqual({ id: null, line: 'xpads 0:1,2,3,4,5,6,7' })
  })

  const exe = path.resolve(__dirname, '..', '..', 'resources', 'bin', 'padhelper.exe')
  it.skipIf(!fs.existsSync(exe))('the real helper answers with the request number', () => {
    const out = execFileSync(exe, [], { input: '#41 fg\n#42 nosuch\nquit\n', encoding: 'utf8', timeout: 15_000 })
    expect(out).toMatch(/^#41 fg \d+$/m)
    expect(out).toMatch(/^#42 err nosuch unknown$/m)
  })
})
