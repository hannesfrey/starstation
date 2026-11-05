import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { launchApp, makeFiles, writeSettings } from './helpers'

/** Step 9: libretro artwork in the background, Refresh artwork, Photo column + viewer. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

// smallest valid PNG (1×1)
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cf000000040001f0f7ea140000000049454e44ae426082', 'hex')

test('artwork is fetched from libretro thumbnails; Photo column shows screenshots', async () => {
  const files = makeFiles('media')
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'nes'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'nes', 'Alpha Quest (USA).nes'), 'rom')
  fs.writeFileSync(path.join(files, 'games', 'nes', 'Beta.nes'), 'rom')
  const shotDir = path.join(files, 'media', 'screenshots', 'ps2')
  fs.mkdirSync(shotDir, { recursive: true })
  fs.writeFileSync(path.join(shotDir, 'Older Game_SLES-11111_20260101120000.png'), PNG)
  fs.writeFileSync(path.join(shotDir, 'Newer Game_SLES-22222_20260201120000.png'), PNG)
  fs.utimesSync(path.join(shotDir, 'Older Game_SLES-11111_20260101120000.png'), new Date('2026-01-01'), new Date('2026-01-01'))

  const asked: string[] = []
  let betaHasArt = false
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url ?? '')
    asked.push(u)
    const ok =
      u === '/Nintendo - Nintendo Entertainment System/Named_Boxarts/Alpha Quest (USA).png' ||
      u === '/Nintendo - Nintendo Entertainment System/Named_Snaps/Alpha Quest (USA).png' ||
      (betaHasArt && u === '/Nintendo - Nintendo Entertainment System/Named_Boxarts/Beta (USA).png')
    if (ok) res.writeHead(200, { 'content-type': 'image/png' }).end(PNG)
    else res.writeHead(404).end('not found')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  process.env.STARSTATION_ARTWORK_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const { app, page } = await launchApp(files)
  delete process.env.STARSTATION_ARTWORK_BASE
  type Lib = { library: { games: { id: string; title: string; icon?: string; background?: string }[] } }
  try {
    // box art + screenshot arrive in the background and show up in the menu
    await expect
      .poll(async () => (await api<Lib>(page, 'getState')).library.games.find((g) => g.title === 'Alpha Quest')?.icon ?? '', { timeout: 15_000 })
      .toContain(path.join('media', 'artwork', 'nes', 'Alpha_Quest', 'icon.png'))
    const alpha = (await api<Lib>(page, 'getState')).library.games.find((g) => g.title === 'Alpha Quest')!
    expect(alpha.background).toContain('background.png')
    await expect(page.locator('[data-testid="item-nes:alpha quest (usa).nes"] img')).toBeVisible()

    // nothing found for Beta: remembered, not asked again on every start
    const beta = (await api<Lib>(page, 'getState')).library.games.find((g) => g.title === 'Beta')!
    await expect.poll(() => fs.existsSync(path.join(files, 'media', 'artwork', 'nes', 'Beta', 'tried.json'))).toBe(true)
    expect(asked).toContain('/Nintendo - Nintendo Entertainment System/Named_Boxarts/Beta (USA).png')
    // Refresh artwork tries again right away
    betaHasArt = true
    expect(await api<boolean>(page, 'refreshArtwork', beta.id)).toBe(true)
    expect((await api<Lib>(page, 'getState')).library.games.find((g) => g.id === beta.id)?.icon).toContain('icon.png')

    // ---- Photo column: newest first, names cleaned up, viewer browses with ← →
    const shots = await api<{ title: string; consoleName: string }[]>(page, 'screenshots')
    expect(shots.map((s) => s.title)).toEqual(['Newer Game', 'Older Game'])
    expect(shots[0].consoleName).toBe('PS2')
    await page.getByTestId('cat-photo').dispatchEvent('click')
    const items = page.getByTestId('items')
    await expect(items.getByText('Newer Game')).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('photo-viewer')).toContainText('Newer Game')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('photo-viewer')).toContainText('Older Game')
    await expect(page.getByTestId('photo-viewer')).toContainText('2 / 2')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('photo-viewer')).toHaveCount(0)
  } finally {
    await app.close()
    server.close()
  }
})
