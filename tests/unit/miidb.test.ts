import { describe, expect, it } from 'vitest'
import { crc16, emptyMiiDb, isMiiDb, MII_DB_SIZE, ownedMiiCount, starstationMii, withOneMii } from '../../src/main/formats/miidb'

describe('3DS Mii database', () => {
  it('builds the empty database the way a game does (size, sections, both checksums)', () => {
    const db = emptyMiiDb()
    expect(db.length).toBe(MII_DB_SIZE)
    expect(db.toString('latin1', 0, 4)).toBe('CFOG')
    expect([...db.subarray(4, 8)]).toEqual([0x00, 0x01, 0x00, 0x00])
    expect(db.toString('latin1', 0x23f8, 0x23fc)).toBe('CFHE')
    expect([...db.subarray(0x2400, 0x2400 + 0xe)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0x7f, 0xff, 0x7f])
    expect(db.toString('latin1', 0xc820, 0xc824)).toBe('CFRA')
    // a CRC over a block including its stored (big-endian) CRC is 0 — what games check
    expect(crc16(db, 0, 0xc820)).toBe(0)
    expect(crc16(db, 0xc820, 0xe4c0)).toBe(0)
    // the bytes Mario Kart 7 wrote into its own empty database
    expect(db.readUInt16BE(0xc81e)).toBe(0x6308)
    expect(db.readUInt16BE(0xe4be)).toBe(0x4f53)
    expect(ownedMiiCount(db)).toBe(0)
  })

  it('puts one Mii into an empty or missing database, never into one that has Miis', () => {
    const one = withOneMii(emptyMiiDb())!
    expect(isMiiDb(one)).toBe(true)
    expect(ownedMiiCount(one)).toBe(1)
    expect(one.toString('utf16le', 8 + 0x1a, 8 + 0x1a + 12)).toBe('Player')
    expect(withOneMii(one)).toBeNull()
    const fresh = withOneMii(null, 'Hannes')!
    expect(isMiiDb(fresh)).toBe(true)
    expect(fresh.toString('utf16le', 8 + 0x1a, 8 + 0x1a + 12)).toBe('Hannes')
    // a broken file is replaced
    expect(isMiiDb(withOneMii(Buffer.from('garbage'))!)).toBe(true)
  })

  it('the Mii is a full 0x5C record with a normal ID', () => {
    const m = starstationMii()
    expect(m.length).toBe(0x5c)
    expect(m[0]).toBe(3)
    expect(m.readUInt32BE(0x0c) >>> 31).toBe(1)
  })
})
