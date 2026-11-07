import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { launchApp, makeFiles, writeSettings } from './helpers'

/** After 1.0.0: Xbox 360 covers by title ID, missing artwork looked for at every start, your own cover/background. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

// tiny PNG with a wrong checksum: browsers show it, Electron's image reader refuses it
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cf000000040001f0f7ea140000000049454e44ae426082', 'hex')

/** A correct grey PNG of the given size. */
function realPng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // 8 bits
  ihdr[9] = 0 // greyscale
  const rows = Buffer.alloc((w + 1) * h, 0x80)
  for (let y = 0; y < h; y++) rows[y * (w + 1)] = 0 // no filter
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}
const pngWidth = (file: string) => fs.readFileSync(file).readUInt32BE(16)

/** Xbox 360 disc image (plain xiso layout) whose default.xex has title ID 41560817. */
function x360Iso(): Buffer {
  const S = 2048
  const img = Buffer.alloc(36 * S)
  img.write('MICROSOFT*XBOX*MEDIA', 32 * S, 'latin1')
  img.writeUInt32LE(33, 32 * S + 20)
  img.writeUInt32LE(S, 32 * S + 24)
  const dir = 33 * S
  img.fill(0xff, dir, dir + S)
  img.writeUInt32LE(0, dir) // no left / right neighbours in the folder tree
  img.writeUInt32LE(34, dir + 4)
  img.writeUInt32LE(0x200, dir + 8)
  img[dir + 12] = 0x20
  img[dir + 13] = 11
  img.write('default.xex', dir + 14, 'latin1')
  const x = 34 * S
  img.write('XEX2', x, 'latin1')
  img.writeUInt32BE(1, x + 0x14)
  img.writeUInt32BE(0x00040006, x + 0x18)
  img.writeUInt32BE(0x100, x + 0x1c)
  img.writeUInt32BE(0x41560817, x + 0x100 + 12)
  return img
}

type Lib = { library: { games: { id: string; title: string; console: string; icon?: string; background?: string; customArt?: boolean; serial?: string }[] } }

test('Xbox 360 covers from the title ID, missing artwork retried at start, own cover and background', async () => {
  test.setTimeout(90_000)
  const files = makeFiles('artwork')
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'nes'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'nes', 'Gamma.nes'), 'rom')
  fs.mkdirSync(path.join(files, 'games', 'xbox360'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'xbox360', 'Some Shooter (USA).iso'), x360Iso())
  const ownCover = path.join(files, 'my cover.png')
  fs.writeFileSync(ownCover, realPng(2000, 8)) // wider than 1024: saved smaller
  const oddCover = path.join(files, 'odd cover.png')
  fs.writeFileSync(oddCover, PNG)
  fs.writeFileSync(path.join(files, 'not a picture.png'), 'text')

  let gammaHasArt = false
  const asked: string[] = []
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url ?? '')
    asked.push(u)
    const ok =
      u === '/xbox/66acd000-77fe-1000-9115-d80241560817/1033/boxartlg.jpg' ||
      u === '/xbox/66acd000-77fe-1000-9115-d80241560817/1033/background.jpg' ||
      (gammaHasArt && u.startsWith('/libretro/Nintendo - Nintendo Entertainment System/') && u.includes('/Gamma'))
    if (ok) res.writeHead(200, { 'content-type': 'image/png' }).end(PNG)
    else res.writeHead(404).end('not found')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.STARSTATION_ARTWORK_BASE = `${base}/libretro`
  process.env.STARSTATION_XBOX_ART_BASE = `${base}/xbox`
  const find = async (page: Page, title: string) => (await api<Lib>(page, 'getState')).library.games.find((g) => g.title === title)

  let { app, page } = await launchApp(files)
  try {
    // ---- Xbox 360: title ID read from default.xex on the disc, cover + background from the Xbox image server
    await expect.poll(async () => (await find(page, 'Some Shooter'))?.icon ?? '', { timeout: 15_000 }).toContain(path.join('media', 'artwork', 'xbox360', '41560817', 'icon.png'))
    const shooter = (await find(page, 'Some Shooter'))!
    expect(shooter.serial).toBe('41560817')
    expect(shooter.background).toContain('background.png')

    // ---- nothing found for Gamma yet: noted
    await expect.poll(() => fs.existsSync(path.join(files, 'media', 'artwork', 'nes', 'Gamma', 'tried.json')), { timeout: 15_000 }).toBe(true)
    expect((await find(page, 'Gamma'))?.icon).toBeUndefined()

    // ---- own cover: shown instead of the found one, "Use found artwork again" brings that back
    const bad = await api<{ ok: boolean; error?: string }>(page, 'customArt', shooter.id, 'icon', path.join(files, 'not a picture.png'))
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('PNG or JPG')
    expect(await api<{ ok: boolean }>(page, 'customArt', shooter.id, 'icon', ownCover)).toEqual({ ok: true })
    let s = (await find(page, 'Some Shooter'))!
    expect(path.basename(s.icon ?? '')).toMatch(/^custom-icon-\d+\.png$/)
    expect(pngWidth(s.icon!)).toBe(1024)
    expect(s.background).toContain('background.png') // background untouched
    expect(s.customArt).toBe(true)
    expect((await api<{ ok: boolean }>(page, 'customArt', shooter.id, 'background', oddCover)).ok).toBe(true)
    expect(path.basename((await find(page, 'Some Shooter'))!.background ?? '')).toMatch(/^custom-background-\d+\.png$/)
    expect((await api<{ ok: boolean }>(page, 'customArt', shooter.id, 'reset')).ok).toBe(true)
    s = (await find(page, 'Some Shooter'))!
    expect(s.icon).toContain(path.join('41560817', 'icon.png'))
    expect(s.background).toContain(path.join('41560817', 'background.png'))
    expect(s.customArt).toBeUndefined()

    // own cover for a game without any artwork, then it survives a restart
    const gamma = (await find(page, 'Gamma'))!
    expect((await api<{ ok: boolean }>(page, 'customArt', gamma.id, 'background', ownCover)).ok).toBe(true)
  } finally {
    await app.close()
  }

  // ---- next start: Gamma is looked for again even though nothing was found an hour ago
  gammaHasArt = true
  asked.length = 0
  ;({ app, page } = await launchApp(files))
  try {
    await expect.poll(async () => (await find(page, 'Gamma'))?.icon ?? '', { timeout: 15_000 }).toContain(path.join('media', 'artwork', 'nes', 'Gamma', 'icon.png'))
    const g = (await find(page, 'Gamma'))!
    expect(path.basename(g.background ?? '')).toMatch(/^custom-background-\d+\.png$/) // own pick still wins
    expect(fs.existsSync(path.join(files, 'media', 'artwork', 'nes', 'Gamma', 'tried.json'))).toBe(false)
    // games that already have everything are not asked for again
    expect(asked.some((u) => u.includes('41560817'))).toBe(false)
  } finally {
    await app.close()
    server.close()
    delete process.env.STARSTATION_ARTWORK_BASE
    delete process.env.STARSTATION_XBOX_ART_BASE
  }
})

/** Minimal PARAM.SFO with TITLE_ID and TITLE. */
function sfo(entries: Record<string, string>): Buffer {
  const keys = Object.keys(entries)
  const keyTable = Buffer.concat(keys.map((k) => Buffer.from(k + '\0', 'utf8')))
  const datas = keys.map((k) => Buffer.from(entries[k] + '\0', 'utf8'))
  const head = Buffer.alloc(20 + keys.length * 16)
  head.writeUInt32LE(0x46535000, 0)
  head.writeUInt32LE(0x101, 4)
  head.writeUInt32LE(head.length, 8)
  head.writeUInt32LE(head.length + keyTable.length, 12)
  head.writeUInt32LE(keys.length, 16)
  let ko = 0
  let dof = 0
  keys.forEach((k, i) => {
    const e = 20 + i * 16
    head.writeUInt16LE(ko, e)
    head.writeUInt16LE(0x0204, e + 2)
    head.writeUInt32LE(datas[i].length, e + 4)
    head.writeUInt32LE(datas[i].length, e + 8)
    head.writeUInt32LE(dof, e + 12)
    ko += k.length + 1
    dof += datas[i].length
  })
  return Buffer.concat([head, keyTable, ...datas])
}

test('PS3: the box cover from GameTDB replaces the disc banner; the disc background stays', async () => {
  test.setTimeout(60_000)
  const files = makeFiles('artwork-ps3')
  writeSettings(files, { bootAnimation: false })
  const disc = path.join(files, 'games', 'ps3', 'Racing Game (USA)', 'PS3_GAME')
  fs.mkdirSync(path.join(disc, 'USRDIR'), { recursive: true })
  fs.writeFileSync(path.join(disc, 'PARAM.SFO'), sfo({ TITLE_ID: 'BLUS30443', TITLE: 'Racing Game', CATEGORY: 'DG' }))
  fs.writeFileSync(path.join(disc, 'USRDIR', 'EBOOT.BIN'), 'eboot')
  fs.writeFileSync(path.join(disc, 'ICON0.PNG'), PNG)
  fs.writeFileSync(path.join(disc, 'PIC1.PNG'), PNG)
  const asked: string[] = []
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url ?? '')
    asked.push(u)
    // only the medium size exists for this game: the big one is tried first
    if (u === '/gametdb/ps3/coverM/US/BLUS30443.jpg') res.writeHead(200).end(PNG)
    else res.writeHead(404).end('not found')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.STARSTATION_ARTWORK_BASE = `${base}/libretro`
  process.env.STARSTATION_GAMETDB_BASE = `${base}/gametdb`
  const { app, page } = await launchApp(files)
  try {
    const find = async () => (await api<Lib>(page, 'getState')).library.games.find((g) => g.title === 'Racing Game')
    await expect.poll(async () => (await find())?.icon ?? '', { timeout: 15_000 }).toContain(path.join('media', 'artwork', 'ps3', 'BLUS30443', 'icon.png'))
    expect((await find())!.background).toBe(path.join(disc, 'PIC1.PNG'))
    expect(asked.indexOf('/gametdb/ps3/coverHQ/US/BLUS30443.jpg')).toBeLessThan(asked.indexOf('/gametdb/ps3/coverM/US/BLUS30443.jpg'))
  } finally {
    await app.close()
    server.close()
    delete process.env.STARSTATION_ARTWORK_BASE
    delete process.env.STARSTATION_GAMETDB_BASE
  }
})
