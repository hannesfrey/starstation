import { describe, expect, it } from 'vitest'
import { buttonFor, setButtonMap } from '../../src/renderer/src/input'

describe('menu button remap (Accessibility)', () => {
  it('moving an action onto a taken button swaps the two', () => {
    setButtonMap({})
    expect([buttonFor('confirm'), buttonFor('back')]).toEqual([0, 1])
    // ○ confirms, ✕ goes back (the Japanese layout)
    setButtonMap({ confirm: 1 })
    expect([buttonFor('confirm'), buttonFor('back')]).toEqual([1, 0])
    setButtonMap({ options: 9 })
    expect([buttonFor('options'), buttonFor('start')]).toEqual([9, 3])
    setButtonMap({})
    expect(buttonFor('options')).toBe(3)
  })
  it('ignores buttons that are not menu buttons', () => {
    setButtonMap({ confirm: 12 })
    expect(buttonFor('confirm')).toBe(0)
  })
})
