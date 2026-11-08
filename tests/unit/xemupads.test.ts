import { describe, expect, it } from 'vitest'
import { setXemuPadButtons } from '../../src/main/ini'

// Hannes's xemu.toml (2026-11-08): one entry per controller xemu has seen
const hannes = [
  '[general]',
  'show_welcome = false',
  '',
  '[input]',
  'gamepad_mappings = [',
  "    { gamepad_id = '0300fa675e0400008e02000014017801'},",
  "    { gamepad_id = '0300fa675e040000ff02000000007801'},",
  "    { gamepad_id = '0300ba665e040000ff02000000007801'}",
  '    ]',
  '',
  '[input.bindings]',
  "port1 = '0300fa675e040000ff02000000007801'",
  ''
].join('\r\n')

describe('xemu: the PS / Guide button no longer opens xemu’s own menu', () => {
  it('adds guide = -1 to every controller xemu knows, leaves the rest of the file alone', () => {
    const out = setXemuPadButtons(hannes, { guide: -1 })!
    expect(out.match(/controller_mapping = \{ guide = -1 \}/g)).toHaveLength(3)
    expect(out).toContain("{ gamepad_id = '0300fa675e0400008e02000014017801', controller_mapping = { guide = -1 } },")
    expect(out).toContain("[input.bindings]\r\nport1 = '0300fa675e040000ff02000000007801'")
    expect(out.startsWith('[general]\r\nshow_welcome = false')).toBe(true)
  })

  it('a second run changes nothing', () => {
    const once = setXemuPadButtons(hannes, { guide: -1 })!
    expect(setXemuPadButtons(once, { guide: -1 })).toBeNull()
  })

  it('keeps the user’s own button changes and replaces only guide', () => {
    const t = "gamepad_mappings = [\n  { gamepad_id = 'abc', enable_rumble = false, controller_mapping = { a = 1, b = 0, guide = 5 } }\n]\n"
    const out = setXemuPadButtons(t, { guide: -1 })!
    expect(out).toContain('controller_mapping = { a = 1, b = 0, guide = -1 }')
    expect(out).toContain('enable_rumble = false')
  })

  it('an existing mapping without guide gets it added', () => {
    const t = "gamepad_mappings = [ { gamepad_id = 'x', controller_mapping = { a = 2 } } ]\n"
    expect(setXemuPadButtons(t, { guide: -1 })).toContain('controller_mapping = { a = 2, guide = -1 }')
  })

  it('no controllers yet, no list, or a cut-off file: nothing to do', () => {
    expect(setXemuPadButtons('gamepad_mappings = []\n', { guide: -1 })).toBeNull()
    expect(setXemuPadButtons('[general]\nshow_welcome = false\n', { guide: -1 })).toBeNull()
    expect(setXemuPadButtons("gamepad_mappings = [ { gamepad_id = 'x'", { guide: -1 })).toBeNull()
  })

  it('brackets inside quoted ids don’t confuse it', () => {
    const t = "gamepad_mappings = [ { gamepad_id = 'we{ir}d]' } ]\n"
    expect(setXemuPadButtons(t, { guide: -1 })).toBe("gamepad_mappings = [ { gamepad_id = 'we{ir}d]', controller_mapping = { guide = -1 } } ]\n")
  })
})
