import { test, expect, type Page, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, makePresets, writeSettings } from './helpers'

/** SPEC-v2 A: PS button menu over the game, Quit vs Save and quit, notifications wait for the game to end. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

async function overlayPage(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes('#overlay')), { timeout: 10_000 }).toBe(true)
  return app.windows().find((w) => w.url().includes('#overlay'))!
}

test('PS button menu: open over the game, Quit keeps the old resume state, Save and quit keeps the new one', async () => {
  test.setTimeout(90_000)
  const files = makeFiles('overlay')
  const presets = makePresets(files, 60_000, { quickResume: true }) // the fake emulator stays open until closed
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Alpha.tst'), 'a')
  const state = path.join(files, 'saves', 'testcon', 'states', 'Alpha.state')
  fs.mkdirSync(path.dirname(state), { recursive: true })
  fs.writeFileSync(state, 'state from last time')
  const gid = 'testcon:alpha.tst'
  const { app, page } = await launchApp(files, presets)
  try {
    const ov = await overlayPage(app)
    // every window stays hidden and silent in tests
    const shown = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible() || !w.webContents.isAudioMuted()))
    expect(shown.every((s) => !s)).toBe(true)

    // no game: the PS button does nothing
    await api(page, 'testHome')
    await expect(ov.getByTestId('overlay-closed')).toBeAttached()

    expect((await api<{ ok: boolean }>(page, 'launch', gid, 'resume')).ok).toBe(true)
    await api(page, 'testHome')
    await expect(ov.getByTestId('overlay')).toBeVisible()
    await expect(ov.getByTestId('overlay')).toContainText('Alpha')
    await expect(ov.getByTestId('overlay-resume')).toBeVisible()
    await expect(ov.getByTestId('overlay-savequit')).toContainText('Save and quit')
    await expect(ov.getByTestId('overlay-quit')).toBeVisible()
    await expect(ov.getByTestId('overlay-save')).toHaveCount(0) // the fake emulator has no save states
    // ○ = back to the game; the PS button again opens it again
    await ov.keyboard.press('Escape')
    await expect(ov.getByTestId('overlay-closed')).toBeAttached()
    await api(page, 'testHome')
    await expect(ov.getByTestId('overlay')).toBeVisible()
    // controller settings shows the pads (none in tests) and goes back
    await ov.getByTestId('overlay-pads').click()
    await expect(ov.getByTestId('overlay-pads')).toContainText('Player order')

    // a notification while playing waits until the game ends
    await api(page, 'backupNow', gid)
    await page.waitForTimeout(500)
    await expect(page.getByTestId('notices')).not.toContainText(/backed up|unchanged|No saves/)

    // the emulator writes a new resume state during the session; "Quit" puts the old one back
    fs.writeFileSync(state, 'state from this session')
    await ov.keyboard.press('Escape') // from Controller settings back to the menu
    await expect(ov.getByTestId('overlay-quit')).toBeVisible()
    await ov.getByTestId('overlay-quit').click()
    await expect.poll(async () => (await api<{ running: unknown }>(page, 'getState')).running, { timeout: 15_000 }).toBeNull()
    expect(fs.readFileSync(state, 'utf8')).toBe('state from last time')
    await expect(ov.getByTestId('overlay-closed')).toBeAttached()
    // now the held notification shows
    await expect(page.getByTestId('notices')).toContainText(/backed up|unchanged|No saves/)

    // "Save and quit" keeps what the emulator wrote
    expect((await api<{ ok: boolean }>(page, 'launch', gid, 'resume')).ok).toBe(true)
    fs.writeFileSync(state, 'state from the second session')
    await api(page, 'testHome')
    await ov.getByTestId('overlay-savequit').click()
    // until the emulator is gone the menu says so, and the PS button can't take it away
    await expect(ov.getByTestId('overlay-closing')).toContainText('Saving and closing')
    await api(page, 'testHome')
    await expect(ov.getByTestId('overlay-closing')).toBeVisible()
    await expect.poll(async () => (await api<{ running: unknown }>(page, 'getState')).running, { timeout: 15_000 }).toBeNull()
    expect(fs.readFileSync(state, 'utf8')).toBe('state from the second session')
  } finally {
    await app.close()
  }
})

test('controller assignment: with 2 controllers, ✕ decides who is player 1 and 2', async () => {
  test.setTimeout(60_000)
  const files = makeFiles('assign')
  // the fake console writes the player mapping it was given into a file (like an emulator's input config)
  const presets = makePresets(files, 800, { extra: { config: [{ type: 'write', file: '{emu}/players.txt', lines: ['{pad}', '{pad2}', '{players}', '{dolpad1}'] }] } })
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Party Game.tst'), 'p')
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('game-info')).toContainText('Party Game')
    // two controllers: an Xbox-style pad (XInput) and a DualShock 4 plugged in directly
    await page.evaluate(() => {
      const mk = (index: number, id: string) => ({ index, id, connected: true, mapping: 'standard', buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] })
      const pads = [mk(0, 'Xbox 360 Controller (XInput STANDARD GAMEPAD)'), mk(1, 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)')]
      ;(window as unknown as { fakePads: unknown[] }).fakePads = pads
      navigator.getGamepads = () => pads as unknown as Gamepad[]
    })
    const press = (pad: number, button: number, down: boolean) =>
      page.evaluate(([p, b, d]) => {
        ;(window as unknown as { fakePads: { buttons: { pressed: boolean }[] }[] }).fakePads[p as number].buttons[b as number].pressed = d as boolean
      }, [pad, button, down] as const)
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('assign')).toBeVisible()
    await expect(page.getByTestId('assign')).toContainText('Press ✕ for Player 1')
    await page.waitForTimeout(200) // buttons already held when it opens (the ✕ that started the game) don't count
    // the DualShock 4 presses ✕ first → player 1
    await press(1, 0, true)
    await expect(page.getByTestId('assign')).toContainText('Press ✕ for Player 2')
    await press(1, 0, false)
    await press(0, 0, true)
    await expect(page.getByTestId('assign')).toHaveCount(0, { timeout: 5000 })
    await expect.poll(() => fs.existsSync(path.join(files, '_fakeemu', 'players.txt')), { timeout: 5000 }).toBe(true)
    const lines = fs.readFileSync(path.join(files, '_fakeemu', 'players.txt'), 'utf8').trim().split(/\r?\n/)
    expect(lines).toEqual(['SDL-0', 'XInput-0', '2', 'SDL/0/PS4 Controller'])
    await expect.poll(async () => (await api<{ running: unknown }>(page, 'getState')).running, { timeout: 10_000 }).toBeNull()

    // ○ = the usual order (no question about players)
    await press(0, 0, false)
    fs.rmSync(path.join(files, '_fakeemu', 'players.txt'))
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('assign')).toBeVisible()
    await page.waitForTimeout(200)
    await press(0, 1, true)
    await expect(page.getByTestId('assign')).toHaveCount(0)
    await expect.poll(() => fs.existsSync(path.join(files, '_fakeemu', 'players.txt')), { timeout: 5000 }).toBe(true)
    // usual order: every connected controller still gets a player (2.0.10), so both fake pads count. Before 2.0.35
    // Chromium never announced these fake pads, so the menu didn't know the second one and the game got 1 player.
    expect(fs.readFileSync(path.join(files, '_fakeemu', 'players.txt'), 'utf8').trim().split(/\r?\n/)[2]).toBe('2')
  } finally {
    await app.close()
  }
})

test('Steam and Game Bar: a one-time guide, never a change to their settings', async () => {
  const files = makeFiles('conflicts')
  writeSettings(files, { bootAnimation: false })
  process.env.STARSTATION_TEST_CONFLICTS = 'steam,gamebar'
  let { app, page } = await launchApp(files)
  try {
    await expect(page.getByTestId('panel-home-guide')).toBeVisible()
    await expect(page.getByTestId('panel-home-guide')).toContainText('Xbox Game Bar')
    await expect(page.getByTestId('panel-home-guide')).toContainText('Guide button focuses Steam')
    await page.getByTestId('pitem-ok').dblclick()
    await expect(page.getByTestId('panel-home-guide')).toHaveCount(0)
    await expect.poll(() => fs.existsSync(path.join(files, 'config', 'guides.json'))).toBe(true)
    // the health check keeps listing it
    const issues = await api<{ title: string }[]>(page, 'health')
    expect(issues.map((i) => i.title)).toEqual(expect.arrayContaining(['Xbox Game Bar takes the PS / Home button', 'Steam is running']))
    // 2.1.0: the Game Bar one has "Fix it" (only on request); afterwards it is gone, Steam stays (only Steam can change it)
    const gb = (issues as { title: string; fix?: { command: string } }[]).find((i) => i.title.startsWith('Xbox Game Bar'))
    expect(gb?.fix?.command).toBe('gamebar-off')
    await api(page, 'runCommand', 'gamebar-off')
    const after = await api<{ title: string }[]>(page, 'health')
    expect(after.map((i) => i.title)).not.toContain('Xbox Game Bar takes the PS / Home button')
    expect(after.map((i) => i.title)).toContain('Steam is running')
  } finally {
    await app.close()
  }
  ;({ app, page } = await launchApp(files))
  try {
    await expect(page.getByTestId('xmb')).toBeVisible()
    await page.waitForTimeout(800)
    await expect(page.getByTestId('panel-home-guide')).toHaveCount(0) // shown once
  } finally {
    await app.close()
    delete process.env.STARSTATION_TEST_CONFLICTS
  }
})

test('couch check: the steps tick off as they happen, the result is saved', async () => {
  test.setTimeout(60_000)
  const files = makeFiles('couchcheck')
  const presets = makePresets(files, 60_000, { quickResume: true })
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Alpha.tst'), 'a')
  const { app, page } = await launchApp(files, presets)
  try {
    const ov = await overlayPage(app)
    await page.getByTestId('cat-settings').dispatchEvent('click')
    await api(page, 'couchStart')
    expect((await api<{ done: string[] }>(page, 'couchStatus')).done).toEqual([])
    expect((await api<{ ok: boolean }>(page, 'launch', 'testcon:alpha.tst')).ok).toBe(true)
    await api(page, 'testHome')
    await ov.getByTestId('overlay-resume').click()
    await api(page, 'testHome')
    await ov.getByTestId('overlay-savequit').click()
    await expect.poll(async () => (await api<{ running: unknown }>(page, 'getState')).running, { timeout: 15_000 }).toBeNull()
    await api(page, 'couchStart') // opening the panel again keeps the progress
    const st = await api<{ done: string[] }>(page, 'couchStatus')
    expect(st.done).toEqual(expect.arrayContaining(['launch', 'menu', 'resume', 'savequit', 'closed']))
    const f = await api<string>(page, 'couchSave')
    expect(JSON.parse(fs.readFileSync(f, 'utf8')).done).toEqual(expect.arrayContaining(['launch', 'closed']))
  } finally {
    await app.close()
  }
})

test('an emulator the menu pauses itself (3DS): paused on open, continued on Resume / Save state / Screenshot, never left paused', async () => {
  test.setTimeout(90_000)
  const files = makeFiles('overlaypause')
  const presets = makePresets(files, 60_000)
  const emuFile = path.join(presets, 'emulators', 'fakeemu.json')
  const emu = JSON.parse(fs.readFileSync(emuFile, 'utf8'))
  emu.overlay = { saveState: 'F1', loadState: 'F3', pauseKey: 'F4' }
  fs.writeFileSync(emuFile, JSON.stringify(emu))
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Alpha.tst'), 'a')
  const logDir = path.join(files, 'config', 'logs')
  const lines = () =>
    fs
      .readdirSync(logDir)
      .filter((n) => n.endsWith('.log'))
      .map((n) => fs.readFileSync(path.join(logDir, n), 'utf8'))
      .join('')
      .split('\n')
      .map((l) => /game (paused|continued) \(F4\)/.exec(l)?.[1])
      .filter(Boolean)
  const { app, page } = await launchApp(files, presets)
  try {
    const ov = await overlayPage(app)
    expect((await api<{ ok: boolean }>(page, 'launch', 'testcon:alpha.tst')).ok).toBe(true)

    await api(page, 'testHome')
    await expect(ov.getByTestId('overlay-resume')).toBeVisible()
    await expect.poll(lines).toEqual(['paused'])
    await ov.getByTestId('overlay-resume').click()
    await expect.poll(lines).toEqual(['paused', 'continued'])

    // PS pressed twice quickly: still one pause, one continue
    await api(page, 'testHome')
    await api(page, 'testHome')
    await expect.poll(lines).toEqual(['paused', 'continued', 'paused', 'continued'])
    await expect(ov.getByTestId('overlay-closed')).toBeAttached()

    // Save state: the game runs again first (Azahar only saves while running)
    await api(page, 'testHome')
    await expect(ov.getByTestId('overlay-save')).toBeVisible()
    await ov.getByTestId('overlay-save').click()
    await expect.poll(lines).toEqual(['paused', 'continued', 'paused', 'continued', 'paused', 'continued'])

    // Screenshot: continued afterwards
    await api(page, 'testHome')
    await expect(ov.getByTestId('overlay-shot')).toBeVisible()
    await ov.getByTestId('overlay-shot').click()
    await expect.poll(() => lines().length).toBe(8)
    expect(lines().slice(-2)).toEqual(['paused', 'continued'])

    // Save and quit from a paused game: closes, nothing pressed after it
    await api(page, 'testHome')
    await expect.poll(() => lines().length).toBe(9)
    await ov.getByTestId('overlay-savequit').click()
    await expect.poll(async () => (await api<{ running: unknown }>(page, 'getState')).running, { timeout: 15_000 }).toBeNull()
    expect(lines().length).toBe(9)

    // the next game starts unpaused: its first menu pauses it again
    expect((await api<{ ok: boolean }>(page, 'launch', 'testcon:alpha.tst')).ok).toBe(true)
    await api(page, 'testHome')
    await expect.poll(() => lines().slice(9)).toEqual(['paused'])
    await ov.getByTestId('overlay-resume').click()
    await expect.poll(() => lines().slice(9)).toEqual(['paused', 'continued'])
  } finally {
    await app.close()
  }
})

test('PS menu: an XInput player who pressed PS is found by the pads’ live state, not Chromium’s Guide button', async () => {
  test.setTimeout(60_000)
  const files = makeFiles('overlaywho')
  const presets = makePresets(files, 60_000)
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Alpha.tst'), 'a')
  // Hannes's two DS3 pads at rest (pad helper: XInput slots 0 and 1)
  process.env.STARSTATION_TEST_XSTATE = '0:-129,-900,0,0,0,0,0;1:-1157,-900,0,0,0,0,0'
  const { app, page } = await launchApp(files, presets)
  try {
    const ov = await overlayPage(app)
    // Chromium numbers them the other way round and gives the Guide press to its first pad (index 0)
    await ov.evaluate(() => {
      const mk = (index: number, lx: number, guide: boolean) => ({
        index,
        id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)',
        connected: true,
        mapping: 'standard',
        buttons: Array.from({ length: 17 }, (_v, i) => ({ pressed: i === 16 && guide, value: i === 16 && guide ? 1 : 0 })),
        axes: [lx / 32767, 900 / 32767, 0, 0]
      })
      const pads = [mk(0, -1157, true), mk(1, -129, false)]
      navigator.getGamepads = () => pads as unknown as Gamepad[]
    })
    const locked = () => ov.evaluate(() => (window as unknown as { ssInput: { lockedPad: number | null } }).ssInput.lockedPad)
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    expect((await api<{ ok: boolean }>(page, 'launch', 'testcon:alpha.tst')).ok).toBe(true)

    // slot 0 pressed PS → the menu's pad 1 (Chromium's Guide on pad 0 is ignored)
    await api(page, 'testHome', 'xinput:0')
    await expect(ov.getByTestId('overlay-resume')).toBeVisible()
    await expect.poll(locked).toBe(1)
    await ov.getByTestId('overlay-resume').click()
    await expect.poll(locked).toBeNull()
    await expect(ov.getByTestId('overlay-closed')).toBeAttached()

    // slot 1 → pad 0
    await api(page, 'testHome', 'xinput:1')
    await expect(ov.getByTestId('overlay-resume')).toBeVisible()
    await expect.poll(locked).toBe(0)
    await ov.getByTestId('overlay-resume').click()
    await expect(ov.getByTestId('overlay-closed')).toBeAttached()

    // the keyboard / no known pad: the old way (whoever holds Guide in Chromium = pad 0 here)
    await api(page, 'testHome')
    await expect(ov.getByTestId('overlay-resume')).toBeVisible()
    await expect.poll(locked).toBe(0)
    await ov.getByTestId('overlay-resume').click()
  } finally {
    await app.close()
    delete process.env.STARSTATION_TEST_XSTATE
  }
})

test('a resume point saved with fewer controllers says so (the game only looks for controllers when it boots)', async () => {
  test.setTimeout(60_000)
  const files = makeFiles('resumeplayers')
  const presets = makePresets(files, 800, { quickResume: true })
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Alpha.tst'), 'a')
  const state = path.join(files, 'saves', 'testcon', 'states', 'Alpha.state')
  fs.mkdirSync(path.dirname(state), { recursive: true })
  fs.writeFileSync(state, 'one-player moment')
  fs.mkdirSync(path.join(files, 'config', 'library'), { recursive: true })
  fs.writeFileSync(path.join(files, 'config', 'library', 'stats.json'), JSON.stringify({ 'testcon:alpha.tst': { playTime: 60, playCount: 1, resumePlayers: 1 } }))
  const pads = (n: number) =>
    fs.writeFileSync(path.join(files, 'config', 'controllers.json'), JSON.stringify({ api: 'xinput', pads: Array.from({ length: n }, () => 'Xbox 360 Controller (XInput STANDARD GAMEPAD)') }))
  pads(2)
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    const d = await api<{ resume: { warning?: string } | null }>(page, 'gameDetails', 'testcon:alpha.tst')
    expect(d.resume?.warning).toContain('saved with 1 controller')
    expect(d.resume?.warning).toContain('start fresh')
  } finally {
    await app.close()
  }
  // the same number of controllers as back then: nothing to say
  pads(1)
  const again = await launchApp(files, presets)
  try {
    await expect(again.page.getByTestId('game-info')).toContainText('Alpha')
    const d = await api<{ resume: { warning?: string } | null }>(again.page, 'gameDetails', 'testcon:alpha.tst')
    expect(d.resume).not.toBeNull()
    expect(d.resume?.warning).toBeUndefined()
  } finally {
    await again.app.close()
  }
})

test('Xenia: before a game, player 1 gets a signed-in profile (moved from the slot it landed in)', async () => {
  test.setTimeout(60_000)
  const files = makeFiles('xeniaprofile')
  const presets = makePresets(files, 800, { extra: { config: [{ type: 'xenia-profile', file: '{emu}/xenia.toml', content: '{emu}/content' }] } })
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Alpha.tst'), 'a')
  const emu = path.join(files, '_fakeemu')
  fs.mkdirSync(path.join(emu, 'content', 'E03000005A8B21C9', 'FFFE07D1'), { recursive: true })
  const toml = path.join(emu, 'xenia.toml')
  fs.writeFileSync(
    toml,
    [
      '[HID]',
      'guide_button = false',
      '',
      '[Profiles]',
      'logged_profile_slot_0_xuid = ""                   \t# XUID of the profile to load on boot in slot 0',
      'logged_profile_slot_1_xuid = "E03000005A8B21C9"   \t# XUID of the profile to load on boot in slot 1',
      'logged_profile_slot_2_xuid = ""                   \t# XUID of the profile to load on boot in slot 2',
      'logged_profile_slot_3_xuid = ""                   \t# XUID of the profile to load on boot in slot 3',
      ''
    ].join('\r\n')
  )
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    expect((await api<{ ok: boolean }>(page, 'launch', 'testcon:alpha.tst')).ok).toBe(true)
    await expect.poll(() => fs.readFileSync(toml, 'utf8'), { timeout: 10_000 }).toContain('logged_profile_slot_0_xuid = "E03000005A8B21C9"')
    const t = fs.readFileSync(toml, 'utf8')
    expect(t).toContain('logged_profile_slot_1_xuid = ""')
    expect(t).toContain('guide_button = false')
    expect(t).not.toMatch(/[^\r]\n/) // Windows line endings kept
  } finally {
    await app.close()
  }
})
