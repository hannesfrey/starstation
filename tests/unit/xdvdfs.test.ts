import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { titleIdFromXex, x360TitleId } from '../../src/main/formats/xdvdfs'

/** XEX2 header with the execution info (title ID 41560817, Modern Warfare 2) as its second entry. */
function xex(): Buffer {
  const b = Buffer.alloc(0x200)
  b.write('XEX2', 0, 'latin1')
  b.writeUInt32BE(2, 0x14)
  b.writeUInt32BE(0x000003ff, 0x18) // some other header
  b.writeUInt32BE(0, 0x1c)
  b.writeUInt32BE(0x00040006, 0x20) // execution info
  b.writeUInt32BE(0x100, 0x24)
  b.writeUInt32BE(0x41560817, 0x100 + 12)
  return b
}

/** Small XDVDFS image (plain xiso layout): a folder entry, then default.xex. */
function iso(): Buffer {
  const S = 2048
  const img = Buffer.alloc(36 * S)
  img.write('MICROSOFT*XBOX*MEDIA', 32 * S, 'latin1')
  img.writeUInt32LE(33, 32 * S + 20) // root folder sector
  img.writeUInt32LE(S, 32 * S + 24) // root folder size
  const dir = 33 * S
  img.fill(0xff, dir, dir + S) // unused space in a folder is 0xFF
  const entry = (off: number, name: string, sector: number, size: number, attr: number) => {
    img.writeUInt16LE(0, dir + off)
    img.writeUInt16LE(0, dir + off + 2)
    img.writeUInt32LE(sector, dir + off + 4)
    img.writeUInt32LE(size, dir + off + 8)
    img[dir + off + 12] = attr
    img[dir + off + 13] = name.length
    img.write(name, dir + off + 14, 'latin1')
  }
  entry(0, 'nxeart', 0, 0, 0x10)
  entry(20, 'default.xex', 34, 0x200, 0x20)
  xex().copy(img, 34 * S)
  return img
}

describe('Xbox 360 title IDs', () => {
  it('reads the title ID from an XEX header', () => {
    expect(titleIdFromXex(xex())).toBe('41560817')
    expect(titleIdFromXex(Buffer.from('not an xex at all, just text'))).toBeNull()
  })

  it('finds default.xex inside a disc image, a .xex file and a game folder', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'xdvdfs-'))
    try {
      fs.writeFileSync(path.join(d, 'Game.iso'), iso())
      expect(x360TitleId(path.join(d, 'Game.iso'))).toBe('41560817')
      fs.mkdirSync(path.join(d, 'Folder Game'))
      fs.writeFileSync(path.join(d, 'Folder Game', 'default.xex'), xex())
      expect(x360TitleId(path.join(d, 'Folder Game'))).toBe('41560817')
      expect(x360TitleId(path.join(d, 'Folder Game', 'default.xex'))).toBe('41560817')
      fs.writeFileSync(path.join(d, 'Other.iso'), Buffer.alloc(80 * 2048))
      expect(x360TitleId(path.join(d, 'Other.iso'))).toBeNull()
    } finally {
      fs.rmSync(d, { recursive: true, force: true })
    }
  })
})
