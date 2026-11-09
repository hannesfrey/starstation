import { describe, expect, it } from 'vitest'
import { begin, busyWith, exclusive } from '../../src/main/busy'

/** #08: one busy list — no restore while the game starts, no profile switch while a package arrives. */
describe('busy guard', () => {
  it('game operations wait for the same game, not for other games', () => {
    const a = begin('Its saves are being restored', 'nes/zelda')
    expect('end' in a).toBe(true)
    expect(begin('A game is starting', 'nes/zelda')).toEqual({ error: 'Its saves are being restored. Try again in a moment.' })
    const b = begin('A game is starting', 'snes/mario')
    expect('end' in b).toBe(true)
    if ('end' in a) a.end()
    if ('end' in b) b.end()
    expect(busyWith('nes/zelda')).toBeNull()
  })

  it('a whole-setup operation blocks everything, and waits for everything', async () => {
    const r = begin('A package is being received')
    expect(busyWith('nes/zelda')).toBe('A package is being received')
    expect(await exclusive('A profile switch is on its way', undefined, async () => 'ran')).toEqual({ ok: false, error: 'A package is being received. Try again in a moment.' })
    if ('end' in r) r.end()

    const g = begin('Its mods are being changed', 'nes/zelda')
    expect(busyWith()).toBe('Its mods are being changed')
    if ('end' in g) g.end()
  })

  it('ends even when the operation fails', async () => {
    await expect(exclusive('x', 'a', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(busyWith('a')).toBeNull()
  })
})
