import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { launchApp, makeFiles, writeSettings } from './helpers'

/** SPEC-v2 C + D: manual and gameplay clip from ScreenScraper; the manual opens page by page. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

/** A real two-page PDF (with a correct cross-reference table). */
function twoPagePdf(): Buffer {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 5 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 5 0 R >>',
    '<< /Length 23 >>\nstream\n0 0 1 rg 20 20 100 100 re f\nendstream'
  ]
  let out = '%PDF-1.4\n'
  const at: number[] = []
  objs.forEach((o, i) => {
    at.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

test('ScreenScraper manual + clip: downloaded with the artwork, the manual opens page by page', async () => {
  const files = makeFiles('manual')

  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'nes'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'nes', 'Booklet Game.nes'), 'b')
  fs.writeFileSync(path.join(files, 'config', 'secrets.json'), JSON.stringify({ screenscraper: { devid: 'dev', devpassword: 'pw', username: '', password: '' } }))
  const pdf = twoPagePdf()
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(64)])
  let asked = 0
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    if (u.pathname === '/ss/jeuInfos.php') {
      asked++
      return res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({ response: { jeu: { medias: [{ type: 'manuel', region: 'us', url: `${base}/files/manual.pdf` }, { type: 'video-normalized', region: 'wor', url: `${base}/files/clip.mp4` }] } } })
      )
    }
    if (u.pathname === '/files/manual.pdf') return res.writeHead(200).end(pdf)
    if (u.pathname === '/files/clip.mp4') return res.writeHead(200).end(mp4)
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.STARSTATION_SCREENSCRAPER_BASE = `${base}/ss`
  process.env.STARSTATION_ARTWORK_BASE = `${base}/none` // libretro: nothing there
  const { app, page } = await launchApp(files)
  delete process.env.STARSTATION_SCREENSCRAPER_BASE
  delete process.env.STARSTATION_ARTWORK_BASE
  try {
    type G = { id: string; manual?: string; video?: string }
    const game = async () => (await api<{ library: { games: G[] } }>(page, 'getState')).library.games[0]
    await expect.poll(async () => (await game())?.manual ?? '', { timeout: 15_000 }).toContain('manual.pdf')
    expect((await game()).video).toContain('video.mp4')
    expect(asked).toBe(1) // one lookup for pictures, manual and clip together

    // Triangle → Manual → page 1 of 2 → → page 2 → ○ closes
    await page.keyboard.press(' ')
    await page.getByTestId('pitem-manual').dblclick()
    await expect(page.getByTestId('manual')).toBeVisible()
    await expect(page.getByTestId('manual-page')).toHaveText('Page 1 / 2', { timeout: 10_000 })
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('manual-page')).toHaveText('Page 2 / 2')
    await page.keyboard.press('ArrowRight') // no page 3
    await expect(page.getByTestId('manual-page')).toHaveText('Page 2 / 2')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('manual')).toHaveCount(0)
  } finally {
    await app.close()
    server.close()
  }
})
