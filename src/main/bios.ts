import fs from 'node:fs'
import path from 'node:path'
import { dir } from './paths'
import { fill, vars, type BiosFile, type ConsolePreset } from './presets'

export interface BiosStatus {
  ok: boolean
  /** Requirement groups still missing (labels). */
  missing: string[]
  /** Fix for the first missing group, if the preset defines one. */
  fix?: { label: string; command: string; arg?: string }
  found: string[]
}

export function listBiosFiles(d: string): { name: string; size: number }[] {
  const out: { name: string; size: number }[] = []
  const walk = (p: string, depth: number) => {
    let ents: fs.Dirent[] = []
    try {
      ents = fs.readdirSync(p, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      const f = path.join(p, e.name)
      if (e.isDirectory() && depth < 3) walk(f, depth + 1)
      else if (e.isFile()) out.push({ name: path.relative(d, f), size: fs.statSync(f).size })
    }
  }
  walk(d, 0)
  return out
}

export function matchesBios(rule: BiosFile, name: string, size: number): boolean {
  return new RegExp(rule.match, 'i').test(path.basename(name)) && (!rule.size || rule.size.includes(size))
}

export function biosStatus(c: ConsolePreset): BiosStatus {
  const rules = c.bios?.files ?? []
  if (!rules.length) return { ok: true, missing: [], found: [] }
  const files = listBiosFiles(dir('bios', c.id))
  const v = vars(c)
  const groups = new Map<string, { label: string; required: boolean; hit: boolean; fix?: BiosFile['fix'] }>()
  const found: string[] = []
  for (const r of rules) {
    const key = r.group ?? r.label
    const g = groups.get(key) ?? { label: r.group ?? r.label, required: r.required, hit: false, fix: r.fix }
    if (r.path) {
      const p = fill(r.path, v)
      if (fs.existsSync(p)) {
        g.hit = true
        found.push(p)
      }
    } else {
      const hit = files.find((f) => matchesBios(r, f.name, f.size))
      if (hit) {
        g.hit = true
        found.push(hit.name)
      }
    }
    groups.set(key, g)
  }
  const missingGroups = [...groups.values()].filter((g) => g.required && !g.hit)
  return { ok: missingGroups.length === 0, missing: missingGroups.map((g) => g.label), fix: missingGroups[0]?.fix, found }
}

/** BIOS files in the console's BIOS folder matching the first rule group (for emulators that need one picked). */
export function candidateBios(c: ConsolePreset, ruleLabel?: string): string[] {
  const rules = (c.bios?.files ?? []).filter((r) => !r.path && (!ruleLabel || r.label === ruleLabel))
  const files = listBiosFiles(dir('bios', c.id))
  return files.filter((f) => rules.some((r) => matchesBios(r, f.name, f.size))).map((f) => f.name)
}
