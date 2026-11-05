import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { launchApp, makeFiles, writeSettings } from './helpers'

/** SPEC-v2 D: compatibility labels for PS3 (RPCS3 list) and Xbox 360 (Xenia list); "Doesn't start" warns first. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

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

/** Xbox 360 disc image whose default.xex has title ID 4D5307E6. */
function x360Iso(): Buffer {
  const S = 2048
  const img = Buffer.alloc(36 * S)
  img.write('MICROSOFT*XBOX*MEDIA', 32 * S, 'latin1')
  img.writeUInt32LE(33, 32 * S + 20)
  img.writeUInt32LE(S, 32 * S + 24)
  const d = 33 * S
  img.fill(0xff, d, d + S)
  img.writeUInt32LE(0, d)
  img.writeUInt32LE(34, d + 4)
  img.writeUInt32LE(0x200, d + 8)
  img[d + 13] = 11
  img.write('default.xex', d + 14, 'latin1')
  const x = 34 * S
  img.write('XEX2', x, 'latin1')
  img.writeUInt32BE(1, x + 0x14)
  img.writeUInt32BE(0x00040006, x + 0x18)
  img.writeUInt32BE(0x100, x + 0x1c)
  img.writeUInt32BE(0x4d5307e6, x + 0x100 + 12)
  return img
}

test('compatibility labels from the RPCS3 and Xenia lists; a game that doesn’t start warns first', async () => {
  const files = makeFiles('compat')
  writeSettings(files, { bootAnimation: false })
  const ps3 = path.join(files, 'games', 'ps3', 'Good Game', 'PS3_GAME')
  fs.mkdirSync(path.join(ps3, 'USRDIR'), { recursive: true })
  fs.writeFileSync(path.join(ps3, 'PARAM.SFO'), sfo({ TITLE_ID: 'BLUS00001', TITLE: 'Good Game', CATEGORY: 'DG' }))
  fs.writeFileSync(path.join(ps3, 'USRDIR', 'EBOOT.BIN'), 'eboot')
  fs.mkdirSync(path.join(files, 'games', 'xbox360'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'xbox360', 'Broken Game.iso'), x360Iso())

  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    const json = (o: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o))
    if (u.pathname === '/rpcs3') return json({ return_code: 0, results: { [u.searchParams.get('g')!]: { title: 'Good Game', status: 'Playable', thread: 123 } } })
    if (u.pathname === '/search/issues')
      return json({ items: [{ title: '4D5307E6 - Broken Game', html_url: 'https://github.com/xenia-canary/game-compatibility/issues/1', labels: [{ name: 'state-nothing' }] }] })
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.STARSTATION_RPCS3_COMPAT = `${base}/rpcs3`
  process.env.STARSTATION_GITHUB_API = base
  const { app, page } = await launchApp(files)
  delete process.env.STARSTATION_RPCS3_COMPAT
  delete process.env.STARSTATION_GITHUB_API
  type G = { id: string; console: string; compat?: { label: string; source: string; status: string } }
  try {
    const find = async (c: string) => (await api<{ library: { games: G[] } }>(page, 'getState')).library.games.find((g) => g.console === c)
    await expect.poll(async () => (await find('ps3'))?.compat?.label, { timeout: 15_000 }).toBe('Runs well')
    await expect.poll(async () => (await find('xbox360'))?.compat?.label, { timeout: 15_000 }).toBe("Doesn't start")
    expect((await find('xbox360'))!.compat!.source).toBe('Xenia')
    // it stays in the list, and starting it asks first
    await page.getByTestId('cat-xbox360').dispatchEvent('click')
    await expect(page.getByTestId('items')).toContainText("Doesn't start")
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('panel-compat-warn')).toBeVisible()
    await expect(page.getByTestId('panel-compat-warn')).toContainText('Start anyway')
    // looked up once: the second start doesn't ask the lists again
    expect(fs.existsSync(path.join(files, 'config', 'library', 'compat.json'))).toBe(true)
  } finally {
    await app.close()
    server.close()
  }
})
