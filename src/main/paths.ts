import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

/** The user-data folders inside Files\ (spec section 3). */
export const DATA_DIRS = ['emulators', 'bios', 'games', 'saves', 'mods', 'backups', 'media', 'config'] as const
export type DataDir = (typeof DATA_DIRS)[number]

let filesRoot: string | null = null

/**
 * Files\ folder. Packaged: Files\app\Starstation.exe → Files.
 * Dev: source\ is Files\source → Files. Tests override with STARSTATION_FILES.
 */
export function filesDir(): string {
  if (filesRoot) return filesRoot
  if (process.env.STARSTATION_FILES) filesRoot = path.resolve(process.env.STARSTATION_FILES)
  else if (app.isPackaged) {
    // installed layout: ...\Starstation\Files\app\Starstation.exe → Files. Anything else (someone moved the
    // program): keep data next to it in its own folder, never in a random parent folder.
    const exeDir = path.dirname(process.execPath)
    const parent = path.dirname(exeDir)
    filesRoot =
      path.basename(exeDir).toLowerCase() === 'app' && path.basename(parent).toLowerCase() === 'files' ? parent : path.join(parent, 'Starstation Files')
  }
  else filesRoot = path.resolve(app.getAppPath(), '..')
  return filesRoot
}

export function dir(kind: DataDir, ...parts: string[]): string {
  return path.join(filesDir(), kind, ...parts)
}

/** Where the preset data files live (shipped with the app). */
export function presetsDir(): string {
  if (process.env.STARSTATION_PRESETS) return path.resolve(process.env.STARSTATION_PRESETS)
  if (app.isPackaged) return path.join(process.resourcesPath, 'presets')
  return path.join(app.getAppPath(), 'presets')
}

/** Bundled helper binaries (croc, 7-Zip). */
export function binDir(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'bin')
  return path.join(app.getAppPath(), 'resources', 'bin')
}

export function ensureDataDirs(): void {
  for (const d of DATA_DIRS) fs.mkdirSync(dir(d), { recursive: true })
  for (const d of ['logs', 'library', 'electron']) fs.mkdirSync(dir('config', d), { recursive: true })
  fs.mkdirSync(dir('media', 'screenshots'), { recursive: true })
  fs.mkdirSync(dir('media', 'artwork'), { recursive: true })
}

/**
 * Keep every Chromium/Electron file inside Files\config\electron instead of %APPDATA%.
 * Must run before app 'ready'.
 */
export function redirectElectronPaths(): void {
  const e = dir('config', 'electron')
  fs.mkdirSync(e, { recursive: true })
  app.setPath('appData', e)
  app.setPath('userData', e)
  app.setPath('sessionData', e)
  app.setPath('logs', dir('config', 'logs'))
  app.setPath('crashDumps', path.join(e, 'crashes'))
  app.setPath('temp', path.join(e, 'temp'))
  fs.mkdirSync(path.join(e, 'temp'), { recursive: true })
  // electron-updater keeps its downloads in %LOCALAPPDATA%: point that into Files\config\electron for
  // Starstation itself; emulators still get the real one (see launcher)
  if (!process.env.STARSTATION_REAL_LOCALAPPDATA) process.env.STARSTATION_REAL_LOCALAPPDATA = process.env.LOCALAPPDATA ?? ''
  process.env.LOCALAPPDATA = path.join(e, 'local')
  fs.mkdirSync(process.env.LOCALAPPDATA, { recursive: true })
}
