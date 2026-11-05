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
  /** RetroArch relay server for hosting: nyc, madrid, saopaulo, singapore. */
  netplayRelay: string
  /** Seconds the boot animation lasts (0 = skip). */
  bootAnimation: boolean
  /** Download missing artwork in the background. */
  artworkAuto: boolean
  /** Unpack and sort games saved to games\New downloads. */
  sortDownloads: boolean
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
  netplayRelay: 'madrid',
  bootAnimation: true,
  artworkAuto: true,
  sortDownloads: true
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
  /** You picked your own cover or background. */
  customArt?: boolean
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
  /** Started without mods, themes and custom settings. */
  safeMode: boolean
  /** This PC gets new versions first and can release them to everyone. */
  tester: boolean
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
  /** Version everyone gets (marked as tested on the tester PC). */
  tested?: string
  /** Tester PC: the installed version is newer than the tested one → "Mark as tested". */
  untested?: boolean
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
  /** pads: the player order chosen on the assignment screen (none = the usual order). */
  launch(gameId: string, mode?: 'fresh' | 'resume', netplay?: { host: true } | { join: NetplayRoom }, pads?: PlayerPad[]): Promise<LaunchResult>
  health(): Promise<HealthIssue[]>
  exportReport(): Promise<string | null>
  raStatus(): Promise<{ loggedIn: boolean; username?: string; hasPassword: boolean; hasApiKey: boolean }>
  raLogin(): Promise<{ ok: boolean; error?: string }>
  raLogout(): Promise<void>
  netplayRooms(gameId: string): Promise<NetplayRoom[]>
  steamStatus(): Promise<{ found: boolean; added: boolean; running: boolean }>
  addToSteam(): Promise<{ ok: boolean; error?: string; users?: number }>
  customConsole(id: string): Promise<CustomConsoleForm | null>
  saveCustomConsole(form: CustomConsoleForm): Promise<{ ok: boolean; error?: string; id?: string }>
  removeCustomConsole(id: string): Promise<void>
  pickExe(): Promise<string | null>
  clearLibraryCache(): Promise<void>
  licenses(): Promise<{ id: string; name: string; license: string; file?: string }[]>
  packageSize(choice: PackageChoice): Promise<number>
  packageSend(choice: PackageChoice): Promise<{ ok: boolean; error?: string }>
  packageSaveToFolder(choice: PackageChoice): Promise<{ ok: boolean; error?: string; folder?: string } | null>
  packageReceive(code: string, useSettings: boolean): Promise<{ ok: boolean; error?: string; added?: number; kept?: number }>
  packageReceiveFolder(useSettings: boolean, folder?: string): Promise<{ ok: boolean; error?: string; added?: number; kept?: number } | null>
  packageCancel(): Promise<void>
  setupStatus(): Promise<{ done: boolean; existing: boolean; filesDir: string }>
  setupDone(): Promise<void>
  updateState(): Promise<UpdateState>
  checkForUpdates(): Promise<UpdateState>
  /** Once after starting: crash (offer safe mode), rescue note, What's new. */
  startNotes(): Promise<StartNotes>
  /** Go back to a kept older version (Starstation restarts). */
  undoUpdate(to: string): Promise<{ ok: boolean; error?: string }>
  /** Tester PC: make the running beta a normal release. */
  releaseToEveryone(): Promise<{ ok: boolean; error?: string; already?: boolean }>
  /** Tester PC: the installed emulator version becomes the one everyone gets. */
  markTested(emulatorId: string): Promise<{ ok: boolean; error?: string }>
  /** Enter / leave safe mode (the menu starts again). */
  setSafeMode(on: boolean): Promise<{ ok: boolean; error?: string }>
  /** PS button menu (overlay window). */
  overlayState(): Promise<OverlayState>
  overlayAction(action: OverlayAction): Promise<{ ok: boolean; error?: string }>
  /** Hidden tests only: act as if the PS button was pressed. */
  testHome(): Promise<void>
  gameDetails(gameId: string): Promise<GameDetails | null>
  backupNow(gameId: string): Promise<BackupInfo | null>
  restoreBackup(gameId: string, backupId: string): Promise<{ ok: boolean; error?: string }>
  restorePreviousResume(gameId: string): Promise<{ ok: boolean; error?: string }>
  setGameOption(gameId: string, key: 'graphics' | 'crt' | 'patch', value: string | boolean, patchId?: string): Promise<GameOptions | null>
  reportPads(ids: string[]): Promise<void>
  screenshots(): Promise<Screenshot[]>
  refreshArtwork(gameId: string): Promise<boolean>
  /** Pick your own cover / background (file dialog), or 'reset' back to found artwork. file: hidden tests only. */
  customArt(gameId: string, kind: 'icon' | 'background' | 'reset', file?: string): Promise<{ ok: boolean; error?: string }>
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
  on(channel: 'add-ask', cb: (ask: AddGamesResult['ask']) => void): () => void
  on(channel: 'overlay', cb: (s: OverlayState) => void): () => void
  on(channel: 'screenshots', cb: (s: Screenshot[]) => void): () => void
  on(channel: 'battery', cb: (b: BatteryInfo | null) => void): () => void
  on(channel: 'package-progress', cb: (p: PackageProgress) => void): () => void
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

export interface HealthIssue {
  severity: 'error' | 'warning' | 'info'
  title: string
  detail?: string
  fix?: { label: string; command: string; arg?: string }
}

export interface Achievement {
  title: string
  description?: string
  game?: string
  points?: number
}

export interface NetplayRoom {
  host: string
  country?: string
  game: string
  /** Same ROM (CRC or file name) as the local game. */
  sameGame: boolean
  password: boolean
  relay: boolean
  address: string
  port: number
  session?: string
}

export interface CustomConsoleForm {
  id?: string
  name: string
  short?: string
  exe: string
  args: string
  extensions: string
}

/** What goes into a package. games = 'all' or a list of console ids. */
export interface PackageChoice {
  emulators: boolean
  bios: boolean
  games: 'all' | string[]
  mods: boolean
  settings: boolean
  saves: boolean
}

export interface PackageManifest {
  format: number
  app: 'Starstation'
  version: string
  createdAt: string
  includes: PackageChoice
  emulators: string[]
  games: number
  bytes?: number
}

export interface PackageProgress {
  phase: 'packing' | 'waiting' | 'sending' | 'receiving' | 'unpacking' | 'done' | 'error'
  /** 0..1 */
  pct: number
  code?: string
  detail?: string
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'error' | 'dev'
  version?: string
  error?: string
  /** beta: this PC gets new versions first (tester). everyone: only versions released to everyone. */
  channel?: 'beta' | 'everyone'
  tester?: boolean
  /** Versions "Undo update" can go back to, newest first. */
  previous?: string[]
  /** After going back: this version is not offered again until a newer one exists. */
  skipped?: string
  /** Tester: the running version is a beta that only the tester has so far. */
  canRelease?: boolean
}

/** Shown once after starting: crash → offer safe mode, rescue note, What's new. */
export interface StartNotes {
  safeMode: boolean
  crashed: boolean
  rescued?: { from: string; to: string }
  whatsNew?: { version: string; summary: string[]; details: string[] }
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

/** PS button menu over a running game (SPEC-v2 A). */
export interface OverlayState {
  open: boolean
  title: string
  console: string
  canSaveState: boolean
  canLoadState: boolean
  /** Save and quit keeps a resume state (consoles with quick resume). */
  quickResume: boolean
}
export type OverlayAction = 'resume' | 'save-state' | 'load-state' | 'screenshot' | 'save-quit' | 'quit'

/** Controller assignment: one player's pad (API + device number in it). */
export interface PlayerPad {
  api: 'xinput' | 'sdl'
  index: number
  id?: string
}
