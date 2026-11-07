/**
 * The 3DS Mii database (CFL_DB.dat in shared extdata F000000B). Some games refuse to start without a Mii
 * ("There are no Mii characters. Open Mii Maker…", Mario Kart 7) and Mii Maker is Nintendo software Starstation
 * can't bring. So Starstation puts one Mii of its own into an empty database (Hannes, 2026-11-07).
 *
 * Layout (3dbrew "Mii" page; checked against the empty database Mario Kart 7 wrote in Azahar):
 *   0x0000 "CFOG", 0x0004 u32 0x100, 0x0008 100 owned Miis × 0x5C,
 *   0x23F8 "CFHE", head/tail 0xFFFF, 0x2400 3000 list nodes × 0xE (prev/next 0x7FFF), 0xC81E CRC (big-endian),
 *   0xC820 "CFRA" … 0xE4BE CRC, 0xE4C0 3000 × 0x54 more; size 0x4BD20.
 * Both CRCs: CRC-16/XMODEM, stored big-endian so the CRC over the whole block (stored CRC included) is 0.
 */

export const MII_DB_SIZE = 0x4bd20
const OWNED = 0x8
const MII = 0x5c
const OWNED_NUM = 100
const OFFICIAL_END = 0xc820 // CRC at 0xC81E
const RECENT_END = 0xe4c0 // CRC at 0xE4BE

export function crc16(buf: Buffer, start: number, end: number): number {
  let c = 0
  for (let i = start; i < end; i++) {
    c ^= buf[i] << 8
    for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff
  }
  return c
}

function sealOfficial(db: Buffer): void {
  db.writeUInt16BE(crc16(db, 0, OFFICIAL_END - 2), OFFICIAL_END - 2)
}

/** An empty database, as a game creates it. */
export function emptyMiiDb(): Buffer {
  const db = Buffer.alloc(MII_DB_SIZE)
  db.write('CFOG', 0, 'latin1')
  db.writeUInt32LE(0x100, 4)
  db.write('CFHE', 0x23f8, 'latin1')
  db.writeUInt16LE(0xffff, 0x23fc)
  db.writeUInt16LE(0xffff, 0x23fe)
  for (let i = 0; i < 3000; i++) {
    const n = 0x2400 + i * 0xe
    db.writeUInt16LE(0x7fff, n + 10)
    db.writeUInt16LE(0x7fff, n + 12)
  }
  sealOfficial(db)
  db.write('CFRA', OFFICIAL_END, 'latin1')
  db.writeUInt16BE(crc16(db, OFFICIAL_END, RECENT_END - 2), RECENT_END - 2)
  return db
}

const utf16 = (s: string, buf: Buffer, at: number) => {
  for (let i = 0; i < 10; i++) buf.writeUInt16LE(i < s.length ? s.charCodeAt(i) : 0, at + i * 2)
}

/**
 * Starstation's Mii: the face of the emulator's open-source "Standard Mii" (Azahar core/hle/applets/mii_selector.cpp,
 * same field layout and byte order), with its own name and ID. Name: up to 10 characters.
 */
export function starstationMii(name = 'Player'): Buffer {
  const m = Buffer.alloc(MII)
  m[0x00] = 0x03 // version
  m[0x01] = 0x00 // options: copying not allowed, no region lock
  m[0x02] = 0x00 // page 0, slot 0
  m[0x03] = 0x30 // made on a 3DS
  m.writeBigUInt64BE(0xd285b6b300c8850an, 0x04) // system id
  m.writeUInt32BE(0x9a3c55a1, 0x0c) // Mii id: normal (not special), not the standard Mii's
  Buffer.from([0x40, 0xf4, 0x07, 0xb7, 0x37, 0x10]).copy(m, 0x10) // creator MAC
  m.writeUInt16BE(0xa600, 0x18) // gender, birthday, colour
  utf16(name.slice(0, 10), m, 0x1a)
  m[0x2e] = 0x40 // height
  m[0x2f] = 0x40 // width
  m[0x32] = 0x21 // hair
  m[0x33] = 0x01
  m.writeUInt32BE(0x02684418, 0x34) // eyes
  m.writeUInt32BE(0x26344614, 0x38) // eyebrows
  m.writeUInt16BE(0x8112, 0x3c) // nose
  m.writeUInt16BE(0x1768, 0x3e) // mouth
  m.writeUInt16BE(0x0d00, 0x40) // mustache
  m.writeUInt16BE(0x0029, 0x42) // beard
  m.writeUInt16BE(0x0052, 0x44) // glasses
  m.writeUInt16BE(0x4850, 0x46) // mole
  utf16('Starstatn', m, 0x48) // author
  return m
}

export function ownedMiiCount(db: Buffer): number {
  let n = 0
  for (let i = 0; i < OWNED_NUM; i++) if (db.readUInt32BE(OWNED + i * MII + 0x0c) !== 0) n++
  return n
}

export function isMiiDb(db: Buffer): boolean {
  return db.length >= RECENT_END && db.toString('latin1', 0, 4) === 'CFOG' && crc16(db, 0, OFFICIAL_END) === 0
}

/**
 * The database to write so at least one Mii exists, or null if nothing has to change
 * (it already has Miis — the user's own are never touched). A broken or missing file gets a new database.
 */
export function withOneMii(current: Buffer | null, name?: string): Buffer | null {
  // any database with Miis in it stays as it is, even if its checksum looks off: someone's Miis are never replaced
  const hasMiis = !!current && current.length >= OFFICIAL_END && current.toString('latin1', 0, 4) === 'CFOG' && ownedMiiCount(current) > 0
  if (hasMiis) return null
  const db = current && isMiiDb(current) ? Buffer.from(current) : emptyMiiDb()
  starstationMii(name).copy(db, OWNED)
  sealOfficial(db)
  return db
}
