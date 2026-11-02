/** PS3/PSP PARAM.SFO parser. Returns key → string | number. */
export function parseSfo(buf: Buffer): Record<string, string | number> {
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46535000) throw new Error('Not a PARAM.SFO file')
  const keyTable = buf.readUInt32LE(8)
  const dataTable = buf.readUInt32LE(12)
  const count = buf.readUInt32LE(16)
  const out: Record<string, string | number> = {}
  for (let i = 0; i < count; i++) {
    const e = 20 + i * 16
    if (e + 16 > buf.length) break
    const keyOff = buf.readUInt16LE(e)
    const fmt = buf.readUInt16LE(e + 2)
    const len = buf.readUInt32LE(e + 4)
    const dataOff = buf.readUInt32LE(e + 12)
    const keyStart = keyTable + keyOff
    const keyEnd = buf.indexOf(0, keyStart)
    const key = buf.toString('utf8', keyStart, keyEnd < 0 ? buf.length : keyEnd)
    const d = dataTable + dataOff
    if (fmt === 0x0404) out[key] = buf.readUInt32LE(d)
    else out[key] = buf.toString('utf8', d, d + len).replace(/\0+$/, '')
  }
  return out
}
