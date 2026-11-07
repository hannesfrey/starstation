import fs from 'node:fs'
import path from 'node:path'
import { withIso } from './iso9660'
import { parseSfo } from './sfo'

/** "cdrom0:\SLUS_123.45;1" → "SLUS-12345" */
export function serialFromSystemCnf(text: string): string | null {
  const boot = /BOOT2?\s*=\s*([^\r\n]+)/i.exec(text)
  if (!boot) return null
  const m = /([A-Z]{4})[_-](\d{3})\.?(\d{2})/i.exec(boot[1])
  return m ? `${m[1].toUpperCase()}-${m[2]}${m[3]}` : null
}

/** First data file of a .cue sheet (absolute path) or null. */
export function cueDataFile(cuePath: string): string | null {
  try {
    const m = /FILE\s+"([^"]+)"|FILE\s+(\S+)/i.exec(fs.readFileSync(cuePath, 'latin1'))
    if (!m) return null
    return path.resolve(path.dirname(cuePath), m[1] ?? m[2])
  } catch {
    return null
  }
}

/** All files referenced by a .cue or .m3u (absolute, lowercase) — these are hidden from the game list. */
export function referencedFiles(file: string): string[] {
  try {
    const text = fs.readFileSync(file, 'latin1')
    const ext = path.extname(file).toLowerCase()
    const names =
      ext === '.cue'
        ? [...text.matchAll(/FILE\s+(?:"([^"]+)"|(\S+))/gi)].map((m) => m[1] ?? m[2])
        : text
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'))
    return names.map((n) => path.resolve(path.dirname(file), n).toLowerCase())
  } catch {
    return []
  }
}

/** Disc image to read for a PS1/PS2 game file (resolves .cue/.m3u). */
export function discImage(file: string): string | null {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.m3u') {
    const first = referencedFiles(file)[0]
    return first ? discImage(first) : null
  }
  if (ext === '.cue') return cueDataFile(file)
  if (['.iso', '.bin', '.img'].includes(ext)) return file
  return null // .chd/.pbp/.cso are compressed: fall back to file name
}

export function discSerial(file: string): string | null {
  const img = discImage(file)
  if (!img || !fs.existsSync(img)) return null
  return withIso(img, (iso) => {
    const cnf = iso.readFile('SYSTEM.CNF', 4096)
    return cnf ? serialFromSystemCnf(cnf.toString('latin1')) : null
  })
}

export interface Ps3Info {
  serial?: string
  title?: string
  category?: string
  /** APP_VER, e.g. "01.00" (the game's own version; updates raise it). */
  appVer?: string
  icon?: Buffer
  background?: Buffer
}

export function ps3FromFolder(gameDir: string): Ps3Info | null {
  const sfoPath = ['PS3_GAME/PARAM.SFO', 'PARAM.SFO'].map((p) => path.join(gameDir, p)).find((p) => fs.existsSync(p))
  if (!sfoPath) return null
  try {
    const sfo = parseSfo(fs.readFileSync(sfoPath))
    return { serial: String(sfo.TITLE_ID ?? ''), title: cleanSfoTitle(String(sfo.TITLE ?? '')), category: String(sfo.CATEGORY ?? ''), appVer: String(sfo.APP_VER ?? '') }
  } catch {
    return null
  }
}

export function ps3FromIso(file: string): Ps3Info | null {
  return withIso(file, (iso) => {
    const sfoBuf = iso.readFile('PS3_GAME/PARAM.SFO', 64 * 1024)
    if (!sfoBuf) return null
    const sfo = parseSfo(sfoBuf)
    return {
      serial: String(sfo.TITLE_ID ?? ''),
      title: cleanSfoTitle(String(sfo.TITLE ?? '')),
      category: String(sfo.CATEGORY ?? ''),
      appVer: String(sfo.APP_VER ?? ''),
      icon: iso.readFile('PS3_GAME/ICON0.PNG', 4 * 1024 * 1024) ?? undefined,
      background: iso.readFile('PS3_GAME/PIC1.PNG', 16 * 1024 * 1024) ?? undefined
    }
  })
}

function cleanSfoTitle(t: string): string {
  return t.replace(/[\r\n]+/g, ' ').replace(/[™®]/g, '').replace(/\s+/g, ' ').trim()
}

/** GameCube/Wii disc header: 6-char game ID at 0, title at 0x20 (plain .iso/.gcm only). */
export function nintendoDiscId(file: string): { id: string; title: string } | null {
  const ext = path.extname(file).toLowerCase()
  if (!['.iso', '.gcm'].includes(ext)) return null
  try {
    const fd = fs.openSync(file, 'r')
    const b = Buffer.alloc(0x60)
    fs.readSync(fd, b, 0, 0x60, 0)
    fs.closeSync(fd)
    const id = b.toString('latin1', 0, 6)
    if (!/^[A-Z0-9]{6}$/.test(id)) return null
    return { id, title: b.toString('latin1', 0x20, 0x60).replace(/\0.*$/s, '').trim() }
  } catch {
    return null
  }
}

/** "Legend of Zelda, The - Ocarina (USA) (Rev 1) [!]" → "The Legend of Zelda - Ocarina" */
export function cleanTitle(name: string): string {
  let t = name
    // double endings like "Halo 2.xiso.iso" or "Game.nkit.iso"
    .replace(/\.(xiso|nkit|dec)$/i, '')
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const m = /^(.*?), (The|A|An)(\s+-\s+.*)?$/.exec(t)
  if (m) t = `${m[2]} ${m[1]}${m[3] ?? ''}`
  return t || name
}

/** 3DS cartridge dump (.3ds/.cci, NCSD): title ID as 16 hex digits, as Azahar names its mod folders. */
export function n3dsTitleId(file: string): string | null {
  if (!/\.(3ds|cci)$/i.test(file)) return null
  try {
    const fd = fs.openSync(file, 'r')
    const b = Buffer.alloc(0x110)
    fs.readSync(fd, b, 0, 0x110, 0)
    fs.closeSync(fd)
    if (b.toString('latin1', 0x100, 0x104) !== 'NCSD') return null
    return b.readBigUInt64LE(0x108).toString(16).toUpperCase().padStart(16, '0')
  } catch {
    return null
  }
}

/**
 * 3DS cartridge dump (.3ds/.cci): is its first partition still encrypted? Azahar only runs decrypted games.
 * NCSD header → partition 0 (NCCH); NCCH flags byte 7 bit 0x04 = "NoCrypto". null = not a cartridge dump.
 */
export function n3dsEncrypted(file: string): boolean | null {
  if (!/\.(3ds|cci)$/i.test(file)) return null
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const h = Buffer.alloc(0x200)
      fs.readSync(fd, h, 0, 0x200, 0)
      if (h.toString('latin1', 0x100, 0x104) !== 'NCSD') return null
      const part0 = h.readUInt32LE(0x120) * 0x200
      const n = Buffer.alloc(0x200)
      fs.readSync(fd, n, 0, 0x200, part0)
      if (n.toString('latin1', 0x100, 0x104) !== 'NCCH') return null
      return (n[0x18f] & 0x04) === 0
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
}

/** N64 ROM header (any byte order): internal name (texture pack folder) and 4-letter game code. */
export function n64Header(file: string): { name: string; code: string } | null {
  if (!/\.(z64|n64|v64)$/i.test(file)) return null
  try {
    const fd = fs.openSync(file, 'r')
    const b = Buffer.alloc(0x40)
    fs.readSync(fd, b, 0, 0x40, 0)
    fs.closeSync(fd)
    const magic = b.readUInt32BE(0)
    if (magic === 0x37804012) b.swap16() // .v64: byte-swapped
    else if (magic === 0x40123780) b.swap32() // .n64: little-endian
    else if (magic !== 0x80371240) return null
    const name = b.toString('latin1', 0x20, 0x34).replace(/\0/g, '').trimEnd()
    const code = b.toString('latin1', 0x3b, 0x3f).replace(/\0/g, '')
    return name ? { name, code } : null
  } catch {
    return null
  }
}
