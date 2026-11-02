// Types shared by the main process, preload and renderer.

export type ButtonIcons = 'auto' | 'playstation' | 'xbox'
export type GraphicsLevel = 'original' | 'enhanced' | 'max'

export interface Settings {
  startFullscreen: boolean
  startWithWindows: boolean
  sounds: boolean
  music: boolean
  screensaverMinutes: number
  showEmptyConsoles: boolean
  buttonIcons: ButtonIcons
  graphicsDefault: GraphicsLevel
  crtDefault: boolean
  netplayNickname: string
  /** Seconds the boot animation lasts (0 = skip). */
  bootAnimation: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  startFullscreen: false,
  startWithWindows: false,
  sounds: true,
  music: false,
  screensaverMinutes: 5,
  showEmptyConsoles: false,
  buttonIcons: 'auto',
  graphicsDefault: 'enhanced',
  crtDefault: false,
  netplayNickname: 'Player',
  bootAnimation: true
}

export type ConsoleIcon = 'cartridge' | 'cartridge-wide' | 'cartridge-n64' | 'disc' | 'disc-mini' | 'handheld' | 'box' | 'box-360' | 'remote'

/** Console preset as the renderer sees it (subset of the preset data file). */
export interface ConsoleInfo {
  id: string
  name: string
  short: string
  order: number
  icon: ConsoleIcon
  emulatorId: string
  emulatorName: string
  extensions: string[]
  gameCount: number
  status: ConsoleStatus
  statusText: string
  netplay: boolean
  quickResume: boolean
  shaderHint: boolean
  custom: boolean
}

export type ConsoleStatus = 'ready' | 'missing-emulator' | 'missing-bios' | 'no-games'

export interface Game {
  /** Stable id: console + path relative to Files\games (lowercase). */
  id: string
  console: string
  /** Absolute path to the file or folder that is launched / identifies the game. */
  path: string
  /** File passed to the emulator (may differ from path, e.g. PS3 EBOOT.BIN). */
  launchPath: string
  kind: 'file' | 'folder' | 'installed'
  title: string
  serial?: string
  /** Absolute paths to local images (file:// served via starstation-media://). */
  icon?: string
  background?: string
  year?: string
  genre?: string
  players?: number
  size: number
  addedAt: number
  discs?: number
  /** N64: internal ROM name (texture pack folder). */
  romName?: string
}

export interface GameStats {
  playTime: number
  playCount: number
  lastPlayed?: number
  favorite?: boolean
  /** Emulator version that wrote the current resume state. */
  resumeVersion?: string
}

export interface LibraryView {
  games: Game[]
  stats: Record<string, GameStats>
}

export interface Notice {
  id: number
  kind: 'info' | 'success' | 'warning' | 'error' | 'controller' | 'achievement' | 'update' | 'save' | 'mod'
  title: string
  detail?: string
  /** Optional fix action shown with the notice, e.g. "Open BIOS folder". */
  action?: { label: string; command: string; arg?: string }
}

export interface LaunchResult {
  ok: boolean
  error?: string
  fix?: { label: string; command: string; arg?: string }
}

export interface RunningGame {
  gameId: string
  title: string
  startedAt: number
}

export interface AppInfo {
  version: string
  filesDir: string
  isPackaged: boolean
}

export interface AppState {
  info: AppInfo
  settings: Settings
  consoles: ConsoleInfo[]
  library: LibraryView
  collections: Collection[]
  running: RunningGame | null
}

export interface EmulatorInfo {
  id: string
  name: string
  installed: boolean
  version: string | null
  latest: string | null
  updateAvailable: boolean
  consoles: string[]
  canInstall: boolean
  page?: string
}

export interface ImportSourceInfo {
  index: number
  label: string
  summary: { kind: 'emulator' | 'bios' | 'saves' | 'storage' | 'game'; count: number; bytes: number }[]
  skipped: string[]
}

export interface ImportProgressInfo {
  phase: 'copy' | 'verify' | 'move' | 'done' | 'error'
  done: number
  total: number
  current: string
  error?: string
}

export interface ImportResultInfo {
  ok: boolean
  copied: number
  moved: number
  conflicts: string[]
  errors: string[]
}

/** API exposed by the preload script as window.starstation. */
export interface StarstationApi {
  importScan(): Promise<ImportSourceInfo[]>
  importRun(index: number): Promise<ImportResultInfo>
  emulators(): Promise<EmulatorInfo[]>
  checkEmulatorUpdates(): Promise<EmulatorInfo[]>
  installEmulator(id: string): Promise<{ ok: boolean; error?: string; info?: EmulatorInfo }>
  getState(): Promise<AppState>
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<Settings>
  rescan(): Promise<LibraryView>
  launch(gameId: string, mode?: 'fresh' | 'resume'): Promise<LaunchResult>
  gameDetails(gameId: string): Promise<GameDetails | null>
  backupNow(gameId: string): Promise<BackupInfo | null>
  restoreBackup(gameId: string, backupId: string): Promise<{ ok: boolean; error?: string }>
  restorePreviousResume(gameId: string): Promise<{ ok: boolean; error?: string }>
  setGameOption(gameId: string, key: 'graphics' | 'crt' | 'patch', value: string | boolean, patchId?: string): Promise<GameOptions | null>
  reportPads(ids: string[]): Promise<void>
  screenshots(): Promise<Screenshot[]>
  refreshArtwork(gameId: string): Promise<boolean>
  mods(gameId: string): Promise<ModsView | null>
  modAddDialog(gameId: string, folder: boolean): Promise<ModAddResult | null>
  modAdd(gameId: string, path: string): Promise<ModAddResult>
  modPlace(gameId: string, pending: string, target: string): Promise<ModAddResult>
  modToggle(gameId: string, modId: string, on: boolean, winner?: 'this' | 'other'): Promise<ModToggleResult>
  modDelete(gameId: string, modId: string): Promise<void>
  gbSearch(gameId: string, name?: string): Promise<{ games: GbGame[]; chosen?: number }>
  gbChoose(gameId: string, gbGameId: number): Promise<void>
  gbMods(gbGameId: number, page: number): Promise<{ mods: GbMod[]; more: boolean }>
  gbMod(modId: number): Promise<GbModDetails>
  gbInstall(gameId: string, modId: number, fileId: number): Promise<ModAddResult>
  deleteGame(gameId: string, withSaves: boolean): Promise<{ ok: boolean; error?: string }>
  collectionCreate(name: string, firstGame?: string): Promise<Collection[]>
  collectionRename(id: string, name: string): Promise<Collection[]>
  collectionDelete(id: string): Promise<Collection[]>
  collectionToggle(id: string, gameId: string): Promise<Collection[]>
  addGames(paths: string[], consoleId?: string): Promise<AddGamesResult>
  addGamesDialog(): Promise<AddGamesResult | null>
  pathForFile(file: File): string
  toggleFavorite(gameId: string): Promise<GameStats>
  openFolder(kind: string, arg?: string): Promise<void>
  runCommand(command: string, arg?: string): Promise<void>
  toggleFullscreen(): Promise<boolean>
  quit(): Promise<void>
  mediaUrl(absPath: string): string
  on(channel: 'notice', cb: (n: Notice) => void): () => void
  on(channel: 'library', cb: (l: LibraryView) => void): () => void
  on(channel: 'consoles', cb: (c: ConsoleInfo[]) => void): () => void
  on(channel: 'running', cb: (r: RunningGame | null) => void): () => void
  on(channel: 'import-progress', cb: (p: ImportProgressInfo) => void): () => void
  on(channel: 'emulator-progress', cb: (p: { id: string; text: string }) => void): () => void
  on(channel: 'navigate', cb: (where: string) => void): () => void
  on(channel: 'collections', cb: (c: Collection[]) => void): () => void
  on(channel: 'screenshots', cb: (s: Screenshot[]) => void): () => void
  on(channel: 'battery', cb: (b: BatteryInfo | null) => void): () => void
}

export interface BackupInfo {
  id: string
  createdAt: number
  reason: 'launch' | 'manual' | 'before-restore' | 'before-mod'
  bytes: number
  folder: string
}

export interface ResumeInfo {
  savedAt: number
  /** Set when the emulator was updated after the state was saved. */
  warning?: string
}

/** Per-game choices from the Triangle menu. */
export interface GameOptions {
  graphics: GraphicsLevel
  crt: boolean
  patches: Record<string, boolean>
}

/** Loaded when the Triangle menu opens. */
export interface GameDetails {
  options: GameOptions
  /** What this console offers. */
  available: { graphics: boolean; crt: boolean; patches: { id: string; label: string }[] }
  resume: ResumeInfo | null
  backups: BackupInfo[]
  /** Save data that belongs only to this game (deleted with it if asked). */
  ownSaves: number
  /** Save backups are possible for this console. */
  canBackup: boolean
  mods: { total: number; on: number; supported: boolean }
  /** Resume state kept from before the last "Start fresh". */
  previousResume: number | null
}

export interface ModInfo {
  id: string
  name: string
  description?: string
  /** Label of where it goes (e.g. "Texture pack"). */
  target: string
  enabled: boolean
  files: number
  source: 'file' | 'gamebanana'
  image?: string
}

export interface ModsView {
  mods: ModInfo[]
  targets: { id: string; label: string }[]
  /** Why mods can't be used for this game, if so. */
  reason?: string
  gamebanana: boolean
}

export type ModAddResult =
  | { ok: true; mod: ModInfo }
  | { ok: false; error: string }
  | { ok: false; ask: { pending: string; name: string; targets: { id: string; label: string }[] } }

export type ModToggleResult = { ok: true; skipped: number } | { ok: false; error: string } | { ok: false; conflict: { with: string[]; files: number } }

export interface GbGame {
  id: number
  name: string
  icon?: string
}
export interface GbMod {
  id: number
  name: string
  image?: string
  downloads?: number
}
export interface GbFile {
  id: number
  name: string
  size: number
  url: string
  md5?: string
  ok: boolean
}
export interface GbModDetails {
  id: number
  name: string
  text: string
  image?: string
  files: GbFile[]
}

export interface Screenshot {
  path: string
  console: string
  consoleName: string
  title: string
  takenAt: number
}

export interface BatteryInfo {
  level: number | null
  wired: boolean
}

export interface Collection {
  id: string
  name: string
  games: string[]
  createdAt: number
}

export interface AddGamesResult {
  added: { path: string; console: string; title?: string }[]
  /** Files whose console can't be told apart (e.g. .chd = PS1 or PS2): ask Hannes. */
  ask: { path: string; options: string[] }[]
  errors: string[]
}
