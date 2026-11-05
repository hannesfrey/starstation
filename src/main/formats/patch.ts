import fs from 'node:fs'
import zlib from 'node:zlib'

/**
 * ROM / disc patch formats (SPEC-v2 E, patch-file mods). IPS / BPS / PPF are applied here; xdelta (VCDIFF)
 * by xdelta3.exe. BPS (and xdelta) know the checksum of the file they were made for: a patch for another
 * version of the game is refused instead of producing a broken copy.
 */

export type PatchKind = 'ips' | 'bps' | 'ppf' | 'xdelta'

export class PatchError extends Error {}

export function patchKind(file: string): PatchKind | null {
  let head = Buffer.alloc(0)
  try {
    const fd = fs.openSync(file, 'r')
    head = Buffer.alloc(8)
    const n = fs.readSync(fd, head, 0, 8, 0)
    fs.closeSync(fd)
    head = head.subarray(0, n)
  } catch {
    return null
  }
  const s = head.toString('latin1')
  if (s.startsWith('PATCH')) return 'ips'
  if (s.startsWith('BPS1')) return 'bps'
  if (/^PPF[123]0/.test(s)) return 'ppf'
  if (head[0] === 0xd6 && head[1] === 0xc3 && head[2] === 0xc4) return 'xdelta' // VCDIFF
  return null
}

/** IPS: records of (3-byte offset, 2-byte size, data) or run-length (size 0); "EOF", optional new length. */
export function applyIps(src: Buffer, patch: Buffer): Buffer {
  if (patch.toString('latin1', 0, 5) !== 'PATCH') throw new PatchError('not an IPS patch')
  let out = Buffer.from(src)
  const grow = (n: number) => {
    if (n > out.length) {
      const b = Buffer.alloc(n)
      out.copy(b)
      out = b
    }
  }
  let i = 5
  while (i + 3 <= patch.length) {
    if (patch.toString('latin1', i, i + 3) === 'EOF') {
      // optional: truncate to a new size
      if (i + 6 <= patch.length) out = out.subarray(0, patch.readUIntBE(i + 3, 3))
      return out
    }
    const off = patch.readUIntBE(i, 3)
    const size = patch.readUInt16BE(i + 3)
    i += 5
    if (size) {
      grow(off + size)
      patch.copy(out, off, i, i + size)
      i += size
    } else {
      const run = patch.readUInt16BE(i)
      const val = patch[i + 2]
      grow(off + run)
      out.fill(val, off, off + run)
      i += 3
    }
  }
  throw new PatchError('the IPS patch is cut off')
}

/** BPS: checks the source CRC32, builds the target, checks its CRC32. */
export function applyBps(src: Buffer, patch: Buffer): Buffer {
  if (patch.toString('latin1', 0, 4) !== 'BPS1') throw new PatchError('not a BPS patch')
  const end = patch.length - 12
  if (zlib.crc32(patch.subarray(0, patch.length - 4)) !== patch.readUInt32LE(patch.length - 4)) throw new PatchError('the BPS patch file is damaged')
  if (zlib.crc32(src) !== patch.readUInt32LE(end)) throw new PatchError('this patch is for a different version of the game')
  let p = 4
  const num = () => {
    let data = 0
    let shift = 1
    for (;;) {
      const x = patch[p++]
      data += (x & 0x7f) * shift
      if (x & 0x80) break
      shift *= 128
      data += shift
    }
    return data
  }
  const srcSize = num()
  const dstSize = num()
  const meta = num()
  p += meta
  if (srcSize !== src.length) throw new PatchError('this patch is for a different version of the game')
  const out = Buffer.alloc(dstSize)
  let o = 0
  let srcRel = 0
  let dstRel = 0
  while (p < end) {
    const d = num()
    const cmd = d % 4
    const len = Math.floor(d / 4) + 1
    if (cmd === 0) {
      src.copy(out, o, o, o + len) // SourceRead
      o += len
    } else if (cmd === 1) {
      patch.copy(out, o, p, p + len) // TargetRead
      p += len
      o += len
    } else {
      const v = num()
      const delta = (v & 1 ? -1 : 1) * Math.floor(v / 2)
      if (cmd === 2) {
        srcRel += delta // SourceCopy
        src.copy(out, o, srcRel, srcRel + len)
        srcRel += len
        o += len
      } else {
        dstRel += delta // TargetCopy (may overlap: byte by byte)
        for (let k = 0; k < len; k++) out[o++] = out[dstRel++]
      }
    }
  }
  if (zlib.crc32(out) !== patch.readUInt32LE(end + 4)) throw new PatchError('the patched game does not check out')
  return out
}

/** PPF 1/2/3 (PlayStation disc patches): applied in place to a copy of the disc image (can be big). */
export function applyPpfToFile(file: string, patch: Buffer): void {
  const ver = patch.toString('latin1', 0, 5)
  let p: number
  let wide = false
  if (ver === 'PPF10') p = 56
  else if (ver === 'PPF20') p = 56 + 4 + 1024
  else if (ver === 'PPF30') {
    const blockCheck = patch[57] === 1
    wide = true
    p = 60 + (blockCheck ? 1024 : 0)
    if (patch[58] === 1) throw new PatchError('PPF patches with undo data are not supported')
  } else throw new PatchError('not a PPF patch')
  // an optional "file_id.diz" block sits at the end
  let end = patch.length
  if (patch.toString('latin1', end - 4, end - 2) === '.D' || patch.indexOf('@BEGIN_FILE_ID.DIZ') > 0) {
    const at = patch.indexOf('@BEGIN_FILE_ID.DIZ')
    if (at > 0) end = at
  }
  const fd = fs.openSync(file, 'r+')
  try {
    while (p < end) {
      const off = wide ? Number(patch.readBigUInt64LE(p)) : patch.readUInt32LE(p)
      p += wide ? 8 : 4
      const len = patch[p++]
      if (p + len > end) break
      fs.writeSync(fd, patch, p, len, off)
      p += len
    }
  } finally {
    fs.closeSync(fd)
  }
}
