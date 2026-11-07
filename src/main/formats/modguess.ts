import type { Game } from '../../shared/types'

/** Which game a mod belongs to, from its name and readme (mods folder, see modinbox.ts). */

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 0)

/** Game codes like SCUS-97328 / SLES_123.45 / BLUS30443 → SCUS97328 (exported for tests). */
export function serialsIn(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(/\b([A-Z]{4})[-_ ]?(\d{3})\.?(\d{2})\b/g)) out.add(`${m[1]}${m[2]}${m[3]}`)
  return out
}
const normSerial = (s?: string) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * Which game is a mod for? Game codes in its readme win; then a game whose whole title is in the mod's name
 * (the longest such title). sure = only one game fits. (exported for tests)
 */
export function guessGame(name: string, docs: string, games: Pick<Game, 'id' | 'title' | 'serial'>[]): { sure?: string; ranked: string[] } {
  const codes = serialsIn(docs + ' ' + name)
  const bySerial = games.filter((g) => g.serial && codes.has(normSerial(g.serial)))
  if (bySerial.length === 1) return { sure: bySerial[0].id, ranked: [bySerial[0].id, ...games.filter((g) => g !== bySerial[0]).map((g) => g.id)] }
  const have = new Set(words(name))
  const docWords = new Set(words(docs.slice(0, 20_000)))
  const scored = games
    .map((g) => {
      const t = words(g.title)
      const inName = t.filter((w) => have.has(w)).length
      return { g, full: t.length > 0 && inName === t.length, inName, inDocs: t.filter((w) => docWords.has(w)).length, len: t.length }
    })
    .sort((a, b) => Number(b.full) - Number(a.full) || b.inName - a.inName || b.inDocs - a.inDocs || a.g.title.localeCompare(b.g.title))
  const full = scored.filter((s) => s.full)
  // "Gran Turismo 4" and "Gran Turismo 4 Prologue" both fit "GT4 Prologue mod": the longer title is meant
  const longest = Math.max(0, ...full.map((s) => s.len))
  const best = full.filter((s) => s.len === longest)
  return { sure: best.length === 1 ? best[0].g.id : undefined, ranked: [...bySerial.map((g) => g.id), ...scored.map((s) => s.g.id).filter((id) => !bySerial.some((g) => g.id === id))] }
}

