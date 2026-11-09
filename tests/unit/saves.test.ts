import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Save safety (2.1.0 block A): backups per profile (#02), restore that never empties the live save first (#05),
 * backups that say what really happened (#23).
 */

const SOURCE = path.resolve(__dirname, '..', '..')
const FILES = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'saves-test-'))
process.env.STARSTATION_FILES = FILES
process.env.STARSTATION_PRESETS = path.join(SOURCE, 'presets')
const { loadPresets } = await import('../../src/main/presets')
const { dir } = await import('../../src/main/paths')
const gd = await import('../../src/main/gamedata')
const profiles = await import('../../src/main/profiles')
loadPresets()
profiles.applyProfilePaths()

const nes = (title = 'Zelda') => {
  const p = path.join(FILES, 'games', 'nes', `${title}.nes`)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, 'rom')
  return { id: `nes/${title}.nes`, console: 'nes', path: p, launchPath: p, kind: 'file', title, size: 3, addedAt: 0 } as Parameters<typeof gd.backupGame>[0]
}
const saveOf = (g: { path: string }) => {
  const s = gd.saveEntries(g as never)[0]?.path
  return s ?? path.join(dir('saves', 'nes'), `${path.basename(g.path, '.nes')}.srm`)
}

describe('save backups', () => {
  it('#23 says what really happened', async () => {
    const g = nes('Report')
    expect((await gd.backupOutcome(g, 'manual')).status).toBe('no-saves')
    const sp = saveOf(g)
    fs.mkdirSync(path.dirname(sp), { recursive: true })
    fs.writeFileSync(sp, 'save 1')
    expect(gd.saveEntries(g).length).toBe(1)
    expect((await gd.backupOutcome(g, 'manual')).status).toBe('made')
    expect((await gd.backupOutcome(g, 'manual')).status).toBe('unchanged')
  })

  it('#05 a broken backup leaves the current save untouched', async () => {
    const g = nes('Broken')
    const sp = saveOf(g)
    fs.mkdirSync(path.dirname(sp), { recursive: true })
    fs.writeFileSync(sp, 'old')
    const b = (await gd.backupGame(g, 'manual'))!
    fs.writeFileSync(sp, 'current progress')
    // the backup loses its file (disk error, someone deleted it)
    for (const n of fs.readdirSync(b.folder)) if (n !== 'manifest.json') fs.rmSync(path.join(b.folder, n), { recursive: true })
    await expect(gd.restoreBackup(g, b.id)).rejects.toThrow(/Nothing was changed/)
    expect(fs.readFileSync(sp, 'utf8')).toBe('current progress')
    expect(fs.readdirSync(path.dirname(sp)).filter((n) => n.includes('.ss-'))).toEqual([])
  })

  it('#05 a good backup comes back, and the replaced save is kept as a backup', async () => {
    const g = nes('Good')
    const sp = saveOf(g)
    fs.mkdirSync(path.dirname(sp), { recursive: true })
    fs.writeFileSync(sp, 'level 1')
    const b = (await gd.backupGame(g, 'manual'))!
    fs.writeFileSync(sp, 'level 9')
    await gd.restoreBackup(g, b.id)
    expect(fs.readFileSync(sp, 'utf8')).toBe('level 1')
    expect(gd.listBackups(g).some((x) => x.reason === 'before-restore')).toBe(true)
    expect(fs.readdirSync(path.dirname(sp)).filter((n) => n.includes('.ss-'))).toEqual([])
  })

  it('#02 each profile sees only its own backups', async () => {
    const g = nes('Shared')
    const sp = saveOf(g)
    fs.mkdirSync(path.dirname(sp), { recursive: true })
    fs.writeFileSync(sp, 'big brother')
    await gd.backupGame(g, 'manual')
    expect(gd.listBackups(g).length).toBe(1)

    profiles.addProfile('Sister')
    const sister = profiles.listProfiles().find((p) => p.name === 'Sister')!
    expect((await profiles.switchProfile(sister.id)).ok).toBe(true)
    expect(gd.listBackups(g)).toEqual([])
    const sp2 = saveOf(g)
    expect(sp2).not.toBe(sp)
    fs.mkdirSync(path.dirname(sp2), { recursive: true })
    fs.writeFileSync(sp2, 'sister')
    await gd.backupGame(g, 'manual')
    expect(gd.listBackups(g).length).toBe(1)

    const main = profiles.listProfiles().find((p) => p.main)!
    expect((await profiles.switchProfile(main.id)).ok).toBe(true)
    expect(gd.listBackups(g).length).toBe(1)
    expect(fs.readFileSync(sp, 'utf8')).toBe('big brother')
  })
})

describe('profile switch', () => {
  it('#04 a leftover copy in the store is put aside, not allowed to keep the live saves in place', async () => {
    const main = profiles.listProfiles().find((p) => p.main)!
    const brother = profiles.listProfiles().find((p) => p.name === 'Sister')!
    expect(profiles.activeProfile()).toBe(main.id)
    const hdd = dir('bios', 'xbox', 'xbox_hdd.qcow2')
    fs.mkdirSync(path.dirname(hdd), { recursive: true })
    fs.writeFileSync(hdd, 'main hdd')
    const stale = dir('config', 'profiles', main.id, 'emulator-saves', 'xbox-hdd.qcow2')
    fs.mkdirSync(path.dirname(stale), { recursive: true })
    fs.writeFileSync(stale, 'stale copy')

    expect((await profiles.switchProfile(brother.id)).ok).toBe(true)
    expect(fs.existsSync(hdd)).toBe(false) // the sister starts with her own (none yet), not with main's disk
    expect(fs.readFileSync(stale, 'utf8')).toBe('main hdd')
    const kept = fs.readdirSync(path.dirname(stale)).filter((n) => n.includes('.leftover-'))
    expect(kept.length).toBe(1)
    expect(fs.readFileSync(path.join(path.dirname(stale), kept[0]), 'utf8')).toBe('stale copy')
    expect(profiles.switchPending()).toBe(false)

    expect((await profiles.switchProfile(main.id)).ok).toBe(true)
    expect(fs.readFileSync(hdd, 'utf8')).toBe('main hdd')
  })

  it('#03 a switch cut off after the moves (before the profile was saved) is finished at the next start', async () => {
    const main = profiles.listProfiles().find((p) => p.main)!
    const sister = profiles.listProfiles().find((p) => p.name === 'Sister')!
    fs.writeFileSync(dir('config', 'profiles-switch.json'), JSON.stringify({ from: main.id, to: sister.id, steps: [] }))
    expect(profiles.switchPending()).toBe(true)
    await profiles.finishInterruptedSwitch()
    expect(profiles.activeProfile()).toBe(sister.id)
    expect(profiles.switchPending()).toBe(false)
  })
})
