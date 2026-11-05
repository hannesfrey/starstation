import fs from 'node:fs'
import path from 'node:path'

/**
 * Xbox / Xbox 360 disc images (XDVDFS) and the title ID inside default.xex.
 * The file system starts at one of a few known offsets, depending on the disc type.
 */

const SECTOR = 2048
const MAGIC = 'MICROSOFT*XBOX*MEDIA'
// plain xiso, XGD2 (most 360 games), XGD3 (late 360 games), XGD1 (original Xbox)
const PARTITIONS = [0, 0xfd90000, 0x2080000, 0x18300000]

function read(fd: number, pos: number, len: number): Buffer {
  const b = Buffer.alloc(len)
  const n = fs.readSync(fd, b, 0, len, pos)
  return b.subarray(0, n)
}

/** Find a file in the root folder of an XDVDFS image. Returns its byte offset and size. */
function findRootFile(fd: number, name: string): { pos: number; size: number } | null {
  for (const base of PARTITIONS) {
    const vd = read(fd, base + 32 * SECTOR, 28)
    if (vd.length < 28 || vd.toString('latin1', 0, 20) !== MAGIC) continue
    const dirSector = vd.readUInt32LE(20)
    const dirSize = vd.readUInt32LE(24)
    if (!dirSize || dirSize > 64 * 1024 * 1024) return null
    const dir = read(fd, base + dirSector * SECTOR, dirSize)
    // the folder is a binary tree; walking every entry is simpler and fast enough
    const want = name.toLowerCase()
    let off = 0
    while (off + 14 <= dir.length) {
      const sector = dir.readUInt32LE(off + 4)
      const size = dir.readUInt32LE(off + 8)
      const len = dir[off + 13]
      if (dir.readUInt16LE(off) === 0xffff || len === 0) {
        // padding to the next sector
        off = (Math.floor(off / SECTOR) + 1) * SECTOR
        continue
      }
      const entryName = dir.toString('latin1', off + 14, off + 14 + len)
      if (entryName.toLowerCase() === want) return { pos: base + sector * SECTOR, size }
      off = (off + 14 + len + 3) & ~3
    }
    return null
  }
  return null
}

/**
 * Original Xbox disc image layout: 'xiso' (file system right at the start, what xemu wants) or
 * 'full' (a whole disc dump with the video partition in front, e.g. from Redump) — null if neither.
 * xiso images must also have default.xbe in their root folder.
 */
export function xboxImageKind(file: string): 'xiso' | 'full' | null {
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const at = (base: number) => read(fd!, base + 32 * SECTOR, 20).toString('latin1') === MAGIC
    if (at(0)) return findRootFile(fd, 'default.xbe') ? 'xiso' : null
    if (at(0x18300000)) return 'full'
    return null
  } catch {
    return null
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}

/** Title ID from an XEX2 header (8 hex digits, e.g. "41560817"). */
export function titleIdFromXex(head: Buffer): string | null {
  if (head.length < 24 || head.toString('latin1', 0, 4) !== 'XEX2') return null
  const count = head.readUInt32BE(0x14)
  for (let i = 0; i < count && 0x18 + i * 8 + 8 <= head.length; i++) {
    const key = head.readUInt32BE(0x18 + i * 8)
    if (key !== 0x00040006) continue // execution info
    const at = head.readUInt32BE(0x18 + i * 8 + 4)
    if (at + 16 > head.length) return null
    const id = head.readUInt32BE(at + 12)
    return id ? id.toString(16).toUpperCase().padStart(8, '0') : null
  }
  return null
}

/** Xbox 360 title ID for a disc image, a default.xex, or a game folder with default.xex. */
export function x360TitleId(file: string): string | null {
  let fd: number | null = null
  try {
    const st = fs.statSync(file)
    const target = st.isDirectory() ? path.join(file, 'default.xex') : file
    fd = fs.openSync(target, 'r')
    if (/\.xex$/i.test(target)) return titleIdFromXex(read(fd, 0, 64 * 1024))
    if (!/\.iso$/i.test(target)) return null
    const xex = findRootFile(fd, 'default.xex')
    return xex ? titleIdFromXex(read(fd, xex.pos, Math.min(xex.size, 64 * 1024))) : null
  } catch {
    return null
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}
