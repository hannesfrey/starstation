import { describe, expect, it } from 'vitest'
import { matchXInputPad, padDistance, parseXState, type PadLike, type XSlot } from '../../src/shared/padmatch'

/** A Chromium pad as the PS menu sees it: axes [lx, ly, rx, ry] (Y down), 17 standard buttons. */
function pad(index: number, axes: number[], pressed: number[] = [], lt = 0, rt = 0): PadLike {
  return {
    index,
    axes,
    buttons: Array.from({ length: 17 }, (_v, i) => ({ pressed: pressed.includes(i), value: i === 6 ? lt : i === 7 ? rt : pressed.includes(i) ? 1 : 0 }))
  }
}
const n = (v: number) => v / 32767

// Hannes's two DS3 pads (DsHidMini, XInput), resting, read 2026-11-08: slot 0 lx -129, slot 1 lx -1157, both ly -900
const hannes: XSlot[] = parseXState('0:-129,-900,0,0,0,0,0;1:-1157,-900,0,0,0,0,0')

describe('PS button menu: which of the menu’s pads pressed PS', () => {
  it('reads the pad helper’s xstate line', () => {
    expect(hannes).toEqual([
      { slot: 0, lx: -129, ly: -900, rx: 0, ry: 0, lt: 0, rt: 0, buttons: 0 },
      { slot: 1, lx: -1157, ly: -900, rx: 0, ry: 0, lt: 0, rt: 0, buttons: 0 }
    ])
    expect(parseXState('')).toEqual([])
    expect(parseXState('garbage;7:1,2;0:1,2,3,4,5,6,7')).toHaveLength(1)
  })

  it('Hannes’s case: Chromium numbers the pads the other way round — slot 0 is the menu’s pad 1', () => {
    const pads = [pad(0, [n(-1157), n(900), 0, 0]), pad(1, [n(-129), n(900), 0, 0])]
    expect(matchXInputPad(0, hannes, pads)).toBe(1)
    expect(matchXInputPad(1, hannes, pads)).toBe(0)
  })

  it('same order: slot = pad', () => {
    const pads = [pad(0, [n(-129), n(900), 0, 0]), pad(1, [n(-1157), n(900), 0, 0])]
    expect(matchXInputPad(0, hannes, pads)).toBe(0)
  })

  it('a player holding buttons / a trigger is told apart even when the sticks rest alike', () => {
    const slots = parseXState('0:0,0,0,0,0,0,0;1:0,0,0,0,0,255,4096') // slot 1: A + right trigger (playing)
    const pads = [pad(0, [0, 0, 0, 0], [0], 0, 1), pad(1, [0, 0, 0, 0])]
    expect(matchXInputPad(0, slots, pads)).toBe(1)
    expect(matchXInputPad(1, slots, pads)).toBe(0)
  })

  it('two pads that look the same: no guess (every pad drives the menu)', () => {
    const slots = parseXState('0:0,0,0,0,0,0,0;1:0,0,0,0,0,0,0')
    expect(matchXInputPad(0, slots, [pad(0, [0, 0, 0, 0]), pad(1, [0, 0, 0, 0])])).toBeNull()
  })

  it('counts that don’t add up, an unknown slot or no pads: no guess', () => {
    expect(matchXInputPad(0, hannes, [pad(0, [0, 0, 0, 0])])).toBeNull()
    expect(matchXInputPad(3, hannes, [pad(0, [0, 0, 0, 0]), pad(1, [0, 0, 0, 0])])).toBeNull()
    expect(matchXInputPad(0, [], [])).toBeNull()
  })

  it('one XInput pad: it is that one', () => {
    expect(matchXInputPad(2, parseXState('2:5,5,5,5,0,0,0'), [pad(3, [0, 0, 0, 0])])).toBe(3)
  })

  it('three and four players', () => {
    const slots = parseXState('0:100,0,0,0,0,0,0;1:-3000,0,0,0,0,0,0;2:0,2500,0,0,0,0,0;3:0,0,0,0,0,0,16')
    const pads = [pad(0, [0, n(-2500), 0, 0]), pad(1, [0, 0, 0, 0], [9]), pad(2, [n(100), 0, 0, 0]), pad(3, [n(-3000), 0, 0, 0])]
    expect([0, 1, 2, 3].map((s) => matchXInputPad(s, slots, pads))).toEqual([2, 3, 0, 1])
  })

  it('distance: Y points the other way, triggers and buttons count', () => {
    const s = parseXState('0:32767,32767,0,0,255,0,4096')[0]
    expect(padDistance(pad(0, [1, -1, 0, 0], [0], 1), s)).toBeCloseTo(0)
    expect(padDistance(pad(0, [1, 1, 0, 0], [0], 1), s)).toBeCloseTo(2)
    expect(padDistance(pad(0, [1, -1, 0, 0], [], 1), s)).toBeCloseTo(1)
  })
})
