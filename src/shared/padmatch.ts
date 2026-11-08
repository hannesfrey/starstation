/**
 * Which of the menu's controllers pressed PS? The pad helper knows the XInput slot ("xinput:1"), but Chromium
 * reads Xbox-style pads through Windows.Gaming.Input and hands every Guide / PS press to its lowest-numbered pad
 * (wgi_data_fetcher_win.cc: "Only the lowest-index WGI gamepad should receive the meta input"), so the menu
 * locked onto the wrong player (Hannes, 2026-11-08: "pressed PS on controller 1, only controller 2 moved the
 * menu"). So the slots' live state (sticks, triggers, buttons) is matched to Chromium's pads; resting sticks
 * differ a little per controller. No clear match → null (every controller drives the menu, as before).
 */

export interface XSlot {
  slot: number
  lx: number
  ly: number
  rx: number
  ry: number
  lt: number
  rt: number
  buttons: number
}

/** What the matcher needs from a Chromium Gamepad. */
export interface PadLike {
  index: number
  axes: readonly number[]
  buttons: readonly { pressed: boolean; value: number }[]
}

/** "0:lx,ly,rx,ry,lt,rt,buttons;1:…" (pad helper `xstate`) → slots. Bad parts are skipped. */
export function parseXState(text: string): XSlot[] {
  const out: XSlot[] = []
  for (const part of text.trim().split(';')) {
    const m = /^(\d):(-?\d+),(-?\d+),(-?\d+),(-?\d+),(\d+),(\d+),(\d+)$/.exec(part.trim())
    if (!m) continue
    const n = m.slice(1).map(Number)
    out.push({ slot: n[0], lx: n[1], ly: n[2], rx: n[3], ry: n[4], lt: n[5], rt: n[6], buttons: n[7] })
  }
  return out
}

// XInput button bits → standard-mapping button index (Guide left out: Chromium puts it on the wrong pad)
const BITS: [number, number][] = [
  [0x1000, 0], [0x2000, 1], [0x4000, 2], [0x8000, 3], // A B X Y
  [0x0100, 4], [0x0200, 5], // LB RB
  [0x0020, 8], [0x0010, 9], [0x0040, 10], [0x0080, 11], // Back Start LS RS
  [0x0001, 12], [0x0002, 13], [0x0004, 14], [0x0008, 15] // d-pad
]

/** How different a Chromium pad and an XInput slot look right now (0 = identical). */
export function padDistance(p: PadLike, s: XSlot): number {
  const ax = (i: number) => p.axes[i] ?? 0
  const st = (v: number) => Math.max(-1, Math.min(1, v / 32767))
  // Chromium's Y axes point down, XInput's up
  let d = Math.abs(ax(0) - st(s.lx)) + Math.abs(ax(1) + st(s.ly)) + Math.abs(ax(2) - st(s.rx)) + Math.abs(ax(3) + st(s.ry))
  d += Math.abs((p.buttons[6]?.value ?? 0) - s.lt / 255) + Math.abs((p.buttons[7]?.value ?? 0) - s.rt / 255)
  for (const [bit, i] of BITS) if (!!p.buttons[i]?.pressed !== ((s.buttons & bit) !== 0)) d += 1
  return d
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs]
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]))
}

/** Smallest total difference two pairings must have apart to trust the better one (about 2 steps of a DS3 stick). */
export const MATCH_MARGIN = 0.015

/**
 * The Chromium pad index of XInput slot `pressed`, or null when it can't be told apart for sure.
 * `pads` = the Chromium pads that are XInput controllers (same count as `slots`, else null).
 */
export function matchXInputPad(pressed: number, slots: XSlot[], pads: PadLike[]): number | null {
  if (!slots.some((s) => s.slot === pressed) || pads.length !== slots.length || !pads.length || pads.length > 4) return null
  if (pads.length === 1) return pads[0].index
  // every way of pairing the pads with the slots, cheapest first
  const scored = permutations(pads)
    .map((order) => ({ order, cost: order.reduce((n, p, i) => n + padDistance(p, slots[i]), 0) }))
    .sort((a, b) => a.cost - b.cost)
  const best = scored[0]
  const at = slots.findIndex((s) => s.slot === pressed)
  const pick = best.order[at].index
  // the pressing pad must be the same in every pairing that is about as good
  const rival = scored.find((x) => x.order[at].index !== pick)
  if (rival && rival.cost - best.cost < MATCH_MARGIN) return null
  return pick
}
