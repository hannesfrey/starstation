import { describe, expect, it, vi } from 'vitest'

// panels.ts is renderer code: it reads nothing from window at import time, but its helpers may — keep it quiet
vi.stubGlobal('window', { starstation: undefined })
const { buildPanel } = await import('../../src/renderer/src/xmb/panels')
const { timed } = await import('../../src/renderer/src/api')

/** #35 a screen whose data failed to load offers "Try again" instead of "Loading…" for ever. */
describe('loading screens', () => {
  const game = { id: 'testcon:alpha.tst', console: 'testcon', title: 'Alpha', path: 'x', launchPath: 'x', kind: 'file', size: 1, addedAt: 0 }
  const state = { library: { games: [game], stats: {} }, settings: {} } as never
  const retried: string[] = []
  const h = new Proxy({} as Record<string, unknown>, {
    get: (_t, k) => (k === 'retryLoad' ? (what: string, id: string) => retried.push(`${what}:${id}`) : () => undefined)
  }) as never
  const extra = (failed?: Record<string, boolean>) => ({ details: {}, mods: {}, failed, emuProgress: {}, importing: false, gb: { page: 1, more: false, detail: {} }, pkg: { choice: {}, busy: false } }) as never

  it('backups: Loading… while waiting, Try again after a failure', () => {
    const waiting = buildPanel('backups', game.id, state, h, extra())!
    expect(waiting.items.map((i) => i.key)).toContain('loading')
    const failed = buildPanel('backups', game.id, state, h, extra({ [`details:${game.id}`]: true }))!
    const retry = failed.items.find((i) => i.key === 'retry')!
    expect(retry.label).toMatch(/Try again/)
    retry.run?.()
    expect(retried).toEqual([`details:${game.id}`])
  })

  it('mods: the same', () => {
    const failed = buildPanel('mods', game.id, state, h, extra({ [`mods:${game.id}`]: true }))!
    expect(failed.items.map((i) => i.key)).toEqual(['retry'])
  })

  it('a request that never answers fails after a while', async () => {
    await expect(timed(new Promise(() => undefined), 50)).rejects.toThrow('No answer')
    await expect(timed(Promise.resolve(3), 50)).resolves.toBe(3)
  })
})
