import { describe, expect, it } from 'vitest'
import { guideHolder, GUIDE } from '../../src/renderer/src/input'

/** A Gamepad as Chromium reports it (standard mapping, 17 buttons; 16 = Guide / PS). */
function pad(index: number, id: string, held: number[] = []): Gamepad {
  return {
    index,
    id,
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_v, i) => ({ pressed: held.includes(i), touched: held.includes(i), value: held.includes(i) ? 1 : 0 })),
    timestamp: 0,
    vibrationActuator: null
  } as unknown as Gamepad
}

describe('PS button menu: the controller that opened it', () => {
  const p1 = 'Xbox 360 Controller (XInput STANDARD GAMEPAD)'
  it('is the one holding PS / Guide', () => {
    expect(guideHolder([pad(0, p1), pad(1, p1, [GUIDE, 0])])).toBe(1)
  })
  it('nobody holding it (a short tap already let go): no guess', () => {
    expect(guideHolder([pad(0, p1, [0, 13]), pad(1, p1)])).toBeNull()
  })
  it('two holding it: no guess', () => {
    expect(guideHolder([pad(0, p1, [GUIDE]), pad(1, p1, [GUIDE])])).toBeNull()
  })
  it('a racing wheel never counts', () => {
    expect(guideHolder([pad(0, 'Logitech G29 Driving Force Racing Wheel', [GUIDE]), null, pad(2, p1)])).toBeNull()
  })
})
