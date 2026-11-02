import fs from 'node:fs'

export interface TitleEntry {
  name: string
  year?: string
  genre?: string
  players?: number
}

const cache = new Map<string, { mtime: number; map: Map<string, TitleEntry> }>()

/**
 * Parse emulator YAML game databases keyed by serial (PCSX2 GameIndex.yaml, DuckStation gamedb.yaml):
 *   SLES-53717:
 *     name: "Midnight Club 3"
 *     metadata:
 *       releaseDate: "2005-04-12"
 *       genre: "Racing"
 *       maxPlayers: 2
 * Only the fields we need are read, with a line scan (no YAML dependency).
 */
export function loadSerialDb(file: string): Map<string, TitleEntry> {
  let stat: fs.Stats
  try {
    stat = fs.statSync(file)
  } catch {
    return new Map()
  }
  const hit = cache.get(file)
  if (hit && hit.mtime === stat.mtimeMs) return hit.map
  const map = new Map<string, TitleEntry>()
  let cur: TitleEntry | null = null
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const key = /^([A-Z]{4}-\d{3,5}):\s*$/.exec(line)
    if (key) {
      cur = { name: '' }
      map.set(key[1], cur)
      continue
    }
    if (!cur) continue
    let m: RegExpExecArray | null
    if ((m = /^ {2}name:\s*"?(.*?)"?\s*$/.exec(line))) cur.name = unescapeYaml(m[1])
    else if ((m = /^\s+releaseDate:\s*"?(\d{4})/.exec(line))) cur.year = m[1]
    else if ((m = /^\s+genre:\s*"?(.*?)"?\s*$/.exec(line))) cur.genre = m[1]
    else if ((m = /^\s+maxPlayers:\s*(\d+)/.exec(line))) cur.players = Number(m[1])
  }
  cache.set(file, { mtime: stat.mtimeMs, map })
  return map
}

function unescapeYaml(s: string): string {
  return s.replace(/\\"/g, '"').replace(/''/g, "'")
}

/** DuckStation names look like "Final Fantasy VII (Disc 1)" — strip disc markers for display. */
export function stripDisc(name: string): string {
  return name.replace(/\s*\((Disc|CD)\s*\d+\)/i, '').trim()
}
