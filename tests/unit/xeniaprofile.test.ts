import { describe, expect, it } from 'vitest'
import { quoted, xeniaSlots, XUID } from '../../src/main/formats/xeniaprofile'

const hannes = 'E03000005A8B21C9'
const other = 'E030000016C622BD'
const profiles = [
  { xuid: other, mtime: 100 },
  { xuid: hannes, mtime: 50 }
]

describe('Xenia: player 1 is signed in at start', () => {
  it('Hannes’s case: his profile sat in slot 1 → moved to slot 0, not doubled', () => {
    expect(xeniaSlots(['', hannes, '', ''], profiles)).toEqual([hannes, '', '', ''])
  })
  it('nobody signed in → the most recently used profile', () => {
    expect(xeniaSlots(['', '', '', ''], profiles)).toEqual([other, '', '', ''])
  })
  it('player 1 already signed in → left alone (also other players)', () => {
    expect(xeniaSlots([hannes, other, '', ''], profiles)).toBeNull()
  })
  it('slot 0 names a profile that is gone → replaced', () => {
    expect(xeniaSlots(['E0300000DEADBEEF', '', '', ''], profiles)).toEqual([other, '', '', ''])
  })
  it('no profiles yet → nothing (Xenia asks once; the next start signs that one in)', () => {
    expect(xeniaSlots(['', '', '', ''], [])).toBeNull()
  })
  it('reads the quoted id out of a line with Xenia’s comment', () => {
    expect(quoted(`"${hannes}"   \t# XUID of the profile to load on boot in slot 1`)).toBe(hannes)
    expect(quoted('""   # comment')).toBe('')
    expect(quoted(undefined)).toBe('')
    expect(XUID.test(hannes)).toBe(true)
    expect(XUID.test('FFFE07D1')).toBe(false)
  })
})
