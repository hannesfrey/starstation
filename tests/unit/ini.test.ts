import { describe, expect, it } from 'vitest'
import { setIniValues, setKvValues, setYamlPlayers } from '../../src/main/ini'

describe('ini lists and YAML indentation', () => {
  it('writes one line per value and replaces the old lines in place', () => {
    const before = '[Hotkeys]\r\nOpenPauseMenu = Keyboard/Escape\r\nScreenshot = Keyboard/F8\r\nTogglePause = Keyboard/Space\r\n'
    const after = setIniValues(before, { Hotkeys: { Screenshot: ['Keyboard/F12', '', 'SDL-0/Touchpad'] } })
    expect(after).toBe('[Hotkeys]\r\nOpenPauseMenu = Keyboard/Escape\r\nScreenshot = Keyboard/F12\r\nScreenshot = SDL-0/Touchpad\r\nTogglePause = Keyboard/Space\r\n')
    // running it again changes nothing
    expect(setIniValues(after, { Hotkeys: { Screenshot: ['Keyboard/F12', '', 'SDL-0/Touchpad'] } })).toBe(after)
    // fewer values later: the extra line goes away
    expect(setIniValues(after, { Hotkeys: { Screenshot: ['Keyboard/F12'] } })).toBe('[Hotkeys]\r\nOpenPauseMenu = Keyboard/Escape\r\nScreenshot = Keyboard/F12\r\nTogglePause = Keyboard/Space\r\n')
  })
  it('adds a list to a new section', () => {
    expect(setIniValues('', { Hotkeys: { Screenshot: ['Keyboard/F12'] } })).toBe('[Hotkeys]\nScreenshot = Keyboard/F12\n')
  })
  it('keeps YAML indentation when changing a nested key', () => {
    const yml = 'Video:\n  Renderer: Vulkan\n  Resolution Scale: 150\nAudio:\n  Volume: 100\n'
    expect(setKvValues(yml, { 'Resolution Scale': '200' }, ': ')).toBe('Video:\n  Renderer: Vulkan\n  Resolution Scale: 200\nAudio:\n  Volume: 100\n')
  })
})

import { parseBattery } from '../../src/main/formats/xinput'
describe('controller battery (XInput)', () => {
  it('reads wired, levels and missing pads', () => {
    expect(parseBattery('0 1 3\r\n')).toEqual({ level: null, wired: true }) // DS3 via SCP reports wired
    expect(parseBattery('0 2 1')).toEqual({ level: 30, wired: false })
    expect(parseBattery('0 2 3')).toEqual({ level: 100, wired: false })
    expect(parseBattery('1167 0 0')).toBeNull() // no controller
    expect(parseBattery('')).toBeNull()
  })
})

describe('setYamlPlayers (RPCS3 input config)', () => {
  const yml = ['Player 1 Input:', '  Handler: XInput', '  Device: "XInput Pad #1"', '  Config:', '    Cross: A', '    Circle: B', 'Player 2 Input:', '  Handler: "Null"', '  Device: "Null"', ''].join('\n')
  it('same handler: only the device changes, the button list stays', () => {
    const out = setYamlPlayers(yml, [{ Handler: 'XInput', Device: '"XInput Pad #2"' }])
    expect(out).toContain('  Device: "XInput Pad #2"')
    expect(out).toContain('    Cross: A')
  })
  it('other handler: the old button list is dropped (RPCS3 uses its defaults for the new pad)', () => {
    const out = setYamlPlayers(yml, [{ Handler: 'DualShock 4', Device: '"DS4 Pad #1"' }])
    expect(out.split('\n').slice(0, 4)).toEqual(['Player 1 Input:', '  Handler: DualShock 4', '  Device: "DS4 Pad #1"', 'Player 2 Input:'])
    expect(out).not.toContain('Cross: A')
  })
  it('adds missing players at the end', () => {
    const out = setYamlPlayers('', [{ Handler: 'XInput', Device: '"XInput Pad #1"' }, { Handler: 'XInput', Device: '"XInput Pad #2"' }])
    expect(out).toBe('Player 1 Input:\n  Handler: XInput\n  Device: "XInput Pad #1"\nPlayer 2 Input:\n  Handler: XInput\n  Device: "XInput Pad #2"\n')
  })
})
