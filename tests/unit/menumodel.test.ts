import { describe, expect, it } from 'vitest'
import { buildColumns, formatPlayTime, type ModelHandlers, type XItem } from '../../src/renderer/src/xmb/model'
import { DEFAULT_SETTINGS, type AppState, type ConsoleInfo, type Game, type GameStats, type ProfileInfo } from '../../src/shared/types'

/**
 * The menu is built from the library on every change. If building it throws on odd data, the whole menu can't
 * be drawn: libraries are generated with missing fields, strange titles, stats and collections pointing at
 * games that are gone, odd numbers, and many games — every column and folder must still build.
 */

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const rand = rng(1108)
const int = (n: number) => Math.floor(rand() * n)
const pick = <T>(a: readonly T[]) => a[int(a.length)]

const noop = () => undefined
const h: ModelHandlers = { openPanel: noop, command: noop, toggleFullscreen: noop, quit: noop, openSearch: noop, newCollection: noop, openPhoto: noop, newConsole: noop, switchProfile: noop, newProfile: noop }

const TITLES = ['Gran Turismo 4', '', ' ', 'ÄÖÜ ß 日本語 🎮', 'A'.repeat(500), 'The Legend of Zelda, The', '%s %d {launch}', '<b>x</b>', '\u202eevil']
const NUMBERS = [0, 1, -5, 3599, 3600, 86400 * 400, NaN, Infinity, 1e15]

function consoles(): ConsoleInfo[] {
  return ['ps2', 'ps3', 'nes', 'x-custom'].slice(0, int(4) + 1).map((id, i) => ({
    id,
    name: pick(TITLES) || id,
    short: id.toUpperCase(),
    order: i,
    icon: 'cartridge',
    emulatorId: 'e',
    emulatorName: 'Emu',
    extensions: ['.iso'],
    gameCount: int(5),
    status: pick(['ready', 'missing-emulator', 'missing-bios', 'no-games'] as const),
    statusText: 'x',
    netplay: rand() < 0.5,
    quickResume: rand() < 0.5,
    shaderHint: false,
    custom: id.startsWith('x-')
  }))
}

function state(n: number): { s: AppState; profiles: ProfileInfo[] } {
  const cons = consoles()
  const games: Game[] = Array.from({ length: n }, (_v, i) => {
    const g: Game = {
      id: `${pick(cons).id}:g${i}`,
      console: rand() < 0.05 ? 'gone-console' : pick(cons).id,
      path: `C:\\g${i}.iso`,
      launchPath: `C:\\g${i}.iso`,
      kind: pick(['file', 'folder', 'installed'] as const),
      title: pick(TITLES),
      size: pick(NUMBERS),
      addedAt: pick(NUMBERS)
    }
    if (rand() < 0.5) g.serial = pick(['SCUS-97328', '', 'BLUS30001'])
    if (rand() < 0.3) g.players = pick(NUMBERS)
    if (rand() < 0.3) g.year = pick(['2004', '', 'x'])
    return g
  })
  const stats: Record<string, GameStats> = {}
  for (const g of games) if (rand() < 0.6) stats[g.id] = { playTime: pick(NUMBERS), playCount: pick(NUMBERS), lastPlayed: rand() < 0.5 ? pick(NUMBERS) : undefined, favorite: rand() < 0.3 }
  stats['ps2:deleted-game'] = { playTime: 100, playCount: 1, lastPlayed: Date.now(), favorite: true }
  const s: AppState = {
    info: { version: '2.0.18', filesDir: 'C:\\Files', isPackaged: true, safeMode: rand() < 0.2, tester: rand() < 0.5 },
    settings: { ...DEFAULT_SETTINGS },
    consoles: cons,
    library: { games, stats },
    collections: [
      { id: 'c1', name: pick(TITLES), games: [...games.slice(0, 3).map((g) => g.id), 'missing:game'], createdAt: 0 },
      { id: 'c2', name: '', games: [], createdAt: 0 }
    ],
    running: null
  }
  const profiles: ProfileInfo[] = [
    { id: 'p1', name: pick(TITLES), icon: 'p-star', hasPin: false, main: true, guest: false, active: true },
    { id: 'guest', name: 'Guest', icon: 'guest', hasPin: false, main: false, guest: true, active: false }
  ]
  return { s, profiles }
}

/** Every item of every column, folders opened, as the user could reach them. */
function walk(items: XItem[], depth = 0): number {
  let n = 0
  for (const it of items) {
    n++
    expect(typeof it.key).toBe('string')
    expect(typeof it.label).toBe('string')
    if (it.children && depth < 4) n += walk(it.children(), depth + 1)
  }
  return n
}

describe('menu built from odd libraries', () => {
  it('builds every column and folder for 200 generated libraries', () => {
    for (let i = 0; i < 200; i++) {
      const { s, profiles } = state(int(40))
      const cols = buildColumns(s, h, [], profiles)
      expect(cols.length).toBeGreaterThan(2)
      for (const c of cols) walk(c.items)
      // keys are unique within a list (the menu remembers the selection by key)
      for (const c of cols) expect(new Set(c.items.map((x) => x.key)).size, `${c.id} #${i}`).toBe(c.items.length)
    }
  })

  it('a big library builds quickly', () => {
    const { s, profiles } = state(3000)
    const t0 = performance.now()
    const cols = buildColumns(s, h, [], profiles)
    let n = 0
    for (const c of cols) n += walk(c.items)
    expect(n).toBeGreaterThan(3000)
    expect(performance.now() - t0).toBeLessThan(1500)
  })

  it('play time text for odd numbers', () => {
    for (const v of NUMBERS) expect(formatPlayTime(v)).not.toMatch(/NaN|Infinity|-/)
    expect(formatPlayTime(0)).toBe('Not played yet')
    expect(formatPlayTime(30)).toBe('Played less than a minute')
    expect(formatPlayTime(3600 + 120)).toBe('Played 1h 2m')
  })
})
