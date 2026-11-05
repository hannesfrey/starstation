/**
 * Safe mode on/off. Kept in its own tiny module so settings, game options and the launcher can ask
 * without importing each other. Safe mode itself (mods set aside, restoring) lives in safemode.ts.
 */

let on = process.argv.includes('--safe-mode')

export function inSafeMode(): boolean {
  return on
}

export function setSafeFlag(v: boolean): void {
  on = v
}
