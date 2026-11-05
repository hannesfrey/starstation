import { test, expect, _electron as electron, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, makePresets, writeSettings, SOURCE } from './helpers'

/** SPEC-v2 B + G: safe mode, crash → safe mode offered, What's new, automatic rescue, Undo update. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

const VERSION = (JSON.parse(fs.readFileSync(path.join(SOURCE, 'package.json'), 'utf8')) as { version: string }).version
const updates = (files: string, ...p: string[]) => path.join(files, 'config', 'updates', ...p)
const writeJson = (f: string, o: unknown) => {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, JSON.stringify(o))
}
/** A kept installer (just has to look like a program). */
const fakeInstaller = (files: string, v: string) => {
  fs.mkdirSync(updates(files, 'installers'), { recursive: true })
  fs.writeFileSync(updates(files, 'installers', `Starstation-Setup-${v}.exe`), 'MZ fake installer')
}

/** Start Starstation and wait for it to quit by itself (rescue / undo install another version). */
async function runUntilExit(files: string, env: Record<string, string> = {}): Promise<void> {
  const app = await electron.launch({
    executablePath: path.join(SOURCE, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [SOURCE],
    cwd: SOURCE,
    env: { ...process.env, STARSTATION_FILES: files, STARSTATION_HEADLESS: '1', ELECTRON_RENDERER_URL: '', ...env }
  })
  await new Promise<void>((resolve) => {
    if (app.process().exitCode !== null) resolve()
    app.process().once('exit', () => resolve())
  })
}

test('safe mode: ○ at the boot animation, defaults only, mods set aside and back afterwards', async () => {
  test.setTimeout(90_000)
  const files = makeFiles('safe')
  const emu = path.join(files, '_fakeemu')
  const presets = makePresets(files, 300, { extra: { mods: { targets: [{ id: 'patches', label: 'Patch (.pnach)', dir: '{emu}/patches', match: '\\.pnach$', flatten: true }] } } })
  writeSettings(files, { bootAnimation: true, sounds: false, graphicsDefault: 'max' })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Alpha.tst'), 'a')
  const pnach = path.join(files, 'Faster.pnach')
  fs.writeFileSync(pnach, 'patch=1')
  const gid = 'testcon:alpha.tst'
  const placed = path.join(emu, 'patches', 'Faster.pnach')

  // normal start: a mod is installed and switched on
  let { app, page } = await launchApp(files, presets)
  await page.keyboard.press('Enter') // skip the boot animation
  await expect(page.getByTestId('xmb')).toBeVisible()
  const add = await api<{ ok: boolean; mod: { id: string } }>(page, 'modAdd', gid, pnach)
  expect(add.ok).toBe(true)
  expect((await api<{ ok: boolean }>(page, 'modToggle', gid, add.mod.id, true)).ok).toBe(true)
  expect(fs.existsSync(placed)).toBe(true)
  await app.close()

  // next start: ○ (Esc) during the boot animation → safe mode
  ;({ app, page } = await launchApp(files, presets))
  try {
    await expect(page.getByTestId('boot')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('safe-badge')).toBeVisible({ timeout: 10_000 })
    type St = { info: { safeMode: boolean }; settings: { graphicsDefault: string; sounds: boolean } }
    let st = await api<St>(page, 'getState')
    expect(st.info.safeMode).toBe(true)
    expect(st.settings.graphicsDefault).toBe('enhanced') // the default, not the saved "max"
    // changes in safe mode are not saved
    await api(page, 'setSetting', 'sounds', true)
    expect(JSON.parse(fs.readFileSync(path.join(files, 'config', 'settings.json'), 'utf8')).sounds).toBe(false)

    // the game starts without its mod
    expect((await api<{ ok: boolean }>(page, 'launch', gid)).ok).toBe(true)
    expect(fs.existsSync(placed)).toBe(false)
    await expect.poll(async () => (await api<{ running: unknown }>(page, 'getState')).running, { timeout: 10_000 }).toBeNull()
    expect(JSON.parse(fs.readFileSync(path.join(files, 'config', 'safe-mode.json'), 'utf8')).suspended[gid]).toEqual([add.mod.id])

    // Settings shows "Leave safe mode" first
    await page.getByTestId('cat-settings').dispatchEvent('click') // may be scrolled off to the left
    await expect(page.getByTestId('item-safe-leave')).toBeVisible()

    // leaving: mod and settings come back
    await api(page, 'setSafeMode', false)
    await expect(page.getByTestId('safe-badge')).toHaveCount(0, { timeout: 10_000 })
    await expect.poll(() => fs.existsSync(placed), { timeout: 10_000 }).toBe(true)
    st = await api<St>(page, 'getState')
    expect(st.info.safeMode).toBe(false)
    expect(st.settings.graphicsDefault).toBe('max')
    const mods = await api<{ mods: { id: string; enabled: boolean }[] }>(page, 'mods', gid)
    expect(mods.mods[0].enabled).toBe(true)
  } finally {
    await app.close()
  }
})

test("after a crash safe mode is offered; What's new after an update", async () => {
  const files = makeFiles('crash')
  writeSettings(files, { bootAnimation: false })
  // last run of this version ended without closing normally; the version before was 1.0.0
  writeJson(updates(files, 'session.json'), { last: { version: VERSION, startedAt: 1, clean: false }, crashesInARow: 0, cleanRuns: { [VERSION]: 3 }, versions: [VERSION, '1.0.0'] })
  writeJson(updates(files, 'state.json'), { lastVersion: '1.0.0' })
  let { app, page } = await launchApp(files)
  try {
    await expect(page.getByTestId('panel-crashed')).toBeVisible()
    await page.getByTestId('pitem-safe').dblclick()
    await expect(page.getByTestId('safe-badge')).toBeVisible({ timeout: 10_000 })
    // the question isn't asked again after the menu restarts in safe mode
    await expect(page.getByTestId('panel-crashed')).toHaveCount(0)
  } finally {
    await app.close()
  }
  // a normal close: no crash question next time, What's new instead (the update to this version)
  writeJson(updates(files, 'state.json'), { lastVersion: '1.0.0' })
  ;({ app, page } = await launchApp(files))
  try {
    await expect(page.getByTestId('panel-whats-new')).toBeVisible()
    await expect(page.getByTestId('panel-crashed')).toHaveCount(0)
    await page.getByTestId('pitem-more').dblclick()
    await expect(page.getByTestId('panel-whats-new-details')).toBeVisible()
  } finally {
    await app.close()
  }
  // shown once
  ;({ app, page } = await launchApp(files))
  try {
    await expect(page.getByTestId('xmb')).toBeVisible()
    await page.waitForTimeout(800)
    await expect(page.getByTestId('panel-whats-new')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('crashed twice right after an update: goes back to the version before by itself', async () => {
  test.setTimeout(60_000)
  const files = makeFiles('rescue')
  writeSettings(files, { bootAnimation: false })
  fakeInstaller(files, '1.8.0')
  // this version never closed normally and crashed twice since the update from 1.8.0
  writeJson(updates(files, 'session.json'), { last: { version: VERSION, startedAt: 1, clean: false }, crashesInARow: 1, cleanRuns: {}, versions: [VERSION, '1.8.0'] })
  await runUntilExit(files)
  const runs = JSON.parse(fs.readFileSync(updates(files, 'test-runs.json'), 'utf8'))
  expect(runs).toEqual([{ version: '1.8.0', why: 'rescue', args: ['/S', '--force-run'] }])
  expect(JSON.parse(fs.readFileSync(updates(files, 'skip.json'), 'utf8')).skip).toBe(VERSION)

  // the old version starts and says what happened (the version is faked: it's the same build)
  process.env.STARSTATION_TEST_VERSION = '1.8.0'
  const old = await launchApp(files)
  delete process.env.STARSTATION_TEST_VERSION
  try {
    await expect(old.page.getByTestId('notices')).toContainText('Back on version 1.8.0')
    await expect(old.page.getByTestId('panel-crashed')).toHaveCount(0)
    const u = await api<{ skipped?: string }>(old.page, 'updateState')
    expect(u.skipped).toBe(VERSION)
  } finally {
    await old.app.close()
  }
})

test('Undo update: kept versions, going back skips the newer one', async () => {
  test.setTimeout(60_000)
  const files = makeFiles('undo')
  writeSettings(files, { bootAnimation: false })
  for (const v of ['1.5.0', '1.6.0', '1.7.0', '1.8.0', '9.9.9']) fakeInstaller(files, v)
  const { app, page } = await launchApp(files)
  const u = await api<{ previous: string[] }>(page, 'updateState')
  expect(u.previous).toEqual(['1.8.0', '1.7.0', '1.6.0']) // the last 3 older ones; newer ones are not "undo"
  await api(page, 'undoUpdate', '1.7.0')
  await new Promise<void>((resolve) => {
    if (app.process().exitCode !== null) resolve()
    app.process().once('exit', () => resolve())
  })
  expect(JSON.parse(fs.readFileSync(updates(files, 'test-runs.json'), 'utf8'))).toEqual([{ version: '1.7.0', why: 'undo update', args: ['/S', '--force-run'] }])
  expect(JSON.parse(fs.readFileSync(updates(files, 'skip.json'), 'utf8')).skip).toBe(VERSION)
  // a normal close (not a crash): no safe-mode question on the next start
  const session = JSON.parse(fs.readFileSync(updates(files, 'session.json'), 'utf8'))
  expect(session.last.clean).toBe(true)
})
