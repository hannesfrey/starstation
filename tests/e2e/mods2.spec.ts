import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, makePresets, writeSettings } from './helpers'

/** SPEC-v2 E: mod profiles, patch-file mods, Nexus links, manual mods. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

type View = { mods: { id: string; name: string; enabled: boolean }[]; profiles: { id: string; name: string; mods: string[] }[]; active: string | null }
const PATCH_TARGET = { mods: { targets: [{ id: 'patches', label: 'Patch (.pnach)', dir: '{emu}/patches', match: '\\.pnach$', flatten: true }] } }

test('mod profiles: Vanilla, saved sets, one-click switching, Custom after a manual change', async () => {
  const files = makeFiles('profiles')
  const emu = path.join(files, '_fakeemu')
  const presets = makePresets(files, 300, { extra: PATCH_TARGET })
  writeSettings(files, { bootAnimation: false })
  fs.mkdirSync(path.join(files, 'games', 'testcon'), { recursive: true })
  fs.writeFileSync(path.join(files, 'games', 'testcon', 'Alpha.tst'), 'a')
  const inbox = path.join(files, '_in')
  fs.mkdirSync(inbox)
  fs.writeFileSync(path.join(inbox, 'Fast.pnach'), 'fast')
  fs.writeFileSync(path.join(inbox, 'Wide.pnach'), 'wide')
  const gid = 'testcon:alpha.tst'
  const placed = (n: string) => fs.existsSync(path.join(emu, 'patches', n))
  const { app, page } = await launchApp(files, presets)
  try {
    await expect(page.getByTestId('game-info')).toContainText('Alpha')
    const fast = await api<{ mod: { id: string } }>(page, 'modAdd', gid, path.join(inbox, 'Fast.pnach'))
    const wide = await api<{ mod: { id: string } }>(page, 'modAdd', gid, path.join(inbox, 'Wide.pnach'))
    let v = await api<View>(page, 'mods', gid)
    expect(v.profiles.map((p) => p.name)).toEqual(['Vanilla'])
    expect(v.active).toBe('vanilla') // nothing on yet

    await api(page, 'modToggle', gid, fast.mod.id, true)
    await api(page, 'modProfileSave', gid, 'Fast only')
    await api(page, 'modToggle', gid, wide.mod.id, true)
    await api(page, 'modProfileSave', gid, 'Everything')
    v = await api<View>(page, 'mods', gid)
    expect(v.profiles.map((p) => p.name)).toEqual(['Vanilla', 'Fast only', 'Everything'])
    expect(v.profiles.find((p) => p.id === v.active)?.name).toBe('Everything')

    // Vanilla: everything off, the files are gone from the emulator
    expect((await api<{ ok: boolean }>(page, 'modProfileApply', gid, 'vanilla')).ok).toBe(true)
    expect([placed('Fast.pnach'), placed('Wide.pnach')]).toEqual([false, false])
    // one click back to a profile
    const fastOnly = v.profiles.find((p) => p.name === 'Fast only')!.id
    expect((await api<{ ok: boolean }>(page, 'modProfileApply', gid, fastOnly)).ok).toBe(true)
    expect([placed('Fast.pnach'), placed('Wide.pnach')]).toEqual([true, false])
    expect((await api<View>(page, 'mods', gid)).active).toBe(fastOnly)
    // a mod switched by hand: no profile matches → Custom
    await api(page, 'modToggle', gid, fast.mod.id, false)
    await api(page, 'modToggle', gid, wide.mod.id, true)
    expect((await api<View>(page, 'mods', gid)).active).toBeNull()

    // the Triangle menu shows the profile and opens the list
    await page.keyboard.press(' ')
    await expect(page.getByTestId('pitem-profile')).toContainText('Custom')
    await page.getByTestId('pitem-profile').dblclick()
    await expect(page.getByTestId('panel-mod-profiles')).toContainText('Everything')

    // a profile can be deleted; its mods stay installed
    await api(page, 'modProfileDelete', gid, fastOnly)
    v = await api<View>(page, 'mods', gid)
    expect(v.profiles.map((p) => p.name)).toEqual(['Vanilla', 'Everything'])
    expect(v.mods).toHaveLength(2)
  } finally {
    await app.close()
  }
})
