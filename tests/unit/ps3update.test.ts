import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { compareAppVer, isSonyPkgUrl, parseUpdateXml, pendingUpdates, pkgMatches } from '../../src/main/formats/ps3update'

// Sony's real answer for Black Ops II (2026-11-07), shortened to its two packages
const BO2 = `<?xml version='1.0' encoding='UTF-8'?>
<titlepatch status="alive" titleid="BLUS31011"><tag name="BLUS31011_T21" popup="true" signoff="true"><package version="01.09" size="280113184" sha1sum="a3557b87227c2c65193ecb2e9d637ed8da6e731e" url="http://b0.ww.np.dl.playstation.net/tppkg/np/BLUS31011/BLUS31011_T21/85cd35cf7915a1e3/UP0002-BLUS31011_00-CODBLOPS2PATCH06-A0109-V0100-PE.pkg" ps3_system_ver="04.2000"/><package version="01.19" size="186287840" sha1sum="0aad7f0a4777f6ce82a3687d8ebc0f8d37bff6a9" url="http://b0.ww.np.dl.playstation.net/tppkg/np/BLUS31011/BLUS31011_T21/85cd35cf7915a1e3/UP0002-BLUS31011_00-CODBLOPS2PATCH09-A0119-V0100-PE.pkg" ps3_system_ver="04.2000"><paramsfo><TITLE>Call of Duty®: Black Ops II (BLUS31011)</TITLE></paramsfo></package></tag></titlepatch>`

describe('PS3 game updates (Sony update list)', () => {
  it("reads Sony's list, oldest first", () => {
    const p = parseUpdateXml(BO2)
    expect(p.map((x) => x.version)).toEqual(['01.09', '01.19'])
    expect(p[1]).toMatchObject({ size: 186287840, sha1: '0aad7f0a4777f6ce82a3687d8ebc0f8d37bff6a9' })
    expect(parseUpdateXml('<titlepatch status="alive" titleid="X"/>')).toEqual([])
  })
  it('needs every update newer than the installed version, in order', () => {
    const p = parseUpdateXml(BO2)
    expect(pendingUpdates(p, '01.00').map((x) => x.version)).toEqual(['01.09', '01.19'])
    expect(pendingUpdates(p, '01.09').map((x) => x.version)).toEqual(['01.19'])
    expect(pendingUpdates(p, '01.19')).toEqual([])
    expect(compareAppVer('01.10', '01.09')).toBeGreaterThan(0)
    expect(compareAppVer('02.00', '01.22')).toBeGreaterThan(0)
  })
  it("only downloads from Sony's update hosts", () => {
    expect(isSonyPkgUrl(parseUpdateXml(BO2)[0].url)).toBe(true)
    expect(isSonyPkgUrl('http://b0.ww.np.dl.playstation.net.evil.example/x.pkg')).toBe(false)
    expect(isSonyPkgUrl('http://example.com/np.dl.playstation.net/x.pkg')).toBe(false)
    expect(isSonyPkgUrl('ftp://b0.ww.np.dl.playstation.net/x.pkg')).toBe(false)
    expect(isSonyPkgUrl('http://b0.ww.np.dl.playstation.net/x.exe')).toBe(false)
  })
  it('a package matches when size and the SHA-1 of all but its last 32 bytes agree (as in real packages)', async () => {
    const body = crypto.randomBytes(5000)
    const sha1 = crypto.createHash('sha1').update(body).digest('hex')
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-')), 'u.pkg')
    fs.writeFileSync(file, Buffer.concat([body, Buffer.from(sha1, 'hex'), Buffer.alloc(12)]))
    expect(await pkgMatches(file, { size: 5032, sha1 })).toBe(true)
    expect(await pkgMatches(file, { size: 5031, sha1 })).toBe(false)
    const bad = Buffer.from(body)
    bad[10] ^= 1
    fs.writeFileSync(file, Buffer.concat([bad, Buffer.from(sha1, 'hex'), Buffer.alloc(12)]))
    expect(await pkgMatches(file, { size: 5032, sha1 })).toBe(false)
    expect(await pkgMatches(file + '.missing', { size: 5032, sha1 })).toBe(false)
    fs.rmSync(path.dirname(file), { recursive: true })
  })
})
