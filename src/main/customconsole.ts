import fs from 'node:fs'
import path from 'node:path'
import { dir } from './paths'
import { readJson, writeJson } from './store'
import { allConsoles, loadPresets, type ConsolePreset, type EmulatorPreset } from './presets'
import type { CustomConsoleForm } from '../shared/types'

/**
 * The advanced form: a console without a preset (name, emulator, launch command, file types).
 * Games launch, without smart features. Stored in config\consoles\<id>.json; the games folder is games\<id>.
 */

const file = (id: string) => dir('config', 'consoles', `${id}.json`)

/** Split a command line like `-f "{launch}"` into arguments (quotes group, and are removed). */
export function splitArgs(s: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out.push(m[1] ?? m[2])
  return out
}

export function customConsoleForm(id: string): CustomConsoleForm | null {
  const saved = readJson<{ console: ConsolePreset; emulator: EmulatorPreset } | null>(file(id), null)
  if (!saved) return null
  return {
    id,
    name: saved.console.name,
    short: saved.console.short,
    exe: saved.emulator.exe,
    args: saved.console.launch.args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '),
    extensions: saved.console.extensions.join(' ')
  }
}

export function saveCustomConsole(f: CustomConsoleForm): { ok: boolean; error?: string; id?: string } {
  const name = f.name.trim()
  if (!name) return { ok: false, error: 'The console needs a name.' }
  if (!f.exe || !fs.existsSync(f.exe)) return { ok: false, error: 'Choose the emulator program (.exe).' }
  const extensions = f.extensions
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .map((e) => (e.startsWith('.') ? e : `.${e}`))
  if (!extensions.length) return { ok: false, error: 'Add at least one file type, e.g. .gba' }
  const args = splitArgs(f.args.trim() || '"{launch}"')
  if (!args.some((a) => a.includes('{launch}') || a.includes('{game}'))) args.push('{launch}')
  const id =
    f.id ??
    (() => {
      const base = `x-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'console'}`
      let n = base
      let k = 2
      const taken = new Set(allConsoles().map((c) => c.id))
      while (taken.has(n) || fs.existsSync(file(n))) n = `${base}-${k++}`
      return n
    })()
  const emulator: EmulatorPreset = {
    id: `custom-${id}`,
    name: path.basename(f.exe, path.extname(f.exe)),
    folder: path.dirname(f.exe),
    exe: f.exe,
    portable: [],
    importNames: []
  }
  const console: ConsolePreset = {
    id,
    name,
    short: (f.short?.trim() || name).slice(0, 10),
    order: 1000,
    icon: 'cartridge',
    emulator: emulator.id,
    launch: { args },
    extensions,
    gameId: { method: 'filename' },
    config: [],
    quickResume: false
  }
  writeJson(file(id), { console, emulator })
  fs.mkdirSync(dir('games', id), { recursive: true })
  loadPresets()
  return { ok: true, id }
}

/** Remove the console from Starstation. Its games folder and saves stay where they are. */
export function removeCustomConsole(id: string): void {
  if (!id.startsWith('x-')) return
  fs.rmSync(file(id), { force: true })
  loadPresets()
}
