/** Output of the XInputGetBatteryInformation helper: "<result> <type> <level>". */
export interface BatteryInfo {
  /** 0–100, or null when unknown. */
  level: number | null
  wired: boolean
}

/** BATTERY_TYPE_WIRED = 1, levels EMPTY/LOW/MEDIUM/FULL = 0..3. */
export function parseBattery(out: string): BatteryInfo | null {
  const m = /^(\d+) (\d+) (\d+)/.exec(out.trim())
  if (!m || m[1] !== '0') return null // no XInput pad 0
  const type = Number(m[2])
  if (type === 0) return null // disconnected
  if (type === 1) return { level: null, wired: true }
  if (type === 0xff) return { level: null, wired: false } // unknown
  return { level: [5, 30, 65, 100][Number(m[3])] ?? null, wired: false }
}
