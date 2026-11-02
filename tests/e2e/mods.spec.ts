import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { launchApp, makeFiles, makePresets, writeSettings } from './helpers'

/** Step 8: mod manager — add, place, switch on/off, conflicts, untouched user files, GameBanana. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

const TAR = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
function zip(out: string, folder: string, files: Record<string, string>): void {
  const src = path.join(path.dirname(out), `${path.basename(out)}-src`)
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(src, folder, rel)), { recursive: true })
    fs.writeFileSync(path.join(src, folder, rel), text)
  }
  execFileSync(TAR, ['-a', '-cf', out, '-C', src, folder])
}

type Add = { ok: boolean; mod?: { id: string; name: string; enabled: boolean; source: string }; error?: string; ask?: { pending: string; targets: { id: string }[] } }
type Toggle = { ok: boolean; skipped?: number; conflict?: { with: string[]; files: number }; error?: string }

test('mods: add, place, switch on/off, conflicts, user files and GameBanana', async () => {
  const files = makeFiles('mods')
  const emu = path.join(files, '_fakeemu')
  const presets = makePresets(files, 300, {
    extra: {
      mods: {
        targets: [
          {
            id: 'textures',
            label: 'Texture pack',
            dir: '{emu}/textures/{basename}',
            match: '\\.png$',
            anchor: '^replacements$',
            into: 'replacements',
            enabled: { steps: [{ type: 'ini', file: '{emu}/gfx.ini', set: { GS: { LoadTextureReplacements: 'true' } } }] },
            disabled: { steps: [{ type: 'ini', file: '{emu}/gfx.ini', set: { GS: { LoadTextureReplacements: 'false' } } }] }
          },
          { id: 'patches', label: 'Patch (.pnach)', dir: '{emu}/patches', match: '\\.pnach$', flatten: true },
          { id: 'cheats', label: 'Cheat (.pnach)', dir: '{emu}/cheats', match: '\\.pnach$', flatten: true }
        ]
      }
    }
  })
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Alpha.tst'), 'a')
  fs.mkdirSync(path.join(files, 'saves', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'saves', 'testcon', 'Alpha.sav'), 'my progress')
  const tex = path.join(emu, 'textures', 'Alpha', 'replacements')

  // fake GameBanana
  const incoming = path.join(files, '_incoming')
  fs.mkdirSync(incoming, { recursive: true })
  const gbZip = path.join(incoming, 'gb.zip')
  zip(gbZip, 'HD Pack', { 'replacements/gb.png': 'from gamebanana' })
  const gbBytes = fs.readFileSync(gbZip)
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    const json = (o: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o))
    if (u.pathname === '/Util/Game/NameMatch') return json({ _aRecords: [{ _idRow: 77, _sName: 'Alpha' }] })
    if (u.pathname === '/Mod/Index') return json({ _aMetadata: { _bIsComplete: true }, _aRecords: [{ _idRow: 501, _sName: 'HD Pack', _sModelName: 'Mod', _nDownloadCount: 1234 }] })
    if (u.pathname === '/Mod/501')
      return json({
        _sName: 'HD Pack',
        _sText: 'Sharper <b>textures</b> for Alpha.<br>Enjoy!',
        _aFiles: [
          { _idRow: 9, _sFile: 'hdpack.zip', _nFilesize: gbBytes.length, _sDownloadUrl: `http://127.0.0.1:${port}/dl/9`, _sMd5Checksum: crypto.createHash('md5').update(gbBytes).digest('hex'), _sAvResult: 'clean' },
          { _idRow: 10, _sFile: 'tool.exe', _nFilesize: 5, _sDownloadUrl: `http://127.0.0.1:${port}/dl/10`, _sAvResult: 'clean' }
        ]
      })
    if (u.pathname === '/dl/9') return res.writeHead(200).end(gbBytes)
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as AddressInfo).port
  process.env.STARSTATION_GAMEBANANA_API = `http://127.0.0.1:${port}`
  const { app, page } = await launchApp(files, presets)
  delete process.env.STARSTATION_GAMEBANANA_API
  const gid = 'testcon:alpha.tst'
  try {
    await expect(page.getByTestId('game-info')).toContainText('Alpha')

    // ---- a zip texture pack: recognised by its "replacements" folder
    const packA = path.join(incoming, 'PackA.zip')
    zip(packA, 'PackA', { 'replacements/a.png': 'A', 'replacements/sub/b.png': 'B', 'readme.txt': 'hi' })
    const a = await api<Add>(page, 'modAdd', gid, packA)
    expect(a.ok).toBe(true)
    expect(fs.existsSync(path.join(files, 'mods', 'testcon', 'Alpha', a.mod!.id, 'PackA', 'replacements', 'a.png'))).toBe(true)

    // the mod manager lists it
    await page.keyboard.press(' ')
    await page.getByTestId('pitem-mods').dblclick()
    await expect(page.getByTestId('panel-mods')).toBeVisible()
    await expect(page.getByTestId(`pitem-mod-${a.mod!.id}`)).toContainText('Off')

    // switch on: files appear where the emulator looks, a save backup is made first
    expect((await api<Toggle>(page, 'modToggle', gid, a.mod!.id, true)).ok).toBe(true)
    expect(fs.readFileSync(path.join(tex, 'a.png'), 'utf8')).toBe('A')
    expect(fs.readFileSync(path.join(tex, 'sub', 'b.png'), 'utf8')).toBe('B')
    const det = await api<{ backups: { reason: string }[] }>(page, 'gameDetails', gid)
    expect(det.backups.map((b) => b.reason)).toContain('before-mod')

    // emulator setting follows: texture replacements on at launch
    expect((await api<{ ok: boolean }>(page, 'launch', gid, 'fresh')).ok).toBe(true)
    await expect(page.getByTestId('running')).toHaveCount(0, { timeout: 15_000 })
    expect(fs.readFileSync(path.join(emu, 'gfx.ini'), 'utf8')).toContain('LoadTextureReplacements = true')

    // ---- a second pack touching the same file → conflict, user picks the winner
    const packB = path.join(incoming, 'PackB')
    fs.mkdirSync(path.join(packB, 'replacements'), { recursive: true })
    fs.writeFileSync(path.join(packB, 'replacements', 'a.png'), 'B wins')
    fs.writeFileSync(path.join(packB, 'replacements', 'c.png'), 'C')
    const b = await api<Add>(page, 'modAdd', gid, packB)
    expect(b.ok).toBe(true)
    const clash = await api<Toggle>(page, 'modToggle', gid, b.mod!.id, true)
    expect(clash.conflict).toEqual({ with: ['PackA'], files: 1 })
    // keep A: B goes on without the clashing file
    expect((await api<Toggle>(page, 'modToggle', gid, b.mod!.id, true, 'other')).ok).toBe(true)
    expect(fs.readFileSync(path.join(tex, 'a.png'), 'utf8')).toBe('A')
    expect(fs.readFileSync(path.join(tex, 'c.png'), 'utf8')).toBe('C')
    // off again, then on with B winning; switching B off gives A's file back
    await api<Toggle>(page, 'modToggle', gid, b.mod!.id, false)
    expect(fs.existsSync(path.join(tex, 'c.png'))).toBe(false)
    expect(fs.readFileSync(path.join(tex, 'a.png'), 'utf8')).toBe('A')
    expect((await api<Toggle>(page, 'modToggle', gid, b.mod!.id, true, 'this')).ok).toBe(true)
    expect(fs.readFileSync(path.join(tex, 'a.png'), 'utf8')).toBe('B wins')
    await api<Toggle>(page, 'modToggle', gid, b.mod!.id, false)
    expect(fs.readFileSync(path.join(tex, 'a.png'), 'utf8')).toBe('A')

    // ---- files Starstation didn't put there are never overwritten or removed
    fs.writeFileSync(path.join(tex, 'mine.png'), 'my own file')
    const c = await api<Add>(page, 'modAdd', gid, (() => {
      const d = path.join(incoming, 'PackC')
      fs.mkdirSync(path.join(d, 'replacements'), { recursive: true })
      fs.writeFileSync(path.join(d, 'replacements', 'mine.png'), 'mod version')
      return d
    })())
    const tc = await api<Toggle>(page, 'modToggle', gid, c.mod!.id, true)
    expect(tc).toEqual({ ok: true, skipped: 1 })
    await api<Toggle>(page, 'modToggle', gid, c.mod!.id, false)
    expect(fs.readFileSync(path.join(tex, 'mine.png'), 'utf8')).toBe('my own file')

    // ---- a .pnach could be a patch or a cheat → Starstation asks
    const pn = path.join(incoming, 'infinite.pnach')
    fs.writeFileSync(path.join(pn), 'patch=1,EE,0,word,0')
    const ask = await api<Add>(page, 'modAdd', gid, pn)
    expect(ask.ok).toBe(false)
    expect(ask.ask!.targets.map((t) => t.id).sort()).toEqual(['cheats', 'patches', 'textures'])
    const placed = await api<Add>(page, 'modPlace', gid, ask.ask!.pending, 'cheats')
    expect(placed.ok).toBe(true)
    await api<Toggle>(page, 'modToggle', gid, placed.mod!.id, true)
    expect(fs.existsSync(path.join(emu, 'cheats', 'infinite.pnach'))).toBe(true)

    // ---- switching A off removes exactly its files (and empty folders); its originals stay
    await api<Toggle>(page, 'modToggle', gid, a.mod!.id, false)
    expect(fs.existsSync(path.join(tex, 'a.png'))).toBe(false)
    expect(fs.existsSync(path.join(tex, 'sub'))).toBe(false)
    expect(fs.existsSync(path.join(tex, 'mine.png'))).toBe(true)
    expect(fs.existsSync(path.join(files, 'mods', 'testcon', 'Alpha', a.mod!.id))).toBe(true)
    await api(page, 'modDelete', gid, a.mod!.id)
    expect(fs.existsSync(path.join(files, 'mods', 'testcon', 'Alpha', a.mod!.id))).toBe(false)

    // ---- GameBanana: find the game, list mods, details, install (checksum verified); .exe files are refused
    const s = await api<{ games: { id: number }[] }>(page, 'gbSearch', gid)
    expect(s.games[0].id).toBe(77)
    const list = await api<{ mods: { id: number; name: string }[] }>(page, 'gbMods', 77, 1)
    expect(list.mods[0].name).toBe('HD Pack')
    const d = await api<{ text: string; files: { id: number; ok: boolean }[] }>(page, 'gbMod', 501)
    expect(d.text).toBe('Sharper textures for Alpha.\nEnjoy!')
    expect(d.files.map((f) => f.ok)).toEqual([true, false])
    const gb = await api<Add>(page, 'gbInstall', gid, 501, 9)
    expect(gb.ok).toBe(true)
    expect(gb.mod!.source).toBe('gamebanana')
    expect((await api<Add>(page, 'gbInstall', gid, 501, 10)).ok).toBe(false)
    await api<Toggle>(page, 'modToggle', gid, gb.mod!.id, true)
    expect(fs.readFileSync(path.join(tex, 'gb.png'), 'utf8')).toBe('from gamebanana')
  } finally {
    await app.close()
    server.close()
  }
})
