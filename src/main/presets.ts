import fs from 'node:fs'
import path from 'node:path'
import { presetsDir, dir } from './paths'
import { readJson } from './store'
import { logger } from './log'
import type { ConsoleIcon } from '../shared/types'
import { padVars } from './controllers'

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
      set: Record<string, Record<string, string | number | boolean | string[]>>
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
  /** insertAt: where resume / option arguments go in args (default 0 = first). */
  launch: { args: string[]; cwd?: string; insertAt?: number }
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
    method: 'ps1-serial' | 'ps2-serial' | 'ps3-sfo' | 'gc-header' | '3ds-header' | 'n64-header' | 'x360-xex' | 'filename'
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
  /**
   * Save data of one game, backed up before every launch. Placeholders: {saves} {serial} {basename} …;
   * '*' is allowed in the last path part. shared = used by every game (memory cards): never deleted with a game.
   */
  backup?: { path: string; shared?: boolean }[]
  /** Quick resume: the resume state the emulator writes on close ({state} = its path in args). */
  resume?: { state: string; args: string[]; /** Position in the launch args (default 0 = first). */ at?: number }
  /** Starstation's controller mapping + screenshot button for this emulator ({pad} = XInput-0 / SDL-0 …). */
  controls?: ConfigStep[]
  /** Graphics levels: values for placeholders and/or config steps. */
  graphics?: Record<'original' | 'enhanced' | 'max', GameOption>
  /** CRT filter (RetroArch). */
  crt?: { on: GameOption; off: GameOption }
  /** Where mods and texture packs go. */
  mods?: { targets: ModTarget[]; gamebanana?: boolean }
  /** Toggles such as widescreen patches. */
  patches?: { id: string; label: string; default?: boolean; on: GameOption; off: GameOption }[]
  /** RetroAchievements login written into the emulator ({rauser}, {ratoken}); "off" runs when not logged in. */
  achievements?: { on: ConfigStep[]; off?: ConfigStep[] }
  /** RetroArch core name as the netplay lobby shows it (e.g. "Mesen"). */
  netplayCore?: string
  quickResume: boolean
  shaderHint?: boolean
  netplay?: boolean
  notes?: string
  custom?: boolean
}

/** One per-game option value: placeholder values, config steps and extra launch arguments. */
export interface GameOption {
  vars?: Record<string, string>
  steps?: ConfigStep[]
  args?: string[]
}

/** A place an emulator loads mods from (texture packs, patches, romfs mods …). */
export interface ModTarget {
  id: string
  label: string
  /** Folder for this game, e.g. "{emu}/textures/{serial}". */
  dir: string
  /** Files that belong here (regex on the path inside the mod) — used to guess where a mod goes. */
  match?: string
  /** Folder name the mod's content starts at, e.g. "^replacements$" or "^(romfs|exefs)$". */
  anchor?: string
  /** Subfolder to use when the mod has no anchor folder. */
  into?: string
  /** Put every file straight into dir (patch files). */
  flatten?: boolean
  /** Emulator settings while at least one mod of this kind is on / when none is. */
  enabled?: GameOption
  disabled?: GameOption
}

export interface EmulatorPreset {
  id: string
  name: string
  folder: string
  exe: string
  download?: { type: 'github'; repo: string; asset: string; tested?: string } | { type: 'url'; url: string; version: string; page?: string } | { type: 'page'; page: string }
  portable: ConfigStep[]
  /** Folder names this emulator has in an EmuDeck / Desktop\Emulator setup. */
  importNames: string[]
  versionHint?: string
  /** License of the emulator (shown in Settings → About). */
  license?: string
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
    resume: 'false',
    // per-game option placeholders (filled for real at launch)
    raint: 'false',
    crt: 'false',
    n64res: '640x480',
    n64hires: 'False',
    nprelayon: 'false',
    nprelay: 'madrid',
    ...padVars(),
    ...extra
  }
}

/** Replace {name} placeholders. Paths keep Windows separators unless the key ends with ":/" (forward). */
export function fill(template: string, v: Record<string, string>): string {
  return template.replace(/\{([a-z]+)(:\/)?\}/g, (m, key: string, fwd?: string) => {
    if (!(key in v)) return m
    if (!v[key]) return ''
    // only real paths are normalized (bindings like "SDL-0/Touchpad" keep their slash)
    const val = path.isAbsolute(v[key]) ? path.normalize(v[key]).replace(/[\\/]+$/, '') : v[key]
    return fwd ? val.replace(/\\/g, '/') : val
  })
}
