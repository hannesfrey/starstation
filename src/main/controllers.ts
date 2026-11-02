import { dir } from './paths'
import { readJson, writeJson } from './store'
import { logger } from './log'

/**
 * Which controller API the emulators should listen to for player 1.
 * XInput covers Xbox pads and PlayStation pads behind a driver (DS3 via SCP/DsHidMini, DS4Windows).
 * Without any XInput pad, SDL is used (DualShock 4 / DualSense / Switch Pro plugged in directly).
 */

const log = logger('controllers')
const file = () => dir('config', 'controllers.json')

interface Known {
  api: 'xinput' | 'sdl'
  pads: string[]
  updatedAt?: string
}

const IGNORED = /wheel|g29|g920|g923|driving|racing|pedal|throttle|hotas|flight|joystick|rudder|shifter/i

export function known(): Known {
  return readJson<Known>(file(), { api: 'xinput', pads: [] })
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

/** Placeholders for controller bindings in presets. */
export function padVars(): Record<string, string> {
  const sdl = known().api === 'sdl'
  return {
    // PCSX2 / DuckStation device prefix
    pad: sdl ? 'SDL-0' : 'XInput-0',
    // extra screenshot buttons (only SDL can see the PlayStation touchpad / Xbox Share button)
    padshot: sdl ? 'SDL-0/Touchpad' : '',
    padshare: sdl ? 'SDL-0/Misc1' : '',
    // RetroArch joypad driver
    rajoypad: sdl ? 'sdl2' : 'xinput'
  }
}
