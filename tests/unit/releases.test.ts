import { describe, expect, it } from 'vitest'
import { compareVersions } from '../../src/shared/semver'
import { pickRelease } from '../../src/main/formats/releases'
import { whatsNewFor } from '../../src/shared/whatsnew'

describe('compareVersions', () => {
  it('orders versions like semver', () => {
    expect(compareVersions('1.9.0', '1.10.0')).toBeLessThan(0)
    expect(compareVersions('2.0.0', '1.99.9')).toBeGreaterThan(0)
    expect(compareVersions('v1.9.1', '1.9.1')).toBe(0)
    expect(compareVersions('2.0.0-beta.2', '2.0.0')).toBeLessThan(0)
    expect(compareVersions('2.0.0-beta.10', '2.0.0-beta.9')).toBeGreaterThan(0)
  })
})

describe('pickRelease', () => {
  const list = [
    { tag_name: 'v2.0.0', prerelease: true, draft: false }, // beta: only the tester PC
    { tag_name: 'v1.9.5', prerelease: false, draft: false }, // released to everyone
    { tag_name: 'v1.9.6', prerelease: false, draft: true }, // never: drafts
    { tag_name: 'v1.9.0', prerelease: false, draft: false }
  ]
  it('everyone gets the newest normal release, the tester PC gets betas too', () => {
    expect(pickRelease(list, '1.9.0', false)).toBe('1.9.5')
    expect(pickRelease(list, '1.9.0', true)).toBe('2.0.0')
    expect(pickRelease(list, '1.0.0', false)).toBe('1.9.5') // v1 PCs update straight to the released version
  })
  it('stays when nothing is newer', () => {
    expect(pickRelease(list, '1.9.5', false)).toBeNull()
    expect(pickRelease(list, '2.0.0', true)).toBeNull()
  })
  it('a version skipped after going back is not offered again, a newer one is', () => {
    expect(pickRelease(list, '1.9.0', true, '2.0.0')).toBeNull()
    expect(pickRelease([...list, { tag_name: 'v2.0.1', prerelease: true, draft: false }], '1.9.0', true, '2.0.0')).toBe('2.0.1')
  })
})

describe("What's new", () => {
  it('finds the entry for a version, or the newest older one', () => {
    expect(whatsNewFor('1.9.0', compareVersions)?.version).toBe('1.9.0')
    expect(whatsNewFor('1.9.3', compareVersions)?.version).toBe('1.9.0')
    expect(whatsNewFor('1.0.0', compareVersions)).toBeNull()
  })
})

describe('release script (#38, #39)', () => {
  it('runs every test before it builds, and never replaces the files of a version released to everyone', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const s = fs.readFileSync(path.resolve(__dirname, '..', '..', 'scripts', 'release.mjs'), 'utf8')
    const at = (needle: string) => {
      const i = s.indexOf(needle)
      expect(i, needle).toBeGreaterThan(-1)
      return i
    }
    const builder = at("run('npx', ['electron-builder'")
    for (const t of ["run('npx', ['tsc'", "run('npx', ['vitest', 'run'])", "run('npx', ['playwright', 'test'])"]) expect(at(t)).toBeLessThan(builder)
    expect(at('!existing.isPrerelease')).toBeLessThan(at("run('npx', ['tsc'"))
    expect(s).toMatch(/if \(existing\) execFileSync\(gh, \['release', 'upload'.*--clobber/)
  })
})
