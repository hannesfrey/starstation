import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { launchApp, makeFiles, makePresets, writeSettings } from './helpers'

/** SPEC-v2 E: Nexus Mods links, community patch collections, mods that are installed by hand. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

const TAR = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
const PATCH_TARGET = { mods: { targets: [{ id: 'patches', label: 'Patch (.pnach)', dir: '{emu}/patches', match: '\\.pnach$', flatten: true }] } }

test('Nexus Mods: link → which game? → downloaded with the API key and installed', async () => {
  const files = makeFiles('nexus')
  const emu = path.join(files, '_fakeemu')
  const presets = makePresets(files, 300, { extra: PATCH_TARGET })
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Okami.tst'), 'o')
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Zelda.tst'), 'z')
  fs.writeFileSync(path.join(files, 'config', 'secrets.json'), JSON.stringify({ nexus: { apiKey: 'nexus-key' } }))
  // the mod: a zip with a .pnach
  const src = path.join(files, '_zip', 'Okami HD')
  fs.mkdirSync(src, { recursive: true })
  fs.writeFileSync(path.join(src, 'okami60.pnach'), 'patch=60fps')
  const zip = path.join(files, '_zip', 'okami.zip')
  execFileSync(TAR, ['-a', '-cf', zip, '-C', path.join(files, '_zip'), 'Okami HD'])
  const seen: { url: string; key?: string }[] = []
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    seen.push({ url: u.pathname + u.search, key: req.headers.apikey as string | undefined })
    const json = (o: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o))
    if (u.pathname === '/v1/games/okami/mods/12.json') return json({ name: 'Okami 60 FPS', summary: 'Runs at <b>60</b> fps.' })
    if (u.pathname === '/v1/games/okami.json') return json({ name: 'Okami' })
    if (u.pathname === '/v1/games/okami/mods/12/files.json') return json({ files: [{ file_id: 34, file_name: 'okami.zip' }] })
    if (u.pathname === '/v1/games/okami/mods/12/files/34/download_link.json') return json([{ URI: `${base}/cdn/okami.zip` }])
    if (u.pathname === '/cdn/okami.zip') return res.writeHead(200).end(fs.readFileSync(zip))
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.STARSTATION_NEXUS_API = `${base}/v1`
  const { app, page } = await launchApp(files, presets)
  delete process.env.STARSTATION_NEXUS_API
  try {
    await expect.poll(async () => (await api<{ library: { games: unknown[] } }>(page, 'getState')).library.games.length, { timeout: 10_000 }).toBe(2)
    await api(page, 'nxmOpen', 'nxm://okami/mods/12/files/34?key=abc&expires=999&user_id=1')
    await expect(page.getByTestId('panel-nexus')).toBeVisible()
    await expect(page.getByTestId('panel-nexus')).toContainText('Okami 60 FPS')
    await expect(page.getByTestId('panel-nexus')).toContainText('Runs at 60 fps.')
    // the game with the closest name is first
    const first = page.getByTestId('panel-nexus').locator('[data-testid^="pitem-nx-"]').first()
    await expect(first).toContainText('Okami')
    await first.dblclick()
    await expect(page.getByTestId('notices')).toContainText('Mod installed')
    const v = await api<{ mods: { name: string; source: string }[] }>(page, 'mods', 'testcon:okami.tst')
    expect(v.mods).toEqual([expect.objectContaining({ name: 'Okami 60 FPS', source: 'nexus' })])
    // asked with the user's own key, and the link's key/expires were passed on
    expect(seen.find((s) => s.url.includes('download_link'))).toEqual({ url: '/v1/games/okami/mods/12/files/34/download_link.json?key=abc&expires=999', key: 'nexus-key' })
    expect(fs.readdirSync(path.join(files, 'config', 'downloads')).filter((n) => n.endsWith('.zip'))).toEqual([]) // download cleaned up
    void emu
  } finally {
    await app.close()
    server.close()
  }
})

test('Update patches: PCSX2 + RPCS3 collections, each checked against its published hash', async () => {
  const files = makeFiles('patchsets')
  writeSettings(files, { bootAnimation: false })
  // installed PCSX2 + RPCS3 (just their programs)
  for (const [d, exe] of [
    ['pcsx2', 'pcsx2-qt.exe'],
    ['rpcs3', 'rpcs3.exe']
  ]) {
    fs.mkdirSync(path.join(files, 'emulators', d), { recursive: true })
    fs.writeFileSync(path.join(files, 'emulators', d, exe), 'MZ')
  }
  const zip = Buffer.from('PK fake patches.zip')
  const yml = 'Version: 1.2\n'
  let badHash = false
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    const json = (o: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o))
    if (u.pathname === '/gh/repos/PCSX2/pcsx2_patches/releases/latest')
      return json({ assets: [{ name: 'patches.zip', browser_download_url: `${base}/dl/patches.zip`, digest: `sha256:${crypto.createHash('sha256').update(zip).digest('hex')}` }] })
    if (u.pathname === '/dl/patches.zip') return res.writeHead(200).end(badHash ? Buffer.from('tampered') : zip)
    if (u.pathname === '/rpcs3') return json({ return_code: 0, sha256: crypto.createHash('sha256').update(yml).digest('hex'), patch: yml })
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.STARSTATION_GITHUB_API = `${base}/gh`
  process.env.STARSTATION_RPCS3_PATCH = `${base}/rpcs3`
  const { app, page } = await launchApp(files)
  delete process.env.STARSTATION_GITHUB_API
  delete process.env.STARSTATION_RPCS3_PATCH
  try {
    const r = await api<{ done: string[]; errors: string[] }>(page, 'updatePatches')
    expect(r.errors).toEqual([])
    expect(fs.readFileSync(path.join(files, 'emulators', 'pcsx2', 'resources', 'patches.zip'))).toEqual(zip)
    expect(fs.readFileSync(path.join(files, 'emulators', 'rpcs3', 'patches', 'patch.yml'), 'utf8')).toBe(yml)
    // a download that doesn't match its hash is not used
    badHash = true
    const r2 = await api<{ errors: string[] }>(page, 'updatePatches')
    expect(r2.errors.join()).toContain('published hash')
    expect(fs.readFileSync(path.join(files, 'emulators', 'pcsx2', 'resources', 'patches.zip'))).toEqual(zip)
  } finally {
    await app.close()
    server.close()
  }
})

test('a mod Starstation can’t place: kept, its instructions shown, can’t be switched on', async () => {
  const files = makeFiles('manualmod')
  const presets = makePresets(files, 300) // the test console has no mod targets at all
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Alpha.tst'), 'a')
  const src = path.join(files, '_zip', 'Weird Mod')
  fs.mkdirSync(src, { recursive: true })
  fs.writeFileSync(path.join(src, 'README.txt'), '# Weird Mod\r\nCopy data.bin into the emulator folder.\r\nThen restart.')
  fs.writeFileSync(path.join(src, 'data.bin'), 'x')
  const zip = path.join(files, '_zip', 'weird.zip')
  execFileSync(TAR, ['-a', '-cf', zip, '-C', path.join(files, '_zip'), 'Weird Mod'])
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    const r = await api<{ ok: boolean; mod: { id: string; target: string; manual?: { lines: string[] } } }>(page, 'modAdd', 'testcon:alpha.tst', zip)
    expect(r.ok).toBe(true)
    expect(r.mod.target).toBe('Install by hand')
    expect(r.mod.manual!.lines).toEqual(['Weird Mod', 'Copy data.bin into the emulator folder.', 'Then restart.'])
    const t = await api<{ ok: boolean; error?: string }>(page, 'modToggle', 'testcon:alpha.tst', r.mod.id, true)
    expect(t.ok).toBe(false)
    expect(t.error).toContain('by hand')
    expect(fs.existsSync(path.join(files, 'mods', 'testcon', 'Alpha', r.mod.id, 'Weird Mod', 'data.bin'))).toBe(true)
    // in the menu: Mods → the mod → its instructions
    await page.keyboard.press(' ')
    await page.getByTestId('pitem-mods').dblclick()
    await expect(page.getByTestId(`pitem-mod-${r.mod.id}`)).toContainText('by hand')
    await page.getByTestId(`pitem-mod-${r.mod.id}`).dblclick()
    await expect(page.getByTestId('panel-mod-manual')).toContainText('Copy data.bin into the emulator folder.')
    await expect(page.getByTestId('panel-mod-manual')).toContainText('Open the mod’s files')
  } finally {
    await app.close()
  }
})
