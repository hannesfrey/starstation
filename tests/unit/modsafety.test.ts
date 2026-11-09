import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Mods (2.1.0 block A): files only inside their folders (#06), no delete when switching off failed (#14). */

const SOURCE = path.resolve(__dirname, '..', '..')
const FILES = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'modsafety-'))
process.env.STARSTATION_FILES = FILES
process.env.STARSTATION_PRESETS = path.join(SOURCE, 'presets')
const { loadPresets } = await import('../../src/main/presets')
const { insideOf } = await import('../../src/main/fsutil')
const mods = await import('../../src/main/mods')
loadPresets()

describe('insideOf', () => {
  const root = path.join(FILES, 'root')
  it('keeps paths inside', () => {
    expect(insideOf(root, 'a/b.png')).toBe(path.join(root, 'a', 'b.png'))
    expect(insideOf(root, 'a/../b.png')).toBe(path.join(root, 'b.png'))
    expect(insideOf(root, '..foo/x')).toBe(path.join(root, '..foo', 'x'))
  })
  it('refuses paths that leave', () => {
    for (const bad of ['../x', 'a/../../x', 'C:\\Windows\\x', 'C:x', '\\\\server\\share\\x', '/etc/x', '', '.', 'a\0b']) expect(insideOf(root, bad), bad).toBeNull()
  })
})

const ps2 = () => {
  const p = path.join(FILES, 'games', 'ps2', 'Game.iso')
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, 'iso')
  return { id: 'ps2/game.iso', console: 'ps2', path: p, launchPath: p, kind: 'file', title: 'Game', serial: 'SLUS-00001', size: 3, addedAt: 0 } as never
}

function plantMod(g: never, files: string[], placement: string[], enabled = false) {
  const root = mods.modsRoot(g)
  fs.mkdirSync(path.join(root, 'm1'), { recursive: true })
  for (const f of files) {
    const p = path.join(root, 'm1', f)
    if (!p.startsWith(path.join(root, 'm1'))) continue
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, 'tex')
  }
  fs.writeFileSync(
    path.join(root, 'mods.json'),
    JSON.stringify({ mods: [{ id: 'm1', name: 'Mod', target: 'textures', enabled, files, placement, source: { type: 'file' }, addedAt: 0 }], owners: {} })
  )
}

describe('mod files stay in their folders (#06)', () => {
  it('a mod list that points outside is not switched on, and nothing is written outside', async () => {
    const g = ps2()
    const victim = path.join(FILES, 'victim.txt')
    plantMod(g, ['a.png'], ['..\\..\\..\\victim.txt'])
    const r = await mods.setModEnabled(g, 'm1', true)
    expect(r.ok).toBe(false)
    expect(fs.existsSync(victim)).toBe(false)
  })

  it('switching off never deletes outside the target folder', async () => {
    const g = ps2()
    const victim = path.join(FILES, 'keep-me.txt')
    fs.writeFileSync(victim, 'mine')
    plantMod(g, ['a.png'], ['..\\..\\..\\keep-me.txt'], true)
    const st = JSON.parse(fs.readFileSync(path.join(mods.modsRoot(g), 'mods.json'), 'utf8'))
    st.owners[victim.toLowerCase()] = 'm1'
    fs.writeFileSync(path.join(mods.modsRoot(g), 'mods.json'), JSON.stringify(st))
    await mods.setModEnabled(g, 'm1', false)
    expect(fs.readFileSync(victim, 'utf8')).toBe('mine')
  })

  it('a normal mod still goes on and off', async () => {
    const g = ps2()
    plantMod(g, ['replacements/a.png'], ['replacements/a.png'])
    expect((await mods.setModEnabled(g, 'm1', true)).ok).toBe(true)
    const placed = mods.listMods(g)[0]
    expect(placed.enabled).toBe(true)
    expect((await mods.setModEnabled(g, 'm1', false)).ok).toBe(true)
  })
})

describe('deleting a mod (#14)', () => {
  it('is refused while its files cannot be taken out, and the mod stays', async () => {
    const g = ps2()
    plantMod(g, ['replacements/b.png'], ['replacements/b.png'])
    expect((await mods.setModEnabled(g, 'm1', true)).ok).toBe(true)
    // the placed file is held open by another program: make its folder impossible to delete from
    const st = JSON.parse(fs.readFileSync(path.join(mods.modsRoot(g), 'mods.json'), 'utf8'))
    const placedPath = Object.keys(st.owners)[0]
    const real = fs.readdirSync(path.dirname(placedPath)).map((n) => path.join(path.dirname(placedPath), n))[0]
    fs.rmSync(real)
    fs.mkdirSync(real) // a folder with something in it where the file was: rmSync(file) fails
    fs.writeFileSync(path.join(real, 'x'), 'x')
    const r = await mods.deleteMod(g, 'm1')
    expect(r.ok).toBe(false)
    expect(mods.listMods(g).map((m) => m.id)).toEqual(['m1'])
    expect(fs.existsSync(path.join(mods.modsRoot(g), 'm1'))).toBe(true)
  })
})
