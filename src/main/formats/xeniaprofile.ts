/**
 * Xenia Canary: a game expects player 1 to be signed in. With no profile in slot 0 it asks for a sign-in, and
 * signing in mid-game crashed Modern Warfare 2 (Hannes, 2026-11-08: his new profile landed in slot 1).
 * Given the four "logged_profile_slot_N_xuid" values and the profiles on disk, this says who to sign in at boot:
 * slot 0 empty (or naming a profile that's gone) → a profile already signed in in another slot (moved, not
 * doubled), else the most recently used one. null = leave the config as it is.
 */
export function xeniaSlots(slots: string[], profiles: { xuid: string; mtime: number }[]): string[] | null {
  const have = new Set(profiles.map((p) => p.xuid.toUpperCase()))
  const s = [0, 1, 2, 3].map((i) => (slots[i] ?? '').trim().toUpperCase())
  if (s[0] && have.has(s[0])) return null
  const fromSlot = s.slice(1).find((x) => x && have.has(x))
  const newest = [...profiles].sort((a, b) => b.mtime - a.mtime)[0]?.xuid.toUpperCase()
  const pick = fromSlot ?? newest
  if (!pick) return null
  return s.map((x, i) => (i === 0 ? pick : x === pick ? '' : x))
}

/** A profile folder name in Xenia's content folder (an offline XUID: E0 + 14 hex digits). */
export const XUID = /^E0[0-9A-F]{14}$/i

/** The quoted value of a "key = "value"   # comment" line (as getIniValue returns it). */
export function quoted(v: string | undefined): string {
  return /^"([^"]*)"/.exec(v?.trim() ?? '')?.[1] ?? ''
}
