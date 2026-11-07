import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { launchApp, makeFiles, makePresets, writeSettings } from './helpers'

/**
 * PS3 game updates (Hannes, 2026-11-07: Black Ops II 1.00 crashed; "shure" to updates from Sony's server).
 * A local server stands in for Sony's update list + packages, a small script for RPCS3's installer.
 */

// PARAM.SFO writer (plain JS: the stand-in installer uses the same code)
const SFO_JS = `module.exports = function sfo(f) {
  const keys = Object.keys(f)
  const keyTable = Buffer.concat(keys.map((k) => Buffer.from(k + '\\0', 'utf8')))
  const data = keys.map((k) => { const b = Buffer.from(f[k] + '\\0', 'utf8'); const max = Math.ceil(b.length / 4) * 4; return { b: Buffer.concat([b, Buffer.alloc(max - b.length)]), len: b.length, max } })
  const head = 20 + keys.length * 16
  const keyPad = Math.ceil(keyTable.length / 4) * 4
  const h = Buffer.alloc(head)
  h.writeUInt32LE(0x46535000, 0); h.writeUInt32LE(0x101, 4); h.writeUInt32LE(head, 8); h.writeUInt32LE(head + keyPad, 12); h.writeUInt32LE(keys.length, 16)
  let ko = 0, dof = 0
  keys.forEach((k, i) => { const e = 20 + i * 16; h.writeUInt16LE(ko, e); h.writeUInt16LE(0x0204, e + 2); h.writeUInt32LE(data[i].len, e + 4); h.writeUInt32LE(data[i].max, e + 8); h.writeUInt32LE(dof, e + 12); ko += Buffer.byteLength(k) + 1; dof += data[i].max })
  return Buffer.concat([h, keyTable, Buffer.alloc(keyPad - keyTable.length), ...data.map((d) => d.b)])
}
`
// "installs" a stand-in package: its first line names the version; writes the installed PARAM.SFO like RPCS3 would
const INSTALLER_JS = `const fs = require('fs'), path = require('path'), sfo = require('./sfo.js')
const [file, dest] = process.argv.slice(2)
const m = /^PKG ([A-Z]{4}\\d{5}) (\\d\\d\\.\\d\\d)/.exec(fs.readFileSync(file, 'latin1'))
fs.mkdirSync(dest, { recursive: true })
fs.writeFileSync(path.join(dest, 'PARAM.SFO'), sfo({ TITLE_ID: m[1], APP_VER: m[2], CATEGORY: 'GD', TITLE: 'x' }))
fs.appendFileSync(path.join(dest, 'installed.txt'), m[2] + '\\n')
`

/** A stand-in package: body + Sony-style footer (SHA-1 of the body, padded to 32 bytes). */
function fakePkg(serial: string, version: string): { bytes: Buffer; sha1: string } {
  const body = Buffer.from(`PKG ${serial} ${version}\n` + 'x'.repeat(20_000))
  const sha1 = crypto.createHash('sha1').update(body).digest('hex')
  return { bytes: Buffer.concat([body, Buffer.from(sha1, 'hex'), Buffer.alloc(12)]), sha1 }
}

const api = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

test('PS3 update: asked before playing, downloaded, checked, installed in order; a damaged one is refused', async () => {
  test.setTimeout(90_000)
  const files = makeFiles('ps3update')
  const presets = makePresets(files, 400)
  writeSettings(files, { bootAnimation: false })
  const emu = path.join(files, '_fakeemu')
  fs.writeFileSync(path.join(emu, 'sfo.js'), SFO_JS)
  fs.writeFileSync(path.join(emu, 'installer.js'), INSTALLER_JS)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sfo = require(path.join(emu, 'sfo.js')) as (f: Record<string, string>) => Buffer

  // the PS3 console runs on the fake emulator, without RPCS3's own setup steps
  const ps3File = path.join(presets, 'consoles', 'ps3.json')
  const ps3 = JSON.parse(fs.readFileSync(ps3File, 'utf8'))
  Object.assign(ps3, { emulator: 'fakeemu', launch: { args: ['{emu}/fake-emu.js', '{launch}'], insertAt: 1 }, config: [], controls: [], bios: undefined, graphics: undefined, shaderHint: false })
  fs.writeFileSync(ps3File, JSON.stringify(ps3))

  for (const [name, serial] of [['Update Test', 'BLTS00001'], ['Broken Update', 'BLTS00002']]) {
    const d = path.join(files, 'games', 'ps3', name, 'PS3_GAME')
    fs.mkdirSync(path.join(d, 'USRDIR'), { recursive: true })
    fs.writeFileSync(path.join(d, 'PARAM.SFO'), sfo({ TITLE_ID: serial, APP_VER: '01.00', CATEGORY: 'DG', TITLE: name }))
    fs.writeFileSync(path.join(d, 'USRDIR', 'EBOOT.BIN'), 'eboot')
  }

  // the update server: two updates for one game, one damaged update for the other
  const pkgs: Record<string, Buffer> = {}
  const hits: string[] = []
  const server = http.createServer((req, res) => {
    const url = req.url ?? ''
    const port = (server.address() as AddressInfo).port
    const entry = (serial: string, v: string, sha1Override?: string) => {
      const p = fakePkg(serial, v)
      const name = `${serial}-${v}.pkg`
      pkgs[name] = p.bytes
      return `<package version="${v}" size="${p.bytes.length}" sha1sum="${sha1Override ?? p.sha1}" url="http://127.0.0.1:${port}/pkg/${name}" ps3_system_ver="04.2000"/>`
    }
    if (url === '/np/BLTS00001/BLTS00001-ver.xml')
      return res.end(`<?xml version='1.0'?><titlepatch status="alive" titleid="BLTS00001"><tag name="T1">${entry('BLTS00001', '01.02')}${entry('BLTS00001', '01.01')}</tag></titlepatch>`)
    if (url === '/np/BLTS00002/BLTS00002-ver.xml')
      return res.end(`<?xml version='1.0'?><titlepatch status="alive" titleid="BLTS00002"><tag name="T1">${entry('BLTS00002', '01.05', '0'.repeat(40))}</tag></titlepatch>`)
    const m = /^\/pkg\/(.+)$/.exec(url)
    if (m && pkgs[m[1]]) {
      hits.push(m[1])
      res.setHeader('content-length', pkgs[m[1]].length)
      return res.end(pkgs[m[1]])
    }
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  process.env.STARSTATION_PS3UPDATE_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/np`
  process.env.STARSTATION_PS3UPDATE_INSTALLER = path.join(emu, 'installer.js')
  const { app, page } = await launchApp(files, presets)
  delete process.env.STARSTATION_PS3UPDATE_BASE
  delete process.env.STARSTATION_PS3UPDATE_INSTALLER
  const installed = (serial: string) => path.join(emu, 'dev_hdd0', 'game', serial, 'installed.txt')
  const launched = () => (fs.existsSync(path.join(emu, 'launched.json')) ? fs.readFileSync(path.join(emu, 'launched.json'), 'utf8') : '')
  try {
    // ✕ on the game: the update question comes first
    await expect(page.getByTestId('game-info')).toContainText('Broken Update')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('game-info')).toContainText('Update Test')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Update for Update Test')).toBeVisible()
    await expect(page.getByTestId('pitem-what')).toContainText('Version 01.02 is available. Yours is 01.00.')
    await expect(page.getByTestId('pitem-size')).toContainText('2 updates from PlayStation Network')

    // Play without updating: the game starts, nothing is downloaded
    await page.getByTestId('pitem-skip').dblclick()
    await expect.poll(launched).toContain('EBOOT.BIN')
    await expect(page.getByTestId('running')).toHaveCount(0, { timeout: 15_000 })
    expect(hits).toEqual([])
    fs.rmSync(path.join(emu, 'launched.json'))

    // again → Update now: both packages, oldest first, then the game starts by itself
    await page.keyboard.press('Enter')
    await expect(page.getByText('Update for Update Test')).toBeVisible()
    await page.getByTestId('pitem-go').dblclick()
    await expect.poll(() => (fs.existsSync(installed('BLTS00001')) ? fs.readFileSync(installed('BLTS00001'), 'utf8') : ''), { timeout: 20_000 }).toBe('01.01\n01.02\n')
    expect(hits).toEqual(['BLTS00001-01.01.pkg', 'BLTS00001-01.02.pkg'])
    await expect.poll(launched, { timeout: 15_000 }).toContain('EBOOT.BIN')
    await expect(page.getByTestId('notices')).toContainText('Update Test updated')
    await expect(page.getByTestId('running')).toHaveCount(0, { timeout: 15_000 })
    // the downloads are gone once installed; no more question
    expect(fs.readdirSync(path.join(files, 'config', 'cache', 'ps3-updates'))).toEqual([])
    expect(await api(page, 'ps3UpdateInfo', 'ps3:update test')).toBeNull()

    // a package that doesn't match Sony's checksum is never installed (tried twice)
    await page.keyboard.press('ArrowUp')
    await expect(page.getByTestId('game-info')).toContainText('Broken Update')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Update for Broken Update')).toBeVisible()
    await page.getByTestId('pitem-go').dblclick()
    await expect(page.getByTestId('notices')).toContainText('arrived damaged twice', { timeout: 20_000 })
    expect(hits.filter((h) => h.startsWith('BLTS00002'))).toHaveLength(2)
    expect(fs.existsSync(installed('BLTS00002'))).toBe(false)
    expect(fs.readdirSync(path.join(files, 'config', 'cache', 'ps3-updates'))).toEqual([])
  } finally {
    await app.close()
    server.close()
  }
})
