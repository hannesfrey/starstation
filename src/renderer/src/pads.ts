import type { XSlot } from '../../shared/padmatch'

/**
 * The controllers the menu reads. Xbox-style (XInput) pads come from Starstation's pad helper, not from Chromium:
 * Chromium's Windows controller reading asks Windows about every EMPTY XInput slot about 60 times a second, and
 * on some PCs that takes ~70 ms per slot (Hannes, 2026-11-08, two DsHidMini pads: the menu reacted "like with
 * ping" and Starstation used over a CPU core). The pad helper reads connected pads every 16 ms and looks for new
 * ones every 2 s on the side. Chromium is asked only when a PlayStation pad is plugged in directly (DS4 /
 * DualSense over HID — the pad helper counts those), or when the pad helper isn't running (tests, a crash).
 */

/** A pad the menu can read: Chromium's Gamepad, or one made from the pad helper (xinputSlot = its XInput slot). */
export type MenuPad = Gamepad & { xinputSlot?: number }

interface PadInfo {
  vendor: string
  product: string
  type: number
  kind: 'gamepad' | 'joystick'
  name: string
}

interface Feed {
  slots: XSlot[]
  /** Pads read through SDL (10+): name and maker, so the menu shows the right button icons. */
  info?: Record<number, PadInfo>
  /** PlayStation pads on HID the pad helper sees. */
  hid: number
  /** The pad helper isn't running: Chromium only. */
  off?: boolean
}

let feed: Feed | null = null
let hooked = false
// until the first answer: even one call to Chromium's getGamepads() starts its slow polling for good
let waiting = true

type Bridge = { on?: (c: string, cb: (p: unknown) => void) => () => void; xpadsNow?: () => Promise<Feed | null> }

function hook(): void {
  if (hooked) return
  hooked = true
  const api = (window as unknown as { starstation?: Bridge }).starstation
  if (!api?.on) {
    waiting = false
    return
  }
  const done = () => (waiting = false)
  window.setTimeout?.(done, 1000) // no answer within a second: Chromium after all
  api.on('xpads', (p) => {
    feed = p as Feed
    done()
  })
  void api
    .xpadsNow?.()
    .then((f) => {
      if (f && !feed) feed = f
    })
    .catch(() => undefined)
    .finally(done)
}

const XINPUT_ID = 'Xbox 360 Controller (XInput STANDARD GAMEPAD)'
const XINPUT = /xinput|xbox|vendor: 045e/i
// XInput button bits → standard-mapping button index
const BITS: [number, number][] = [
  [0x1000, 0], [0x2000, 1], [0x4000, 2], [0x8000, 3], [0x0100, 4], [0x0200, 5],
  [0x0020, 8], [0x0010, 9], [0x0040, 10], [0x0080, 11],
  [0x0001, 12], [0x0002, 13], [0x0004, 14], [0x0008, 15], [0x0400, 16]
]

/** A pad helper slot as a standard-mapping Gamepad (index = XInput slot, so the PS menu and player screen know it). */
export function virtualPad(s: XSlot, info?: PadInfo): MenuPad {
  const off = { pressed: false, touched: false, value: 0 }
  const buttons = Array.from({ length: 17 }, () => off)
  for (const [bit, i] of BITS) if (s.buttons & bit) buttons[i] = { pressed: true, touched: true, value: 1 }
  const trig = (v: number) => ({ pressed: v > 30, touched: v > 0, value: v / 255 })
  buttons[6] = trig(s.lt)
  buttons[7] = trig(s.rt)
  const n = (v: number) => Math.max(-1, Math.min(1, v / 32767))
  return {
    index: s.slot,
    // XInput slots 0-3: an Xbox-style pad; SDL pads (10+): named like a browser names them, maker ids included
    id: s.slot < 10 || !info ? XINPUT_ID : `${info.name} (STANDARD GAMEPAD Vendor: ${info.vendor} Product: ${info.product})`,
    connected: true,
    mapping: 'standard',
    // Gamepad Y axes point down, XInput's up
    axes: [n(s.lx), -n(s.ly), n(s.rx), -n(s.ry)],
    buttons,
    timestamp: performance.now(),
    vibrationActuator: null,
    xinputSlot: s.slot < 10 ? s.slot : undefined
  } as unknown as MenuPad
}

/** Chromium pad, numbered after the pad helper's (10+) so the two never share a number. */
function shifted(p: Gamepad): MenuPad {
  return { index: 10 + p.index, id: p.id, connected: p.connected, mapping: p.mapping, axes: p.axes, buttons: p.buttons, timestamp: p.timestamp, vibrationActuator: p.vibrationActuator } as unknown as MenuPad
}

function chromium(): (Gamepad | null)[] {
  return navigator.getGamepads ? [...navigator.getGamepads()] : []
}

/** Every controller the menu should read now. */
export function getPads(): (MenuPad | null)[] {
  hook()
  if (!feed && waiting) return []
  if (!feed || feed.off) return chromium()
  const info = feed.info ?? {}
  const pads: MenuPad[] = feed.slots.map((s) => virtualPad(s, info[s.slot]))
  // Chromium only for PlayStation pads on HID (it would also list the Xbox-style ones again)
  if (feed.hid > 0) for (const p of chromium()) if (p && p.connected && !XINPUT.test(p.id)) pads.push(shifted(p))
  return pads
}

/** True while Xbox-style pads come from the pad helper (index = XInput slot). */
export function padHelperFeeds(): boolean {
  return !!feed && !feed.off
}
