import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { launchApp, makeFiles, makePresets, writeSettings } from './helpers'

/** SPEC-v2 C: trophies, themes + TV mode, wallpapers, video previews, power menu. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

/** A small valid PNG (one grey row per line). */
function png(w: number, h: number): Buffer {
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
  ihdr[8] = 8
  const rows = Buffer.alloc((w + 1) * h, 0x60)
  for (let y = 0; y < h; y++) rows[y * (w + 1)] = 0
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

/** Long lists only draw the items near the selection: move down until it is there. */
async function scrollTo(page: Page, testId: string): Promise<void> {
  for (let i = 0; i < 30 && !(await page.getByTestId(testId).count()); i++) await page.keyboard.press('ArrowDown')
}

type Trophy = { id: string; name: string; tier: string; unlockedAt?: number; progress?: [number, number] }

test('trophies unlock as you play and mod; the Trophies column lists them', async () => {
  test.setTimeout(60_000)
  const files = makeFiles('trophies')
  const presets = makePresets(files, 300, { extra: { mods: { targets: [{ id: 'patches', label: 'Patch', dir: '{emu}/patches', match: '\\.pnach$', flatten: true }] } } })
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  for (const n of ['A', 'B', 'C']) fs.writeFileSync(path.join(files, 'games', 'testcon', `${n}.tst`), n)
  // 9 h 59 min already played: the next minute brings the 10-hour trophy
  fs.mkdirSync(path.join(files, 'config', 'library'), { recursive: true })
  fs.writeFileSync(path.join(files, 'config', 'library', 'stats.json'), JSON.stringify({ 'testcon:a.tst': { playTime: 10 * 3600 - 1, playCount: 1 }, 'testcon:b.tst': { playTime: 10, playCount: 1 } }))
  fs.writeFileSync(path.join(files, 'mod.pnach'), 'x')
  const { app, page } = await launchApp(files, presets)
  try {
    const get = async () => (await api<{ list: Trophy[] }>(page, 'trophies')).list
    await expect.poll(async () => (await get()).find((t) => t.id === 'console-testcon')?.progress, { timeout: 10_000 }).toEqual([2, 3])
    let list = await get()
    expect(list.find((t) => t.id === 'platinum')?.unlockedAt).toBeUndefined()

    // play the third game: 10 hours + "TEST explorer"
    expect((await api<{ ok: boolean }>(page, 'launch', 'testcon:c.tst')).ok).toBe(true)
    await expect.poll(async () => (await api<{ running: unknown }>(page, 'getState')).running, { timeout: 10_000 }).toBeNull()
    await expect.poll(async () => (await get()).find((t) => t.id === 'time-10')?.unlockedAt, { timeout: 10_000 }).toBeTruthy()
    list = await get()
    expect(list.find((t) => t.id === 'console-testcon')?.unlockedAt).toBeTruthy()
    await expect(page.getByTestId('notices')).toContainText('Trophy unlocked')

    // first mod → "Tinkerer"
    await api(page, 'modAdd', 'testcon:a.tst', path.join(files, 'mod.pnach'))
    await expect.poll(async () => (await get()).find((t) => t.id === 'first-mod')?.unlockedAt).toBeTruthy()

    // the column
    await page.getByTestId('cat-trophies').dispatchEvent('click')
    await expect(page.getByTestId('items')).toContainText('Starstation trophies')
    await expect(page.getByTestId('items')).toContainText(/3 of \d+ unlocked/)
  } finally {
    await app.close()
  }
})

test('themes, TV mode, wallpapers, video preview, power menu', async () => {
  test.setTimeout(60_000)
  const files = makeFiles('feel')
  const presets = makePresets(files, 300)
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Clip Game.tst'), 'c')
  // a clip next to its artwork (as ScreenScraper would have saved it)
  const art = path.join(files, 'media', 'artwork', 'testcon', 'Clip_Game')
  fs.mkdirSync(art, { recursive: true })
  fs.writeFileSync(path.join(art, 'video.mp4'), Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(32)]))
  fs.writeFileSync(path.join(files, 'wall.png'), png(64, 36))
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('game-info')).toContainText('Clip Game')
    // the clip starts after resting ~2 s on the game
    await expect(page.getByTestId('game-video')).toHaveCount(0)
    await expect(page.getByTestId('game-video')).toHaveCount(1, { timeout: 5000 })
    // switched off in Settings → Theme & display: no clip
    await page.getByTestId('cat-settings').dispatchEvent('click')
    await page.getByTestId('item-display-theme').dispatchEvent('click')
    await page.keyboard.press('Enter')
    await page.getByTestId('pitem-video').dblclick()
    await expect(page.getByTestId('pitem-video')).toContainText('Off')
    await page.keyboard.press('Escape')
    await page.getByTestId('cat-testcon').dispatchEvent('click')
    await page.waitForTimeout(2500)
    await expect(page.getByTestId('game-video')).toHaveCount(0)

    // theme + TV mode
    await api(page, 'setSetting', 'theme', 'starvis')
    expect((await api<{ settings: { theme: string } }>(page, 'getState')).settings.theme).toBe('starvis')
    await api(page, 'setSetting', 'tvMode', true)
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBe(1.25)
    await api(page, 'setSetting', 'tvMode', false)
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBe(1)

    // wallpaper for this console's column
    expect((await api<{ ok: boolean }>(page, 'setWallpaper', 'console:testcon', path.join(files, 'wall.png'))).ok).toBe(true)
    await expect(page.getByTestId('wallpaper')).toHaveCount(1)
    expect(fs.readdirSync(path.join(files, 'media', 'wallpapers'))).toHaveLength(1)
    // removed again: the picture file goes too
    await api(page, 'setWallpaper', 'console:testcon', null)
    await expect(page.getByTestId('wallpaper')).toHaveCount(0)
    expect(fs.readdirSync(path.join(files, 'media', 'wallpapers'))).toHaveLength(0)

    // power menu: in tests only written down, never done

    await api(page, 'power', 'sleep')
    expect(JSON.parse(fs.readFileSync(path.join(files, 'config', 'test-power.json'), 'utf8')).action).toBe('sleep')
  } finally {
    await app.close()
  }
})

test('accessibility: text size and moved menu buttons; system settings open with the controller', async () => {
  const files = makeFiles('access')
  writeSettings(files, { bootAnimation: false })
  const { app, page } = await launchApp(files)
  try {
    await expect(page.getByTestId('xmb')).toBeVisible()
    await page.getByTestId('cat-settings').dispatchEvent('click')
    await scrollTo(page, 'item-access')
    await page.getByTestId('item-access').dispatchEvent('click')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('panel-accessibility')).toBeVisible()
    // ✕ is "select" until moved: one press moves it to ○
    await expect(page.getByTestId('pitem-map-confirm')).toContainText('✕')
    await page.getByTestId('pitem-map-confirm').dblclick()
    await expect(page.getByTestId('pitem-map-confirm')).toContainText('○')
    await expect(page.getByTestId('pitem-map-back')).toContainText('✕') // swapped, nothing lost
    expect(JSON.parse((await api<{ settings: { buttonMap: string } }>(page, 'getState')).settings.buttonMap)).toEqual({ confirm: 1 })
    // text size
    await page.getByTestId('pitem-text').dblclick()
    await expect(page.locator('.app.text-large')).toHaveCount(1)
    // back to standard buttons
    await page.getByTestId('pitem-reset').dblclick()
    await expect(page.getByTestId('pitem-map-confirm')).toContainText('✕')
    await page.keyboard.press('Escape')
    // System: sound, screen, Bluetooth panels open (in hidden tests there is no helper: empty lists)
    await scrollTo(page, 'item-system')
    await page.getByTestId('item-system').dispatchEvent('click')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('panel-system')).toContainText('Bluetooth controllers')
    await page.getByTestId('pitem-sound').dblclick()
    await expect(page.getByTestId('panel-sound')).toContainText('No playback devices found')
  } finally {
    await app.close()
  }
})
