import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { net } from 'electron'
import { getConsole } from './presets'
import { getSettings } from './settings'
import type { Game, NetplayRoom } from '../shared/types'

/**
 * "Play online" for RetroArch consoles: host through RetroArch's relay servers (no port forwarding),
 * or join a room from the public libretro lobby.
 */

// lobby.libretro.com over https failed the TLS handshake on Hannes's network (2026-11-02); the list is public data
const LOBBY = () => process.env.STARSTATION_LOBBY || 'http://lobby.libretro.com/list/'

interface LobbyRoom {
  fields: {
    username: string
    country?: string
    game_name: string
    game_crc: string
    core_name: string
    ip: string
    port: number
    mitm_ip?: string
    mitm_port?: number
    mitm_session?: string
    host_method: number
    has_password: boolean
    connectable: boolean
    player_count?: number
  }
}

/** CRC32 of the ROM as RetroArch reports it (small ROMs only; zips use the name). */
export function romCrc(g: Game): string | null {
  try {
    if (/\.(zip|7z)$/i.test(g.path) || fs.statSync(g.path).size > 64 * 1024 * 1024) return null
    return (zlib.crc32(fs.readFileSync(g.path)) >>> 0).toString(16).toUpperCase().padStart(8, '0')
  } catch {
    return null
  }
}

export async function listRooms(g: Game): Promise<NetplayRoom[]> {
  const c = getConsole(g.console)
  const core = (c?.netplayCore ?? '').toLowerCase()
  const r = await net.fetch(LOBBY(), { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'Starstation' } })
  if (!r.ok) throw new Error(`lobby answered ${r.status}`)
  const rooms = (await r.json()) as LobbyRoom[]
  const crc = romCrc(g)
  const base = path.basename(g.path, path.extname(g.path)).toLowerCase()
  const title = g.title.toLowerCase()
  // the lobby is public (anyone can list a room): an entry with missing fields is skipped, not the whole list
  return (Array.isArray(rooms) ? rooms : [])
    .map((x) => x?.fields)
    .filter((f): f is LobbyRoom['fields'] => !!f && typeof f.game_name === 'string' && typeof f.core_name === 'string')
    .filter((f) => f.connectable && (!core || f.core_name.toLowerCase().startsWith(core)))
    .map((f) => {
      const name = f.game_name.toLowerCase()
      const same = (crc && f.game_crc.toUpperCase() === crc) || name === base
      const similar = same || name.includes(title) || title.includes(name.replace(/\s*\(.*$/, ''))
      return { f, same, similar }
    })
    .filter((x) => x.similar)
    .sort((a, b) => Number(b.same) - Number(a.same))
    .map(({ f, same }) => ({
      host: f.username,
      country: f.country,
      game: f.game_name,
      sameGame: !!same,
      password: f.has_password,
      relay: f.host_method === 3 && !!f.mitm_session,
      address: f.host_method === 3 && f.mitm_ip ? f.mitm_ip : f.ip,
      port: f.host_method === 3 && f.mitm_port ? f.mitm_port : f.port,
      session: f.host_method === 3 ? f.mitm_session : undefined
    }))
}

/** Extra RetroArch arguments for hosting or joining. */
export function netplayArgs(how: { host: true } | { join: NetplayRoom }): string[] {
  const nick = (getSettings().netplayNickname || 'Player').replace(/[^\w .-]/g, '').slice(0, 30) || 'Player'
  if ('host' in how) return ['--host', '--nick', nick]
  const r = how.join
  // room details come from the public lobby: only a host name / IP, a port number and a plain session id
  // become arguments (an "address" like "--appendconfig=…" would otherwise pass RetroArch its own options)
  const address = String(r.address ?? '')
  const port = Number(r.port)
  const session = r.session === undefined || r.session === null ? '' : String(r.session)
  if (!/^[A-Za-z0-9][A-Za-z0-9.:-]{0,253}$/.test(address)) throw new Error('This room has an address Starstation can’t use.')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('This room has a port Starstation can’t use.')
  if (session && !/^[A-Za-z0-9_-]{1,128}$/.test(session)) throw new Error('This room has a session id Starstation can’t use.')
  return ['--connect', address, '--port', String(port), '--nick', nick, ...(session ? ['--mitm-session', session] : [])]
}

/** RetroArch config values: hosting goes through the chosen relay server. */
export function netplayVars(hosting: boolean): Record<string, string> {
  return { nprelayon: hosting ? 'true' : 'false', nprelay: getSettings().netplayRelay || 'madrid' }
}
