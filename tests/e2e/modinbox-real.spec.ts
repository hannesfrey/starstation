import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { launchApp, makeFiles, writeSettings } from './helpers'

/**
 * Opt-in (STARSTATION_REAL_MODS=1): Hannes's real mods from Files\mods\ps2 against his real PS2 games, in a test
 * Files folder — the archives are hard links (his stay where they are), games\ps2 is a junction (only read),
 * the PCSX2 folder is an empty test folder (his PCSX2 isn't touched).
 */
test.skip(process.env.STARSTATION_REAL_MODS !== '1', 'uses Hannes’s real mod archives (STARSTATION_REAL_MODS=1)')

const REAL = path.resolve(__dirname, '..', '..', '..')
const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>
type Notice = { title: string; detail?: string }

test('real mods: HD HUD found by itself, Retexture asked, Spec II refused for the wrong GT4 version', async () => {
  test.setTimeout(30 * 60_000)
  process.env.STARSTATION_MODS_POLL = '2000'
  const files = makeFiles('realmods')
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games'), { recursive: true })
  execFileSync('cmd.exe', ['/c', 'mklink', '/J', path.join(files, 'games', 'ps2'), path.join(REAL, 'games', 'ps2')], { stdio: 'ignore' })
  // his PCSX2 settings file (a copy): the texture setting is switched when the game starts
  fs.mkdirSync(path.join(files, 'emulators', 'pcsx2', 'inis'), { recursive: true })
  fs.copyFileSync(path.join(REAL, 'emulators', 'pcsx2', 'inis', 'PCSX2.ini'), path.join(files, 'emulators', 'pcsx2', 'inis', 'PCSX2.ini'))
  const inbox = path.join(files, 'mods', 'ps2')
  fs.mkdirSync(inbox, { recursive: true })
  const real = fs.readdirSync(path.join(REAL, 'mods', 'ps2')).filter((n) => /\.(zip|7z)$/i.test(n))
  expect(real).toHaveLength(3)
  for (const n of real) fs.linkSync(path.join(REAL, 'mods', 'ps2', n), path.join(inbox, n))

  const { app, page } = await launchApp(files)
  const t0 = Date.now()
  const log = (s: string) => console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${s}`)
  try {
    await page.waitForFunction(() => !!(window as unknown as { starstation?: unknown }).starstation)
    await page.evaluate(() => {
      const w = window as unknown as { __n: unknown[]; __ask: unknown[]; starstation: { on: (c: string, f: (x: unknown) => void) => void } }
      w.__n = []
      w.__ask = []
      w.starstation.on('notice', (n) => w.__n.push(n))
      w.starstation.on('mod-inbox-ask', (q) => w.__ask.push(q))
    })
    const notices = () => page.evaluate(() => (window as unknown as { __n: Notice[] }).__n.slice())
    const asks = () => page.evaluate(() => (window as unknown as { __ask: { id: string; name: string; games: string[] }[] }).__ask.slice())
    type G = { id: string; title: string; serial?: string }
    const findGt4 = async () => (await api<{ library: { games: G[] } }>(page, 'getState')).library.games.find((g) => g.title.startsWith('Gran Turismo 4'))
    await expect.poll(async () => !!(await findGt4()), { timeout: 60_000 }).toBe(true)
    const gt4 = (await findGt4())!
    log(`GT4 in library: ${gt4.id} serial ${gt4.serial}`)

    // whichever comes first; the Retexture question is answered with GT4
    const deadline = Date.now() + 28 * 60_000
    let answered = false
    for (;;) {
      const n = await notices()
      const a = await asks()
      if (a.length && !answered) {
        log(`asked: ${a[0].name} → candidates ${a[0].games.slice(0, 3).join(', ')}`)
        expect(a[0].name).toBe('Retexture Mod 3.0')
        expect(a[0].games[0]).toBe(gt4.id) // already has a mod (the HD HUD pack): listed first
        await api(page, 'modInboxAssign', a[0].id, gt4.id)
        answered = true
      }
      const hud = n.find((x) => x.title === 'Mod installed and on' && x.detail?.startsWith('Gran Turismo 4 HD HUD'))
      const retex = n.find((x) => x.title === 'Mod installed and on' && x.detail?.startsWith('Retexture Mod 3.0'))
      const spec = n.find((x) => x.title.startsWith('Mod not added') && x.title.includes('Spec II'))
      if (hud && retex && spec) break
      if (Date.now() > deadline) throw new Error(`timed out: ${JSON.stringify(n)}`)
      await page.waitForTimeout(3000)
    }
    for (const x of await notices()) log(`notice: ${x.title} — ${x.detail ?? ''}`)
    const n = await notices()
    expect(n.find((x) => x.title === 'Mod installed and on' && x.detail?.startsWith('Gran Turismo 4 HD HUD'))?.title).toBe('Mod installed and on')
    expect(n.find((x) => x.title === 'Mod installed and on' && x.detail?.startsWith('Retexture Mod 3.0'))?.title).toBe('Mod installed and on')
    const specNote = n.find((x) => x.title.startsWith('Mod not added') && x.title.includes('Spec II'))!.detail!
    expect(specNote).toContain('Online Public Beta')
    expect(specNote).toContain('3306538778dda2ded87ceaf52c944a98.')

    const tex = path.join(files, 'emulators', 'pcsx2', 'textures', gt4.serial!, 'replacements')
    const top = fs.readdirSync(tex)
    log(`textures/${gt4.serial}/replacements: ${top.join(' | ')}`)
    expect(top).toContain('!_HD HUD & UI')
    expect(top).toContain('cars')
    expect(top).toContain('tracks')
    expect(top).not.toContain('Alternate Textures')
    // starting GT4 switches texture loading on (PCSX2 itself isn't in the test folder, so nothing really starts)
    const ini = path.join(files, 'emulators', 'pcsx2', 'inis', 'PCSX2.ini')
    expect(fs.readFileSync(ini, 'utf8')).toMatch(/LoadTextureReplacements\s*=\s*false/)
    const started = await api<{ ok: boolean; error?: string }>(page, 'launch', gt4.id)
    log(`start GT4 in the test folder: ${started.ok ? 'started?!' : started.error}`)
    expect(fs.readFileSync(ini, 'utf8')).toMatch(/LoadTextureReplacements\s*=\s*true/)
    // the two packs went to the (test) Recycle Bin, Spec II stays
    // (the folder also holds GT4's installed mods, in their own folder)
    expect(fs.readdirSync(inbox).filter((n) => /\.(zip|7z)$/i.test(n))).toEqual(['Gran Turismo 4 Spec II v1.10 Full.zip'])
    expect(fs.existsSync(path.join(inbox, '.unpacking')) ? fs.readdirSync(path.join(inbox, '.unpacking')) : []).toEqual([])
  } finally {
    await app.close()
    execFileSync('cmd.exe', ['/c', 'rmdir', path.join(files, 'games', 'ps2')], { stdio: 'ignore' })
    fs.rmSync(files, { recursive: true, force: true })
    delete process.env.STARSTATION_MODS_POLL
  }
})
