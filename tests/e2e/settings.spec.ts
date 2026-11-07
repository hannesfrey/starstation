import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { launchApp, makeFiles, makePresets, writeSettings, SOURCE } from './helpers'

/** Step 10: health check, diagnostics, RetroAchievements, netplay, Steam, custom consoles, settings screens. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>
const NODE = path.join(SOURCE, 'tools', 'node', 'node.exe')
/** Home → Settings column, then ↓ until the item is selected, then ✕. */
/** Settings entries that sit in a group folder (2.0.15). */
const GROUP: Record<string, string> = {
  'display-theme': 'look', graphics: 'look', access: 'look', display: 'look',
  library: 'games', emulators: 'games', storage: 'games', modsources: 'games', import: 'games',
  ra: 'online', netplay: 'online', steam: 'online', packages: 'online',
  health: 'help', diagnostics: 'help', safe: 'help'
}
async function selectAndEnter(page: Page, key: string): Promise<void> {
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowUp')
  for (let i = 0; i < 20; i++) {
    if (await page.locator(`[data-testid="item-${key}"].active`).count()) break
    await page.keyboard.press('ArrowDown')
  }
  if (!(await page.locator(`[data-testid="item-${key}"].active`).count())) throw new Error(`setting ${key} not found`)
  await page.keyboard.press('Enter')
}
async function openSetting(page: Page, key: string): Promise<void> {
  await page.keyboard.press('Home')
  if (GROUP[key]) await selectAndEnter(page, GROUP[key])
  await selectAndEnter(page, key)
}
const TAR = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')

/** Minimal binary VDF writer for a fake Steam shortcuts.vdf. */
function vdf(entries: Record<string, string>[]): Buffer {
  const parts: Buffer[] = [Buffer.from([0]), Buffer.from('shortcuts\0')]
  entries.forEach((e, i) => {
    parts.push(Buffer.from([0]), Buffer.from(`${i}\0`))
    for (const [k, v] of Object.entries(e)) parts.push(Buffer.from([1]), Buffer.from(`${k}\0${v}\0`))
    parts.push(Buffer.from([8]))
  })
  parts.push(Buffer.from([8, 8]))
  return Buffer.concat(parts)
}

test('health, diagnostics, RetroAchievements, netplay, Steam and custom consoles', async () => {
  const files = makeFiles('settings')
  const emu = path.join(files, '_fakeemu')
  const presets = makePresets(files, 300, {
    extra: {
      netplay: true,
      netplayCore: 'FakeCore',
      achievements: {
        on: [{ type: 'ini', file: '{emu}/ra.ini', set: { A: { user: '{rauser}', token: '{ratoken}' } } }],
        off: [{ type: 'ini', file: '{emu}/ra.ini', set: { A: { user: 'none' } } }]
      }
    }
  })
  writeSettings(files, { bootAnimation: false, netplayNickname: 'Hannes' })
  const games = path.join(files, 'games', 'testcon')
  fs.mkdirSync(games, { recursive: true })
  fs.writeFileSync(path.join(games, 'Alpha.tst'), 'alpha rom')
  fs.writeFileSync(path.join(games, 'Broken.tst'), '')
  fs.mkdirSync(path.join(files, 'games', 'ps1'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'ps1', 'Disc.cue'), 'FILE "Disc.bin" BINARY\n  TRACK 01 MODE2/2352\n')
  fs.writeFileSync(path.join(files, 'config', 'secrets.json'), JSON.stringify({ retroachievements: { username: 'hannes', password: 'pw', webApiKey: 'key' } }))
  const steam = path.join(files, '_steam')
  fs.mkdirSync(path.join(steam, 'userdata', '12345', 'config'), { recursive: true })
  fs.writeFileSync(path.join(steam, 'userdata', '12345', 'config', 'shortcuts.vdf'), vdf([{ AppName: 'Some Other Game', Exe: '"C:\\Games\\other.exe"' }]))

  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    const json = (o: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o))
    if (u.pathname === '/dorequest.php') {
      let body = ''
      req.on('data', (d) => (body += d))
      req.on('end', () => {
        const q = new URLSearchParams(body)
        json(q.get('p') === 'pw' ? { Success: true, User: 'Hannes', Token: 'tok123' } : { Success: false, Error: 'Invalid password' })
      })
      return
    }
    if (u.pathname === '/list/')
      return json([
        { fields: { username: 'Far', country: 'jp', game_name: 'Other Game', game_crc: '00000000', core_name: 'FakeCore', ip: '1.1.1.1', port: 1, host_method: 0, has_password: false, connectable: true } },
        { fields: { username: 'Pal', country: 'es', game_name: 'Alpha', game_crc: 'DEADBEEF', core_name: 'FakeCore 1.0', ip: '2.2.2.2', port: 55435, mitm_ip: 'europe-west1.relay.retroarch.com', mitm_port: 55435, mitm_session: 'sess42', host_method: 3, has_password: false, connectable: true } },
        // the lobby is public: broken entries, and a room trying to pass RetroArch an option as its address
        {},
        { fields: { username: 'Half' } },
        { fields: { username: 'Bad', country: 'xx', game_name: 'Alpha', game_crc: '', core_name: 'FakeCore', ip: '--appendconfig=evil.cfg', port: 55435, host_method: 0, has_password: false, connectable: true } }
      ])
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.STARSTATION_RA_API = base
  process.env.STARSTATION_LOBBY = `${base}/list/`
  process.env.STARSTATION_STEAM_DIR = steam
  const { app, page } = await launchApp(files, presets)
  delete process.env.STARSTATION_RA_API
  delete process.env.STARSTATION_LOBBY
  delete process.env.STARSTATION_STEAM_DIR
  const gid = 'testcon:alpha.tst'
  const launched = () => JSON.parse(fs.readFileSync(path.join(emu, 'launched.json'), 'utf8')) as string[]
  const waitIdle = () => expect(page.getByTestId('running')).toHaveCount(0, { timeout: 15_000 })
  try {
    await expect(page.getByTestId('game-info')).toBeVisible()

    // ---- health check
    type Issue = { severity: string; title: string; fix?: { command: string; arg?: string } }
    const issues = await api<Issue[]>(page, 'health')
    expect(issues.find((i) => i.title === 'Broken looks broken')).toBeTruthy()
    const ds = issues.find((i) => i.title === 'DuckStation is not installed')
    expect(ds?.fix).toEqual({ label: 'Install DuckStation', command: 'install-emulator', arg: 'duckstation' })
    // the UI shows them under Settings → Health check
    await openSetting(page, 'health')
    await expect(page.getByTestId('panel-health')).toContainText('Broken looks broken')
    await page.keyboard.press('Escape')

    // ---- diagnostics: zip with logs + summary, never secrets
    const zip = await api<string>(page, 'exportReport')
    const list = execFileSync(TAR, ['-tf', zip], { encoding: 'utf8' })
    expect(list).toContain('summary.json')
    expect(list).toContain('settings.json')
    expect(list).toMatch(/logs\//)
    expect(list).not.toContain('secrets')

    // ---- RetroAchievements: log in with secrets.json → token only, written into the emulator at launch
    expect((await api<{ loggedIn: boolean }>(page, 'raStatus')).loggedIn).toBe(false)
    expect((await api<{ ok: boolean }>(page, 'raLogin')).ok).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(files, 'config', 'secrets.json'), 'utf8')).retroachievements.token).toBe('tok123')
    expect((await api<{ loggedIn: boolean; username: string }>(page, 'raStatus')).username).toBe('Hannes')
    expect((await api<{ ok: boolean }>(page, 'launch', gid, 'fresh')).ok).toBe(true)
    await waitIdle()
    expect(fs.readFileSync(path.join(emu, 'ra.ini'), 'utf8')).toContain('token = tok123')
    await api(page, 'raLogout')
    expect((await api<{ ok: boolean }>(page, 'launch', gid, 'fresh')).ok).toBe(true)
    await waitIdle()
    expect(fs.readFileSync(path.join(emu, 'ra.ini'), 'utf8')).toContain('user = none')

    // ---- netplay: rooms for this core + game, host and join arguments
    type Room = { host: string; sameGame: boolean; relay: boolean; address: string; port: number; session?: string }
    const rooms = await api<Room[]>(page, 'netplayRooms', gid)
    expect(rooms.map((r) => r.host)).toEqual(['Pal', 'Bad'])
    const bad = await api<{ ok: boolean; error?: string }>(page, 'launch', gid, 'fresh', { join: rooms[1] })
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('address')
    expect(rooms[0]).toMatchObject({ sameGame: true, relay: true, address: 'europe-west1.relay.retroarch.com', port: 55435, session: 'sess42' })
    expect((await api<{ ok: boolean }>(page, 'launch', gid, 'fresh', { join: rooms[0] })).ok).toBe(true)
    await waitIdle()
    expect(launched().slice(0, 8)).toEqual(['--connect', 'europe-west1.relay.retroarch.com', '--port', '55435', '--nick', 'Hannes', '--mitm-session', 'sess42'])
    expect((await api<{ ok: boolean }>(page, 'launch', gid, 'fresh', { host: true })).ok).toBe(true)
    await waitIdle()
    expect(launched().slice(0, 3)).toEqual(['--host', '--nick', 'Hannes'])
    // Triangle menu offers Play online
    await page.getByTestId('cat-testcon').click()
    await page.keyboard.press(' ')
    await expect(page.getByTestId('pitem-online')).toBeVisible()
    await page.keyboard.press('Escape')

    // ---- Steam: refuses while Steam runs; then adds the shortcut and keeps the other one
    fs.writeFileSync(path.join(steam, 'running.test'), '')
    expect((await api<{ ok: boolean; error: string }>(page, 'addToSteam')).error).toContain('Close Steam')
    fs.rmSync(path.join(steam, 'running.test'))
    expect((await api<{ ok: boolean; users: number }>(page, 'addToSteam')).users).toBe(1)
    const sc = fs.readFileSync(path.join(steam, 'userdata', '12345', 'config', 'shortcuts.vdf')).toString('latin1')
    expect(sc).toContain('Some Other Game')
    expect(sc).toContain('Starstation')
    expect(sc).toContain('--fullscreen')
    expect(fs.existsSync(path.join(steam, 'userdata', '12345', 'config', 'shortcuts.vdf.starstation-backup'))).toBe(true)
    expect((await api<{ added: boolean }>(page, 'steamStatus')).added).toBe(true)
    // adding twice doesn't duplicate it
    await api(page, 'addToSteam')
    expect(fs.readFileSync(path.join(steam, 'userdata', '12345', 'config', 'shortcuts.vdf')).toString('latin1').split('AppName\0Starstation').length).toBe(2)

    // ---- custom console (advanced form): games launch with the given command
    const r = await api<{ ok: boolean; id: string }>(page, 'saveCustomConsole', {
      name: 'Game Boy Advance',
      short: 'GBA',
      exe: NODE,
      args: `-e "require('fs').writeFileSync(process.argv[1] + '.ran', 'ok')" "{launch}"`,
      extensions: 'gba, .agb'
    })
    expect(r).toEqual({ ok: true, id: 'x-game-boy-advance' })
    const gba = path.join(files, 'games', 'x-game-boy-advance')
    fs.writeFileSync(path.join(gba, 'Test Game.gba'), 'rom')
    await api(page, 'rescan')
    const st = await api<{ consoles: { id: string; custom: boolean }[]; library: { games: { id: string; console: string }[] } }>(page, 'getState')
    expect(st.consoles.find((c) => c.id === 'x-game-boy-advance')?.custom).toBe(true)
    const gbaGame = st.library.games.find((g) => g.console === 'x-game-boy-advance')!
    expect((await api<{ ok: boolean }>(page, 'launch', gbaGame.id, 'fresh')).ok).toBe(true)
    await expect.poll(() => fs.existsSync(path.join(gba, 'Test Game.gba.ran')), { timeout: 10_000 }).toBe(true)
    await waitIdle()
    const form = await api<{ extensions: string; args: string }>(page, 'customConsole', 'x-game-boy-advance')
    expect(form.extensions).toBe('.gba .agb')
    await api(page, 'removeCustomConsole', 'x-game-boy-advance')
    expect((await api<{ consoles: { id: string }[] }>(page, 'getState')).consoles.some((c) => c.id === 'x-game-boy-advance')).toBe(false)
    expect(fs.existsSync(path.join(gba, 'Test Game.gba'))).toBe(true)

    // ---- the form in the menu: field keyboard opens above the form
    await openSetting(page, 'consoles')
    for (let i = 0; i < 20; i++) {
      if (await page.locator('[data-testid="item-console-new"].active').count()) break
      await page.keyboard.press('ArrowDown')
    }
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('panel-custom-console')).toBeVisible()
    await page.getByTestId('pitem-name').dblclick()
    await expect(page.getByTestId('entry-field')).toBeVisible()
    await page.keyboard.type('My Console')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('pitem-name')).toContainText('My Console')
    await page.keyboard.press('Escape')

    // ---- other settings screens open
    for (const [item, panel] of [
      ['controllers', 'panel-controllers'],
      ['graphics', 'panel-graphics'],
      ['ra', 'panel-retroachievements'],
      ['netplay', 'panel-netplay-settings'],
      ['steam', 'panel-steam'],
      ['diagnostics', 'panel-diagnostics']
    ]) {
      await page.keyboard.press('Escape')
      await openSetting(page, item)
      await expect(page.getByTestId(panel)).toBeVisible()
    }
    await page.keyboard.press('Escape')
    await openSetting(page, 'controllers')
    await page.getByTestId('pitem-test').dblclick()
    await expect(page.getByTestId('padtest')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('padtest')).toHaveCount(0)
  } finally {
    await app.close()
    server.close()
  }
})
