import { describe, expect, it } from 'vitest'
import { setIniValues, setKvValues } from '../../src/main/ini'

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
