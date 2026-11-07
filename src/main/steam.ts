import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { app } from 'electron'
import { logger } from './log'
import { writeFileAtomic } from './store'

/**
 * Settings → Steam → "Add Starstation to Steam": a non-Steam shortcut in every Steam user's shortcuts.vdf,
 * so Starstation starts from Big Picture mode. Steam must be closed (it rewrites the file when it exits).
 * The old file is kept as shortcuts.vdf.starstation-backup.
 */

const log = logger('steam')

// ---------- binary VDF (shortcuts.vdf) ----------
type VdfValue = string | number | VdfMap
export interface VdfMap {
  [key: string]: VdfValue
}

export function parseVdf(buf: Buffer): VdfMap {
  let i = 0
  const str = () => {
    const end = buf.indexOf(0, i)
    const s = buf.toString('utf8', i, end)
    i = end + 1
    return s
  }
  const map = (): VdfMap => {
    const out: VdfMap = {}
    for (;;) {
      const type = buf[i++]
      if (type === 0x08 || type === undefined) return out
      const key = str()
      if (type === 0x00) out[key] = map()
      else if (type === 0x01) out[key] = str()
      else if (type === 0x02) {
        out[key] = buf.readInt32LE(i)
        i += 4
      } else throw new Error(`unknown VDF type ${type}`)
    }
  }
  return map()
}

export function writeVdf(m: VdfMap): Buffer {
  const parts: Buffer[] = []
  const cstr = (s: string) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])])
  const walk = (o: VdfMap) => {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string') parts.push(Buffer.from([0x01]), cstr(k), cstr(v))
      else if (typeof v === 'number') {
        const b = Buffer.alloc(4)
        b.writeInt32LE(v | 0)
        parts.push(Buffer.from([0x02]), cstr(k), b)
      } else {
        parts.push(Buffer.from([0x00]), cstr(k))
        walk(v)
        parts.push(Buffer.from([0x08]))
      }
    }
  }
  walk(m)
  parts.push(Buffer.from([0x08]))
  return Buffer.concat(parts)
}

// ---------- Steam folders ----------
export function steamDir(): string | null {
  if (process.env.STARSTATION_STEAM_DIR) return process.env.STARSTATION_STEAM_DIR
  try {
    // read-only registry lookup of where Steam is installed
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', windowsHide: true })
    const m = /SteamPath\s+REG_SZ\s+(.+)/.exec(out)
    return m ? path.normalize(m[1].trim()) : null
  } catch {
    return null
  }
}

export function steamRunning(): boolean {
  if (process.env.STARSTATION_STEAM_DIR) return fs.existsSync(path.join(process.env.STARSTATION_STEAM_DIR, 'running.test'))
  try {
    return /steam\.exe/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq steam.exe', '/NH'], { encoding: 'utf8', windowsHide: true }))
  } catch {
    return false
  }
}

function users(steam: string): string[] {
  const u = path.join(steam, 'userdata')
  try {
    return fs.readdirSync(u).filter((n) => /^\d+$/.test(n) && n !== '0').map((n) => path.join(u, n))
  } catch {
    return []
  }
}

/** How Starstation is started: the installed Starstation.exe, or the dev build (electron.exe + source folder). */
function launchTarget(): { exe: string; args: string; startDir: string } {
  if (app.isPackaged) return { exe: process.execPath, args: '--fullscreen', startDir: path.dirname(process.execPath) }
  return { exe: process.execPath, args: `"${app.getAppPath()}" --fullscreen`, startDir: app.getAppPath() }
}

/** Steam's id for a non-Steam shortcut. */
function shortcutAppId(exe: string, name: string): number {
  return (zlib.crc32(Buffer.from(`"${exe}"` + name, 'utf8')) | 0x80000000) | 0
}

export function steamStatus(): { found: boolean; added: boolean; running: boolean } {
  const s = steamDir()
  if (!s || !fs.existsSync(s)) return { found: false, added: false, running: false }
  const added = users(s).some((u) => {
    const f = path.join(u, 'config', 'shortcuts.vdf')
    if (!fs.existsSync(f)) return false
    try {
      const list = (parseVdf(fs.readFileSync(f)).shortcuts ?? {}) as VdfMap
      return Object.values(list).some((e) => typeof e === 'object' && /starstation/i.test(String((e as VdfMap).AppName ?? (e as VdfMap).appname ?? '')))
    } catch {
      return false
    }
  })
  return { found: true, added, running: steamRunning() }
}

export function addToSteam(): { ok: boolean; error?: string; users?: number } {
  const s = steamDir()
  if (!s || !fs.existsSync(s)) return { ok: false, error: "Steam isn't installed on this PC." }
  if (steamRunning()) return { ok: false, error: 'Close Steam first (Steam → Exit), then try again.' }
  const list = users(s)
  if (!list.length) return { ok: false, error: 'No Steam user found. Log in to Steam once, then try again.' }
  const t = launchTarget()
  const icon = app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : path.join(app.getAppPath(), 'build', 'icon.ico')
  let changed = 0
  for (const u of list) {
    const f = path.join(u, 'config', 'shortcuts.vdf')
    fs.mkdirSync(path.dirname(f), { recursive: true })
    let root: VdfMap = { shortcuts: {} }
    if (fs.existsSync(f)) {
      const buf = fs.readFileSync(f)
      root = parseVdf(buf)
      fs.writeFileSync(`${f}.starstation-backup`, buf)
    }
    const shortcuts = (root.shortcuts ?? {}) as VdfMap
    const entries = Object.values(shortcuts).filter((e): e is VdfMap => typeof e === 'object')
    const existing = entries.find((e) => /starstation/i.test(String(e.AppName ?? e.appname ?? '')))
    const entry: VdfMap = {
      appid: shortcutAppId(t.exe, 'Starstation'),
      AppName: 'Starstation',
      Exe: `"${t.exe}"`,
      StartDir: `"${t.startDir}"`,
      icon: fs.existsSync(icon) ? icon : '',
      ShortcutPath: '',
      LaunchOptions: t.args,
      IsHidden: 0,
      AllowDesktopConfig: 1,
      AllowOverlay: 1,
      OpenVR: 0,
      Devkit: 0,
      DevkitGameID: '',
      DevkitOverrideAppID: 0,
      LastPlayTime: 0,
      FlatpakAppID: '',
      tags: {}
    }
    const next = existing ? entries.map((e) => (e === existing ? { ...e, ...entry } : e)) : [...entries, entry]
    root.shortcuts = Object.fromEntries(next.map((e, i) => [String(i), e]))
    writeFileAtomic(f, writeVdf(root))
    changed++
  }
  log.info(`added to Steam for ${changed} user(s)`)
  return { ok: true, users: changed }
}
