import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setIniValues, setKvValues, setYamlPlayers, stripLines } from '../../src/main/ini'
import { fatalLines } from '../../src/main/formats/emulog'

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

describe('setYamlPlayers: buttons that are always set (the PS button stays with Starstation)', () => {
  const yml = ['Player 1 Input:', '  Handler: XInput', '  Device: "XInput Pad #1"', '  Config:', '    Start: Start', '    PS Button: Guide', '    Cross: A', '  Buddy Device: ""', 'Player 2 Input:', '  Handler: "Null"', ''].join('\n')
  const cfg = { 'PS Button': '""' }
  it('same handler: only that button changes, the rest of the list stays', () => {
    const out = setYamlPlayers(yml, [{ Handler: 'XInput', Device: '"XInput Pad #1"' }], cfg)
    expect(out.split('\n').slice(0, 9)).toEqual(['Player 1 Input:', '  Handler: XInput', '  Device: "XInput Pad #1"', '  Config:', '    Start: Start', '    PS Button: ""', '    Cross: A', '  Buddy Device: ""', 'Player 2 Input:'])
  })
  it('other handler: the new block already has it unbound (RPCS3 fills in the rest)', () => {
    const out = setYamlPlayers(yml, [{ Handler: 'DualShock 3', Device: '"DS3 Pad #1"' }], cfg)
    expect(out.split('\n').slice(0, 6)).toEqual(['Player 1 Input:', '  Handler: DualShock 3', '  Device: "DS3 Pad #1"', '  Config:', '    PS Button: ""', 'Player 2 Input:'])
  })
  it('a block without a button list gets one with just that button', () => {
    const out = setYamlPlayers('Player 1 Input:\n  Handler: XInput\n  Device: "XInput Pad #1"\n', [{ Handler: 'XInput', Device: '"XInput Pad #2"' }], cfg)
    expect(out).toBe('Player 1 Input:\n  Handler: XInput\n  Device: "XInput Pad #2"\n  Config:\n    PS Button: ""\n')
  })
  // 2026-11-07: Black Ops II's player 2 went from "Null" to XInput with only the PS button line,
  // so RPCS3 gave it controller ID 0 instead of a PS3 controller's
  it('a new player copies the full settings of a player with the same handler', () => {
    const out = setYamlPlayers(
      yml,
      [{ Handler: 'XInput', Device: '"XInput Pad #1"' }, { Handler: 'XInput', Device: '"XInput Pad #2"' }],
      cfg,
      { 'Vendor ID': '1356' }
    )
    expect(out.split('\n').slice(8)).toEqual(['Player 2 Input:', '  Handler: XInput', '  Device: "XInput Pad #2"', '  Config:', '    Start: Start', '    PS Button: ""', '    Cross: A', ''])
  })
  it('without a player to copy, a new block gets the fresh keys', () => {
    const out = setYamlPlayers(yml, [{ Handler: 'DualShock 4', Device: '"DS4 Pad #1"' }], cfg, { 'Vendor ID': '1356', 'Product ID': '616' })
    expect(out.split('\n').slice(0, 8)).toEqual(['Player 1 Input:', '  Handler: DualShock 4', '  Device: "DS4 Pad #1"', '  Config:', '    Vendor ID: 1356', '    Product ID: 616', '    PS Button: ""', 'Player 2 Input:'])
  })
  it('the real PS3 preset gives new players a PS3 controller ID', () => {
    const ps3 = JSON.parse(readFileSync(new URL('../../presets/consoles/ps3.json', import.meta.url), 'utf8'))
    const step = ps3.controls.find((c: { type: string }) => c.type === 'yaml-players')
    expect(step.fresh).toEqual({ 'Vendor ID': '1356', 'Product ID': '616' })
  })
  it('missing button is added to the existing list', () => {
    const out = setYamlPlayers('Player 1 Input:\n  Handler: XInput\n  Device: "X"\n  Config:\n    Cross: A\n  Buddy Device: ""\n', [{ Handler: 'XInput', Device: '"X"' }], cfg)
    expect(out).toBe('Player 1 Input:\n  Handler: XInput\n  Device: "X"\n  Config:\n    Cross: A\n    PS Button: ""\n  Buddy Device: ""\n')
  })
})

describe('stripLines (RetroArch controller profiles without the Guide → menu button)', () => {
  const MATCH = String.raw`^\s*input_menu_toggle_btn\s*=`
  it('drops only the matching lines and keeps the line endings', () => {
    const cfg = 'input_device = "XInput Controller"\r\ninput_menu_toggle_btn = "10"\r\ninput_menu_toggle_btn_label = "Guide"\r\ninput_a_btn = "1"\r\n'
    expect(stripLines(cfg, MATCH)).toBe('input_device = "XInput Controller"\r\ninput_menu_toggle_btn_label = "Guide"\r\ninput_a_btn = "1"\r\n')
  })
  it('null when there is nothing to change (the file is not rewritten)', () => {
    expect(stripLines('input_a_btn = "1"\n', MATCH)).toBeNull()
  })
})

describe('fatalLines (emulator logs)', () => {
  it("finds RPCS3's fatal lines without their timestamp", () => {
    const text = ['·! 0:00:00.1 SYS: booting', '·E 0:00:01.2 sys_fs: not found', '·F 0:12:03.456789 {PPU[0x1000000] main_thread} VM: Access violation reading location 0x0', ''].join('\n')
    const FATAL = String.raw`^·F \S+ (.*)$` // as in presets/emulators/rpcs3.json
    expect(fatalLines(text, FATAL)).toEqual(['{PPU[0x1000000] main_thread} VM: Access violation reading location 0x0'])
    expect(fatalLines('·E 0:00:01.2 nothing fatal', FATAL)).toEqual([])
    const preset = JSON.parse(readFileSync(new URL('../../presets/emulators/rpcs3.json', import.meta.url), 'utf8'))
    expect(preset.log.fatal).toBe(FATAL)
  })
  // 2026-11-07: RPCS3 refused "Prefer borderless fullscreen" (its GUI label) at every start
  it('finds the settings RPCS3 refused', () => {
    const preset = JSON.parse(readFileSync(new URL('../../presets/emulators/rpcs3.json', import.meta.url), 'utf8'))
    const line = "·E 0:00:00.111469 CFG: cfg::try_to_enum_value('Prefer borderless fullscreen', 'Exclusive Fullscreen Mode'): invalid enum or integer"
    expect(fatalLines(line, preset.log.config)).toEqual(["cfg::try_to_enum_value('Prefer borderless fullscreen', 'Exclusive Fullscreen Mode'): invalid enum or integer"])
    expect(fatalLines('·E 0:00:08.3 SYS: sceNpInit failed', preset.log.config)).toEqual([])
  })
  it('the PS3 preset writes a fullscreen mode RPCS3 accepts (Automatic / Disable / Enable)', () => {
    const ps3 = JSON.parse(readFileSync(new URL('../../presets/consoles/ps3.json', import.meta.url), 'utf8'))
    const kv = ps3.config.find((s: { set?: Record<string, string> }) => s.set && 'Exclusive Fullscreen Mode' in s.set)
    expect(['Automatic', 'Disable', 'Enable']).toContain(kv.set['Exclusive Fullscreen Mode'])
  })
})
