import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The menu's controller source (renderer pads.ts) with a fake bridge and a fake Chromium. */
async function load(feed: unknown, chromium: unknown[] = []) {
  vi.resetModules()
  let push: ((p: unknown) => void) | null = null
  const getGamepads = vi.fn(() => chromium)
  ;(globalThis as Record<string, unknown>).window = {
    setTimeout: () => 0,
    starstation: { on: (_c: string, cb: (p: unknown) => void) => ((push = cb), () => undefined), xpadsNow: () => Promise.resolve(feed) }
  }
  vi.stubGlobal('navigator', { getGamepads })
  const m = await import('../../src/renderer/src/pads')
  expect(m.getPads()).toEqual([]) // hooks the bridge; nothing until the pad helper answers
  expect(getGamepads).not.toHaveBeenCalled()
  await new Promise((r) => setTimeout(r, 0))
  return { m, getGamepads, push: (p: unknown) => push?.(p) }
}

const ds4 = { index: 0, id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: [], timestamp: 0 }
const xboxInChromium = { index: 1, id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: [], timestamp: 0 }
const slots = [
  { slot: 0, lx: 32767, ly: 32767, rx: 0, ry: 0, lt: 255, rt: 0, buttons: 0x1000 | 0x0010 | 0x0400 },
  { slot: 1, lx: -1157, ly: -900, rx: 0, ry: 0, lt: 0, rt: 0, buttons: 0 }
]

describe('menu controllers: Xbox-style pads from the pad helper, Chromium only when needed', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('turns pad helper slots into standard pads numbered by XInput slot (Y axes flipped, triggers, PS)', async () => {
    const { m } = await load({ slots, hid: 0 })
    const pads = m.getPads()
    expect(pads.map((p) => p!.index)).toEqual([0, 1])
    const p0 = pads[0]!
    expect(p0.xinputSlot).toBe(0)
    expect(p0.axes[0]).toBe(1)
    expect(p0.axes[1]).toBe(-1) // stick up = -1 in the Gamepad API
    expect(p0.buttons[0].pressed).toBe(true) // A
    expect(p0.buttons[9].pressed).toBe(true) // Start
    expect(p0.buttons[16].pressed).toBe(true) // Guide / PS
    expect(p0.buttons[6].value).toBe(1) // left trigger
    expect(p0.buttons[1].pressed).toBe(false)
    expect(m.padHelperFeeds()).toBe(true)
  })

  it('no PlayStation pad on HID: Chromium is never asked (its reading is what made the menu slow)', async () => {
    const { m, getGamepads } = await load({ slots, hid: 0 }, [ds4])
    for (let i = 0; i < 10; i++) m.getPads()
    expect(getGamepads).not.toHaveBeenCalled()
  })

  it('a PlayStation pad on HID: added from Chromium (numbered 10+), its Xbox-style copies left out', async () => {
    const { m } = await load({ slots: [slots[0]], hid: 1 }, [ds4, xboxInChromium])
    const pads = m.getPads()
    expect(pads.map((p) => p!.index)).toEqual([0, 10])
    expect(pads[1]!.id).toContain('054c')
  })

  it('pad helper not running (or a hidden test run): Chromium as before', async () => {
    const off = await load({ slots: [], hid: 0, off: true }, [ds4])
    expect(off.m.getPads()).toEqual([ds4])
    expect(off.m.padHelperFeeds()).toBe(false)
    const none = await load(null, [xboxInChromium])
    expect(none.m.getPads()).toEqual([xboxInChromium])
  })

  it('follows the stream: a pad unplugged, then the helper stopping', async () => {
    const { m, push } = await load({ slots, hid: 0 }, [ds4])
    push({ slots: [slots[1]], hid: 0 })
    expect(m.getPads().map((p) => p!.index)).toEqual([1])
    push({ slots: [], hid: 0, off: true })
    expect(m.getPads()).toEqual([ds4])
  })
})

describe('menu controllers read through SDL (PS4/PS5, Switch, 8BitDo, generic)', () => {
  it('become standard pads numbered 10+, named with their maker so the menu shows the right buttons', async () => {
    const dualsense = { slot: 10, lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, buttons: 0x2000 | 0x0400 }
    const info = { 10: { vendor: '054c', product: '0ce6', type: 6, kind: 'gamepad', name: 'DualSense Wireless Controller' } }
    const { m } = await load({ slots: [slots[0], dualsense], hid: 0, info })
    const pads = m.getPads()
    expect(pads.map((p) => p!.index)).toEqual([0, 10])
    expect(pads[1]!.id).toBe('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')
    expect(pads[1]!.xinputSlot).toBeUndefined()
    expect(pads[1]!.buttons[1].pressed).toBe(true) // ○ / east
    expect(pads[1]!.buttons[16].pressed).toBe(true) // PS
    expect(pads[0]!.xinputSlot).toBe(0)
  })

  it('the stream format carries two-digit numbers', async () => {
    const { parseXState } = await import('../../src/shared/padmatch')
    expect(parseXState('0:1,2,3,4,5,6,7;12:-1,-2,-3,-4,0,255,4096').map((s) => s.slot)).toEqual([0, 12])
  })
})
