import { dir } from './paths'
import { readObject, writeJson } from './store'
import { logger } from './log'
import type { PlayerPad } from '../shared/types'

/**
 * Which controller API the emulators listen to, and which pad is which player.
 * XInput covers Xbox pads and PlayStation pads behind a driver (DS3 via SCP/DsHidMini, DS4Windows).
 * Without any XInput pad, SDL is used (DualShock 4 / DualSense / Switch Pro plugged in directly).
 * Every emulator reads one of the two directly, so PlayStation pads need no translation driver (SPEC-v2 A).
 */

const log = logger('controllers')
const file = () => dir('config', 'controllers.json')
const XINPUT_ID = /xinput|xbox/i

interface Known {
  api: 'xinput' | 'sdl'
  pads: string[]
  updatedAt?: string
}


const IGNORED = /wheel|g29|g920|g923|driving|racing|pedal|throttle|hotas|flight|joystick|rudder|shifter/i

export function known(): Known {
  const k = readObject<Known>(file(), { api: 'xinput', pads: [] })
  return { ...k, pads: Array.isArray(k.pads) ? k.pads.filter((p) => typeof p === 'string') : [] }
}

/** How many players a game gets when no order was chosen: every known controller (1–4). */
export function knownPlayers(): number {
  return Math.max(1, Math.min(4, known().pads.length))
}

/** Gamepad ids seen by the menu (Gamepad API). Wheels etc. are ignored. */
export function reportPads(ids: string[]): void {
  const pads = ids.filter((id) => !IGNORED.test(id))
  if (!pads.length) return // nothing connected right now: keep the last choice
  const api: Known['api'] = pads.some((id) => /xinput|xbox/i.test(id)) ? 'xinput' : 'sdl'
  const before = known()
  if (before.api === api && before.pads.join('|') === pads.join('|')) return
  writeJson(file(), { api, pads, updatedAt: new Date().toISOString() } satisfies Known)
  log.info(`controllers: ${api} (${pads.join(', ')})`)
}

/** The name SDL (inside Dolphin) gives a PlayStation pad, from the Gamepad API id's vendor/product. */
export function sdlName(id = ''): string {
  const m = /Vendor:\s*([0-9a-f]{4})\s*Product:\s*([0-9a-f]{4})/i.exec(id)
  const vp = m ? `${m[1]}:${m[2]}`.toLowerCase() : ''
  if (/^054c:(05c4|09cc|0ba0)$/.test(vp)) return 'PS4 Controller'
  if (/^054c:(0ce6|0df2)$/.test(vp)) return 'PS5 Controller'
  if (/^054c:0268$/.test(vp)) return 'PS3 Controller'
  if (/^057e:2009$/.test(vp)) return 'Nintendo Switch Pro Controller'
  return 'PS4 Controller'
}

/**
 * Placeholders for controller bindings in presets, for up to 4 players.
 * Without a chosen order, player N uses device N-1 of the main API.
 */
export function padVars(order?: PlayerPad[]): Record<string, string> {
  const k = known()
  const sdl = k.api === 'sdl'
  const count = Math.max(1, Math.min(4, order?.length ?? k.pads.length))
  // no chosen order: the known controllers in the menu's order, each with its own kind — an Xbox-style pad and a
  // PS5 pad together are XInput-0 and SDL-0, not XInput-0 and XInput-1 (2.0.36; before, all got the first's kind)
  let nx = 0
  let ns = 0
  const known4 = k.pads.slice(0, 4).map((id): PlayerPad => (XINPUT_ID.test(id) ? { api: 'xinput', index: nx++ } : { api: 'sdl', index: ns++, id }))
  const players: PlayerPad[] = [0, 1, 2, 3].map((i) => order?.[i] ?? known4[i] ?? { api: k.api, index: i, id: sdl ? k.pads[i] : undefined })
  const v: Record<string, string> = {
    // extra screenshot buttons (only SDL can see the PlayStation touchpad / Xbox Share button)
    padshot: sdl ? 'SDL-0/Touchpad' : '',
    padshare: sdl ? 'SDL-0/Misc1' : '',
    // RetroArch joypad driver
    rajoypad: sdl ? 'sdl2' : 'xinput',
    // Dolphin: face buttons are named by position in SDL (S = ✕ / A)
    dolA: sdl ? '`Button S`' : '`Button A`',
    dolB: sdl ? '`Button E`' : '`Button B`',
    dolX: sdl ? '`Button W`' : '`Button X`',
    dolY: sdl ? '`Button N`' : '`Button Y`',
    // no chosen order (○ = usual order, or the screen was skipped): every connected controller gets a player,
    // so player 2 can join without restarting the game
    players: String(count)
  }
  players.forEach((p, i) => {
    const n = i === 0 ? '' : String(i + 1)
    const has = i < count
    // PCSX2 / DuckStation device prefix
    v[`pad${n}`] = `${p.api === 'sdl' ? 'SDL' : 'XInput'}-${p.index}`
    // RetroArch device index
    v[`rapad${i + 1}`] = String(p.index)
    // Dolphin device
    v[`dolpad${i + 1}`] = p.api === 'sdl' ? `SDL/${p.index}/${sdlName(p.id)}` : `XInput/${p.index}/Gamepad`
    // Dolphin GameCube port: 6 = standard controller, 0 = nothing plugged in (port 1 always has one)
    v[`gcport${i + 1}`] = i === 0 || has ? '6' : '0'
    // Dolphin Wii Remote: 1 = emulated remote on, 0 = off
    v[`wiisrc${i + 1}`] = i === 0 || has ? '1' : '0'
    // RPCS3: its own DualShock 4 / DualSense handlers for PlayStation pads, XInput otherwise
    const ps5 = p.api === 'sdl' && sdlName(p.id) === 'PS5 Controller'
    v[`ps3handler${i + 1}`] = p.api === 'sdl' ? (ps5 ? 'DualSense' : 'DualShock 4') : 'XInput'
    v[`ps3device${i + 1}`] = p.api === 'sdl' ? `${ps5 ? 'DualSense' : 'DS4'} Pad #${p.index + 1}` : `XInput Pad #${p.index + 1}`
  })
  return v
}
