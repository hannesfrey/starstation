import fs from 'node:fs'

/**
 * Tiny read-only ISO9660 reader. Handles plain 2048-byte ISOs and raw 2352-byte
 * BIN images (mode 1 and mode 2 form 1). Enough to read SYSTEM.CNF / PARAM.SFO.
 */
export class IsoReader {
  private fd: number
  private sectorSize = 2048
  private dataOffset = 0

  constructor(file: string) {
    this.fd = fs.openSync(file, 'r')
    try {
      this.detect()
    } catch (e) {
      this.close()
      throw e
    }
  }

  close(): void {
    try {
      fs.closeSync(this.fd)
    } catch {
      /* already closed */
    }
  }

  private raw(pos: number, len: number): Buffer {
    const b = Buffer.alloc(len)
    const n = fs.readSync(this.fd, b, 0, len, pos)
    return b.subarray(0, n)
  }

  private detect(): void {
    if (this.raw(16 * 2048 + 1, 5).toString('latin1') === 'CD001') return
    const sync = this.raw(0, 16)
    const isRaw = sync.length === 16 && sync[0] === 0 && sync.subarray(1, 11).every((x) => x === 0xff) && sync[11] === 0
    if (isRaw) {
      this.sectorSize = 2352
      this.dataOffset = sync[15] === 2 ? 24 : 16
      if (this.raw(16 * 2352 + this.dataOffset + 1, 5).toString('latin1') === 'CD001') return
    }
    throw new Error('No ISO9660 file system found')
  }

  sector(lba: number, count = 1): Buffer {
    if (this.sectorSize === 2048) return this.raw(lba * 2048, count * 2048)
    const parts: Buffer[] = []
    for (let i = 0; i < count; i++) parts.push(this.raw((lba + i) * 2352 + this.dataOffset, 2048))
    return Buffer.concat(parts)
  }

  private dirEntries(lba: number, size: number): { name: string; lba: number; size: number; dir: boolean }[] {
    const buf = this.sector(lba, Math.ceil(size / 2048))
    const out: { name: string; lba: number; size: number; dir: boolean }[] = []
    let p = 0
    while (p < buf.length) {
      const len = buf[p]
      if (len === 0) {
        p = (Math.floor(p / 2048) + 1) * 2048 // records don't cross sector boundaries
        continue
      }
      const nameLen = buf[p + 32]
      const rawName = buf.toString('latin1', p + 33, p + 33 + nameLen)
      if (!(nameLen === 1 && (rawName === '\0' || rawName === '\x01'))) {
        out.push({
          name: rawName.replace(/;\d+$/, '').replace(/\.$/, ''),
          lba: buf.readUInt32LE(p + 2),
          size: buf.readUInt32LE(p + 10),
          dir: (buf[p + 25] & 2) !== 0
        })
      }
      p += len
    }
    return out
  }

  /** Find a file by path (case-insensitive, "/" separated). Returns its bytes or null. */
  readFile(filePath: string, maxBytes = 16 * 1024 * 1024): Buffer | null {
    const pvd = this.sector(16)
    let cur = { lba: pvd.readUInt32LE(156 + 2), size: pvd.readUInt32LE(156 + 10), dir: true }
    for (const part of filePath.split('/').filter(Boolean)) {
      if (!cur.dir) return null
      const next = this.dirEntries(cur.lba, cur.size).find((e) => e.name.toUpperCase() === part.toUpperCase())
      if (!next) return null
      cur = next
    }
    if (cur.dir) return null
    const size = Math.min(cur.size, maxBytes)
    return this.sector(cur.lba, Math.ceil(size / 2048)).subarray(0, size)
  }
}

export function withIso<T>(file: string, fn: (iso: IsoReader) => T): T | null {
  let iso: IsoReader | null = null
  try {
    iso = new IsoReader(file)
    return fn(iso)
  } catch {
    return null
  } finally {
    iso?.close()
  }
}
