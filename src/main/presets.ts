import fs from 'node:fs'
import path from 'node:path'
import { presetsDir, dir } from './paths'
import { readJson } from './store'
import { logger } from './log'
import type { ConsoleIcon } from '../shared/types'

const log = logger('presets')

/** One step that writes Starstation's paths/settings into an emulator config file. */
export type ConfigStep =
  | {
      type: 'ini'
      file: string
      /** Separator written between key and value, e.g. " = " or "=". */
      spacing?: string
      /** Quote string values (TOML). */
      quote?: boolean
      set: Record<string, Record<string, string | number | boolean>>
      /** Only touch the file if it already exists. */
      ifExists?: boolean
    }
  | { type: 'kv'; file: string; sep: string; set: Record<string, string> }
  | { type: 'touch'; path: string }
  | { type: 'mkdir'; path: string }
  | { type: 'write'; file: string; lines: string[]; ifMissing?: boolean }
  /** Folder link (junction) for emulators whose saves can't be redirected. */
  | { type: 'link'; path: string; target: string }

export interface BiosFile {
  label: string
  /** Regex (case-insensitive) on the file name. */
  match: string
  size?: number[]
  required: boolean
  /** Group name: within a group, any one file satisfies the requirement. */
  group?: string
  /** Instead of a file in the BIOS folder, check that this path exists (e.g. installed PS3 firmware). */
  path?: string
  /** Fix offered when missing. */
  fix?: { label: string; command: string; arg?: string }
}

export interface BiosSelect {
  file: string
  section: string
  key: string
  /** Regex preferring some files over others. */
  prefer?: string
  /** Only consider files of this BIOS rule (label). */
  rule?: string
  /** Write the full path instead of only the file name. */
  fullPath?: boolean
  /** Quote the value (TOML). */
  quote?: boolean
}

export interface ConsolePreset {
  id: string
  name: string
  short: string
  order: number
  icon: ConsoleIcon
  emulator: string
  /** RetroArch core, if the emulator is RetroArch. */
  core?: string
  launch: { args: string[]; cwd?: string }
  extensions: string[]
  games?: {
    /** Folder-based games (PS3 dumps): a folder counts as one game if it contains this relative path. */
    folderMarker?: string
    /** File inside a folder game that is passed to the emulator (relative, '/' separated). */
    folderLaunch?: string
    /** Also list games installed inside the emulator (PS3 dev_hdd0\game). */
    installedDir?: string
    multiDisc?: 'm3u'
  }
  bios?: {
    files: BiosFile[]
    hint?: string
    url?: string
    /** Write the chosen BIOS file into an emulator config if none (or a missing one) is set. */
    select?: BiosSelect | BiosSelect[]
  }
  gameId?: {
    method: 'ps1-serial' | 'ps2-serial' | 'ps3-sfo' | 'gc-header' | 'filename'
    titleDb?: { type: 'yaml-serial'; file: string }
  }
  saves?: { dir: string; note?: string }
  config: ConfigStep[]
  /** Where games, saves and emulator storage live in an EmuDeck / Desktop\Emulator setup. */
  import?: {
    roms?: string[]
    saves?: { from: string[]; to: string }[]
    storage?: { from: string[]; to: string }[]
  }
  quickResume: boolean
  shaderHint?: boolean
  netplay?: boolean
  notes?: string
  custom?: boolean
}

export interface EmulatorPreset {
  id: string
  name: string
  folder: string
  exe: string
  download?: { type: 'github'; repo: string; asset: string } | { type: 'url'; url: string; page?: string } | { type: 'page'; page: string }
  portable: ConfigStep[]
  /** Folder names this emulator has in an EmuDeck / Desktop\Emulator setup. */
  importNames: string[]
  versionHint?: string
}

let consoles: ConsolePreset[] = []
let emulators: Record<string, EmulatorPreset> = {}

export function loadPresets(): void {
  const base = presetsDir()
  const load = <T>(sub: string): T[] => {
    const d = path.join(base, sub)
    if (!fs.existsSync(d)) return []
    return fs
      .readdirSync(d)
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson<T | null>(path.join(d, f), null))
      .filter((p): p is T => {
        if (!p) log.warn(`could not read a preset in ${sub}`)
        return !!p
      })
  }
  emulators = Object.fromEntries(load<EmulatorPreset>('emulators').map((e) => [e.id, e]))
  // User-made consoles from the advanced form live in config\consoles
  const custom = fs.existsSync(dir('config', 'consoles'))
    ? fs
        .readdirSync(dir('config', 'consoles'))
        .filter((f) => f.endsWith('.json'))
        .map((f) => readJson<{ console: ConsolePreset; emulator: EmulatorPreset } | null>(dir('config', 'consoles', f), null))
        .filter((x): x is { console: ConsolePreset; emulator: EmulatorPreset } => !!x)
    : []
  for (const c of custom) emulators[c.emulator.id] = c.emulator
  consoles = [...load<ConsolePreset>('consoles'), ...custom.map((c) => ({ ...c.console, custom: true }))].sort(
    (a, b) => a.order - b.order
  )
  log.info(`loaded ${consoles.length} consoles, ${Object.keys(emulators).length} emulators from ${base}`)
}

export function allConsoles(): ConsolePreset[] {
  return consoles
}
export function getConsole(id: string): ConsolePreset | undefined {
  return consoles.find((c) => c.id === id)
}
export function getEmulator(id: string): EmulatorPreset | undefined {
  return emulators[id]
}
export function allEmulators(): EmulatorPreset[] {
  return Object.values(emulators)
}

export function emulatorDir(e: EmulatorPreset): string {
  return path.isAbsolute(e.folder) ? e.folder : dir('emulators', e.folder)
}
export function emulatorExe(e: EmulatorPreset): string {
  return path.isAbsolute(e.exe) ? e.exe : path.join(emulatorDir(e), e.exe)
}

/** Placeholder values for a console's preset strings. */
export function vars(c: ConsolePreset, extra: Record<string, string> = {}): Record<string, string> {
  const e = getEmulator(c.emulator)
  return {
    files: dir('emulators', '..'),
    emu: e ? emulatorDir(e) : '',
    bios: dir('bios', c.id),
    games: dir('games', c.id),
    saves: dir('saves', c.id),
    mods: dir('mods'),
    media: dir('media'),
    screenshots: dir('media', 'screenshots', c.id),
    config: dir('config'),
    console: c.id,
    core: c.core ?? '',
    ...extra
  }
}

/** Replace {name} placeholders. Paths keep Windows separators unless the key ends with ":/" (forward). */
export function fill(template: string, v: Record<string, string>): string {
  return template.replace(/\{([a-z]+)(:\/)?\}/g, (m, key: string, fwd?: string) => {
    if (!(key in v)) return m
    if (!v[key]) return ''
    const val = /[\\/]/.test(v[key]) ? path.normalize(v[key]).replace(/[\\/]+$/, '') : v[key]
    return fwd ? val.replace(/\\/g, '/') : val
  })
}
