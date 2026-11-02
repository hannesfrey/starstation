import { dir } from './paths'
import { readJson, writeJson } from './store'
import { getConsole, fill, type ConsolePreset, type GameOption } from './presets'
import { applyStep } from './emuconfig'
import { gameVars } from './gamedata'
import { getSettings } from './settings'
import { logger } from './log'
import type { Game, GameOptions, GraphicsLevel } from '../shared/types'

/** Per-game Triangle-menu choices: graphics level, CRT filter, patches (config\library\game-options.json). */

const log = logger('gameoptions')
const file = () => dir('config', 'library', 'game-options.json')
type Stored = Partial<{ graphics: GraphicsLevel; crt: boolean; patches: Record<string, boolean> }>

function all(): Record<string, Stored> {
  return readJson<Record<string, Stored>>(file(), {})
}

export function gameOptions(g: Game): GameOptions {
  const c = getConsole(g.console)
  const s = getSettings()
  const st = all()[g.id] ?? {}
  const patches: Record<string, boolean> = {}
  for (const p of c?.patches ?? []) patches[p.id] = st.patches?.[p.id] ?? !!p.default
  return { graphics: st.graphics ?? s.graphicsDefault, crt: st.crt ?? s.crtDefault, patches }
}

export function availableOptions(g: Game): { graphics: boolean; crt: boolean; patches: { id: string; label: string }[] } {
  const c = getConsole(g.console)
  return { graphics: !!c?.graphics, crt: !!c?.crt, patches: (c?.patches ?? []).map((p) => ({ id: p.id, label: p.label })) }
}

export function setGameOption(g: Game, key: 'graphics' | 'crt' | 'patch', value: string | boolean, patchId?: string): GameOptions {
  const list = all()
  const cur = list[g.id] ?? {}
  if (key === 'graphics' && ['original', 'enhanced', 'max'].includes(String(value))) cur.graphics = value as GraphicsLevel
  else if (key === 'crt') cur.crt = !!value
  else if (key === 'patch' && patchId) cur.patches = { ...(cur.patches ?? {}), [patchId]: !!value }
  list[g.id] = cur
  writeJson(file(), list)
  return gameOptions(g)
}

/** The option values that apply to this launch. */
function chosen(c: ConsolePreset, g: Game): GameOption[] {
  const o = gameOptions(g)
  const out: GameOption[] = []
  if (c.graphics) out.push(c.graphics[o.graphics])
  if (c.crt) out.push(o.crt ? c.crt.on : c.crt.off)
  for (const p of c.patches ?? []) out.push(o.patches[p.id] ? p.on : p.off)
  return out
}

/** Placeholder values from the chosen options (e.g. RetroArch writes them into its per-console config). */
export function optionVars(c: ConsolePreset, g: Game): Record<string, string> {
  return Object.assign({}, ...chosen(c, g).map((x) => x.vars ?? {}))
}

/** Apply the options' config steps; returns their extra launch arguments. */
export function applyGameOptions(c: ConsolePreset, g: Game, extra: Record<string, string>): string[] {
  const v = gameVars(g, extra)
  const args: string[] = []
  for (const opt of chosen(c, g)) {
    for (const step of opt.steps ?? []) {
      try {
        applyStep(step, v)
      } catch (e) {
        log.warn(`${c.id}: option step failed`, e)
      }
    }
    for (const a of opt.args ?? []) args.push(fill(a, v))
  }
  return args
}
