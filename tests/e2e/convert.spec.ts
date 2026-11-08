import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { launchApp, makeFiles, writeSettings, SOURCE } from './helpers'

/** SPEC-v2 A: conversion on import — Xbox → XISO, multi-disc playlists, PS3 packages, encrypted 3DS games. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

const XISO_TOOL = path.join(SOURCE, 'resources', 'bin', 'extract-xiso.exe')
const FSUTIL = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'fsutil.exe')

/** A full Xbox disc dump: a real (tiny) XISO made by extract-xiso, behind the 387 MB video partition (sparse file). */
function fullXboxDisc(work: string, to: string): void {
  const src = path.join(work, 'disc')
  fs.mkdirSync(src, { recursive: true })
  fs.writeFileSync(path.join(src, 'default.xbe'), 'XBEH game')
  execFileSync(XISO_TOOL, ['-c', src, path.join(work, 'small.iso')], { cwd: work, stdio: 'ignore' })
  const xiso = fs.readFileSync(path.join(work, 'small.iso'))
  fs.writeFileSync(to, '')
  execFileSync(FSUTIL, ['sparse', 'setflag', to])
  const fd = fs.openSync(to, 'r+')
  fs.writeSync(fd, xiso, 0, xiso.length, 0x18300000)
  fs.closeSync(fd)
}

test('conversion on import: Xbox disc → XISO, discs → playlist, PS3 package without RPCS3, encrypted 3DS game', async () => {
  test.setTimeout(120_000)
  const files = makeFiles('convert')
  writeSettings(files, { bootAnimation: false })
  const inbox = path.join(files, '_inbox')
  fs.mkdirSync(inbox, { recursive: true })
  const xbox = path.join(inbox, 'Big Game (USA).iso')
  fullXboxDisc(path.join(files, '_work'), xbox)
  for (const n of [1, 2]) {
    fs.writeFileSync(path.join(inbox, `Saga (USA) (Disc ${n}).bin`), `disc ${n}`)
    fs.writeFileSync(path.join(inbox, `Saga (USA) (Disc ${n}).cue`), `FILE "Saga (USA) (Disc ${n}).bin" BINARY\r\n  TRACK 01 MODE2/2352\r\n    INDEX 01 00:00:00\r\n`)
  }
  fs.writeFileSync(path.join(inbox, 'Update.pkg'), Buffer.concat([Buffer.from('\x7fPKG', 'latin1'), Buffer.alloc(60)]))
  const enc = Buffer.alloc(0x4200)
  enc.write('NCSD', 0x100, 'latin1')
  enc.writeUInt32LE(0x4000 / 0x200, 0x120)
  enc.write('NCCH', 0x4100, 'latin1')
  fs.writeFileSync(path.join(inbox, 'Locked.3ds'), enc)

  const { app, page } = await launchApp(files)
  try {
    // Xbox: converted to XISO in place, the full dump goes to the (test) Recycle Bin
    const x = await api<{ added: { path: string }[] }>(page, 'addGames', [xbox], 'xbox')
    expect(x.added).toHaveLength(1)
    const placed = path.join(files, 'games', 'xbox', 'Big Game (USA).iso')
    await expect(page.getByTestId('notices')).toContainText('Xbox game converted')
    expect(fs.statSync(placed).size).toBeLessThan(10 * 1024 * 1024)
    const head = Buffer.alloc(20)
    const fd = fs.openSync(placed, 'r')
    fs.readSync(fd, head, 0, 20, 0x10000)
    fs.closeSync(fd)
    expect(head.toString('latin1')).toBe('MICROSOFT*XBOX*MEDIA')
    expect(fs.readdirSync(path.join(files, 'config', 'test-trash')).some((n) => n.endsWith('Big Game (USA).iso'))).toBe(true)
    expect(fs.readdirSync(path.join(files, 'config', 'downloads')).filter((n) => n.startsWith('xiso-'))).toEqual([])

    // PS1 discs: one playlist, the game shows once
    await api(page, 'addGames', [path.join(inbox, 'Saga (USA) (Disc 1).cue'), path.join(inbox, 'Saga (USA) (Disc 2).cue')], 'ps1')
    const m3u = path.join(files, 'games', 'ps1', 'Saga (USA).m3u')
    await expect.poll(() => fs.existsSync(m3u)).toBe(true)
    expect(fs.readFileSync(m3u, 'utf8').trim().split(/\r?\n/)).toEqual(['Saga (USA) (Disc 1).cue', 'Saga (USA) (Disc 2).cue'])
    await api(page, 'rescan')
    const ps1 = (await api<{ library: { games: { console: string; title: string; discs?: number }[] } }>(page, 'getState')).library.games.filter((g) => g.console === 'ps1')
    expect(ps1.map((g) => g.title)).toEqual(['Saga'])
    expect(ps1[0].discs).toBe(2)

    // PS3 package without RPCS3: a clear message, the package stays
    await api(page, 'addGames', [path.join(inbox, 'Update.pkg')])
    await expect(page.getByTestId('notices')).toContainText('Install RPCS3 first')
    expect(fs.existsSync(path.join(inbox, 'Update.pkg'))).toBe(true)

    // encrypted 3DS game: added, with a clear message (and listed by the health check)
    await api(page, 'addGames', [path.join(inbox, 'Locked.3ds')], '3ds')
    await expect(page.getByTestId('notices')).toContainText('is encrypted')
    const issues = await api<{ title: string; detail?: string }[]>(page, 'health')
    expect(issues.some((i) => /encrypted/.test(i.detail ?? ''))).toBe(true)
  } finally {
    await app.close()
  }
})

test('Xbox conversion also works when the Starstation folder has Japanese / Cyrillic letters in its path', async () => {
  test.setTimeout(120_000)
  // the disc is made in a plain folder (the test tool has the same old-code-page limit), then moved in
  const plain = makeFiles('convert-src')
  const disc = path.join(plain, 'Big Game (USA).iso')
  fullXboxDisc(path.join(plain, '_work'), disc)
  const files = path.join(SOURCE, 'tools', 'cache', 'e2e', `日本 Жуков ${Date.now()}`, 'Files')
  fs.mkdirSync(path.join(files, 'config'), { recursive: true })
  fs.writeFileSync(path.join(files, 'config', 'setup.json'), JSON.stringify({ done: true }))
  writeSettings(files, { bootAnimation: false })
  const inbox = path.join(files, '_inbox')
  fs.mkdirSync(inbox, { recursive: true })
  fs.renameSync(disc, path.join(inbox, 'Big Game (USA).iso'))
  const { app, page } = await launchApp(files)
  try {
    const x = await api<{ added: { path: string }[] }>(page, 'addGames', [path.join(inbox, 'Big Game (USA).iso')], 'xbox')
    expect(x.added).toHaveLength(1)
    await expect(page.getByTestId('notices')).toContainText('Xbox game converted', { timeout: 30_000 })
    expect(fs.statSync(path.join(files, 'games', 'xbox', 'Big Game (USA).iso')).size).toBeLessThan(10 * 1024 * 1024)
  } finally {
    await app.close()
  }
})
