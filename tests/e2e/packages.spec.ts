import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { launchApp, makeFiles, makePresets, writeSettings, SOURCE } from './helpers'

/** Step 11: packages — save to folder, send/receive by code (croc, local relay), merge into an existing setup. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>
const CROC = path.join(SOURCE, 'resources', 'bin', 'croc.exe')
const MODS = {
  mods: { targets: [{ id: 'textures', label: 'Texture pack', dir: '{emu}/textures/{basename}', match: '\\.png$' }] }
}
type Choice = { emulators: boolean; bios: boolean; games: 'all' | string[]; mods: boolean; settings: boolean; saves: boolean }
const ALL: Choice = { emulators: true, bios: true, games: 'all', mods: true, settings: true, saves: true }

/** A sender PC: an emulator folder, BIOS, games, a mod that is on, saves, settings and play stats. */
function senderFiles(): { files: string; presets: string } {
  const files = makeFiles('pkg-send')
  const presets = makePresets(files, 200, { extra: MODS })
  writeSettings(files, { bootAnimation: false, netplayNickname: 'Sender' })
  const w = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(files, rel)), { recursive: true })
    fs.writeFileSync(path.join(files, rel), text)
  }
  w('emulators/duckstation/duckstation-qt-x64-ReleaseLTCG.exe', 'fake exe')
  w('emulators/duckstation/settings.ini', '[Main]\n')
  w('bios/ps1/scph1001.bin', 'bios')
  w('games/testcon/Alpha.tst', 'alpha')
  w('games/nes/Zelda (USA).nes', 'zelda v1')
  w('saves/testcon/Alpha.sav', 'alpha progress')
  w('config/library/stats.json', JSON.stringify({ 'testcon:alpha.tst': { playTime: 999, playCount: 3, favorite: true } }))
  w('config/secrets.json', JSON.stringify({ retroachievements: { username: 'secret-user' } }))
  w('_incoming/HD/a.png', 'hd texture')
  return { files, presets }
}

function relay(ports: number[]): ChildProcess {
  return spawn(CROC, ['relay', '--ports', ports.join(',')], { windowsHide: true, stdio: 'ignore' })
}

test('packages: save to folder, send by code, receive into an existing setup without losing anything', async () => {
  test.setTimeout(120_000)
  const s = senderFiles()
  const r = makeFiles('pkg-recv')
  const rp = makePresets(r, 200, { extra: MODS })
  writeSettings(r, { bootAnimation: false, netplayNickname: 'Mine' })
  fs.mkdirSync(path.join(r, 'games', 'nes'), { recursive: true })
  fs.writeFileSync(path.join(r, 'games', 'nes', 'Zelda (USA).nes'), 'my own zelda')
  fs.mkdirSync(path.join(r, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(r, 'games', 'testcon', 'Gamma.tst'), 'gamma')

  const relayProc = relay([9309, 9310, 9311, 9312, 9313])
  process.env.STARSTATION_CROC_RELAY = '127.0.0.1:9309'
  const A = await launchApp(s.files, s.presets)
  const B = await launchApp(r, rp)
  delete process.env.STARSTATION_CROC_RELAY
  try {
    // sender: a mod that is switched on
    const add = await api<{ ok: boolean; mod: { id: string } }>(A.page, 'modAdd', 'testcon:alpha.tst', path.join(s.files, '_incoming', 'HD'))
    expect((await api<{ ok: boolean }>(A.page, 'modToggle', 'testcon:alpha.tst', add.mod.id, true)).ok).toBe(true)

    // ---- save to folder (hidden test run: Files\backups\packages)
    const saved = await api<{ ok: boolean; folder: string }>(A.page, 'packageSaveToFolder', ALL)
    expect(saved.ok).toBe(true)
    const m = JSON.parse(fs.readFileSync(path.join(saved.folder, 'manifest.json'), 'utf8'))
    expect(m).toMatchObject({ app: 'Starstation', format: 1, emulators: ['duckstation'] })
    for (const rel of ['emulators/duckstation/settings.ini', 'bios/ps1/scph1001.bin', 'games/nes/Zelda (USA).nes', 'saves/testcon/Alpha.sav', 'config/settings.json'])
      expect(fs.existsSync(path.join(saved.folder, rel)), rel).toBe(true)
    // never: play time / favorites, logins
    expect(fs.existsSync(path.join(saved.folder, 'config', 'library', 'stats.json'))).toBe(false)
    expect(fs.existsSync(path.join(saved.folder, 'config', 'secrets.json'))).toBe(false)
    // without saves (the default)
    expect((await api<number>(A.page, 'packageSize', { ...ALL, saves: false })) < (await api<number>(A.page, 'packageSize', ALL))).toBe(true)

    // ---- send by code (croc through a local relay) → receive on B, keeping B's settings
    await A.page.evaluate(() => {
      const w = window as unknown as { codes: string[]; starstation: { on: (c: string, f: (p: { code?: string }) => void) => void } }
      w.codes = []
      w.starstation.on('package-progress', (p) => p.code && w.codes.push(p.code))
    })
    const sending = api<{ ok: boolean }>(A.page, 'packageSend', ALL)
    await expect.poll(() => A.page.evaluate(() => (window as unknown as { codes: string[] }).codes[0] ?? ''), { timeout: 30_000 }).toMatch(/^\d{4}-[a-z]+-[a-z]+-[a-z]+$/)
    const code = await A.page.evaluate(() => (window as unknown as { codes: string[] }).codes[0])
    const got = await api<{ ok: boolean; added: number; kept: number }>(B.page, 'packageReceive', code, false)
    expect(got.ok).toBe(true)
    expect((await sending).ok).toBe(true)
    expect(got.kept).toBeGreaterThan(0)

    // everything new arrived where it belongs
    expect(fs.readFileSync(path.join(r, 'games', 'testcon', 'Alpha.tst'), 'utf8')).toBe('alpha')
    expect(fs.existsSync(path.join(r, 'emulators', 'duckstation', 'duckstation-qt-x64-ReleaseLTCG.exe'))).toBe(true)
    expect(fs.existsSync(path.join(r, 'bios', 'ps1', 'scph1001.bin'))).toBe(true)
    expect(fs.readFileSync(path.join(r, 'saves', 'testcon', 'Alpha.sav'), 'utf8')).toBe('alpha progress')
    // nothing of B's was overwritten or deleted, B's settings kept (asked: "keep mine")
    expect(fs.readFileSync(path.join(r, 'games', 'nes', 'Zelda (USA).nes'), 'utf8')).toBe('my own zelda')
    expect(fs.existsSync(path.join(r, 'games', 'testcon', 'Gamma.tst'))).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(r, 'config', 'settings.json'), 'utf8')).netplayNickname).toBe('Mine')
    // the mod is on again on B, placed into B's own emulator folder
    expect(fs.readFileSync(path.join(r, '_fakeemu', 'textures', 'Alpha', 'a.png'), 'utf8')).toBe('hd texture')
    // play time and favorites stayed on the sender
    const st = await api<{ library: { stats: Record<string, { favorite?: boolean }>; games: { id: string }[] } }>(B.page, 'getState')
    expect(st.library.games.map((g) => g.id)).toContain('testcon:alpha.tst')
    expect(st.library.stats['testcon:alpha.tst']?.favorite).toBeFalsy()
    // the download folder is cleaned up
    expect(fs.readdirSync(path.join(r, 'config', 'packages')).filter((n) => n.startsWith('receive-'))).toEqual([])

    // ---- receiving the saved folder into an empty PC takes the package's settings
    const c = makeFiles('pkg-empty')
    const cp = makePresets(c, 200, { extra: MODS })
    const C = await launchApp(c, cp)
    try {
      const res = await api<{ ok: boolean }>(C.page, 'packageReceiveFolder', true, saved.folder)
      expect(res.ok).toBe(true)
      expect(JSON.parse(fs.readFileSync(path.join(c, 'config', 'settings.json'), 'utf8')).netplayNickname).toBe('Sender')
    } finally {
      await C.app.close()
    }
  } finally {
    await A.app.close()
    await B.app.close()
    relayProc.kill()
  }
})
