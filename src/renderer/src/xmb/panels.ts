import type { UpdateState, AddGamesResult, AppState, CustomConsoleForm, PackageChoice, PackageProgress, EmulatorInfo, Game, GameDetails, GbGame, GbMod, GbModDetails, HealthIssue, ModsView, NetplayRoom, GraphicsLevel, ImportProgressInfo, ImportResultInfo, ImportSourceInfo, Settings } from '../../../shared/types'
import { formatPlayTime } from './model'
import { compareVersions } from '../../../shared/semver'
import { whatsNewFor } from '../../../shared/whatsnew'
import type { Ps3UpdateInfo } from '../../../shared/types'
import type { CouchStatus, NexusRequest, ProfileInfo, ProfileMerge, StartNotes, StorageInfo, Wallpapers } from '../../../shared/types'
import { THEMES } from '../components/Background'

/** Data some panels load on demand. */
export interface PanelExtra {
  emulators?: EmulatorInfo[]
  emuProgress: Record<string, string>
  importSources?: ImportSourceInfo[]
  importProgress?: ImportProgressInfo
  importResult?: ImportResultInfo
  importing: boolean
  /** Triangle-menu data per game (resume state, backups). */
  details: Record<string, GameDetails>
  /** Files whose console has to be picked by hand. */
  addAsk?: AddGamesResult['ask']
  mods: Record<string, ModsView>
  /** "Where does this mod go?" */
  modAsk?: { gameId: string; pending: string; name: string; targets: { id: string; label: string }[] }
  /** Two mods want the same files. */
  modConflict?: { gameId: string; modId: string; name: string; with: string[]; files: number }
  gb: { games?: GbGame[]; mods?: GbMod[]; page: number; more: boolean; detail: Record<number, GbModDetails>; busy?: string; error?: string }
  health?: HealthIssue[]
  ra?: { loggedIn: boolean; username?: string; hasPassword: boolean; hasApiKey: boolean }
  rooms?: { gameId: string; list?: NetplayRoom[]; error?: string }
  steam?: { found: boolean; added: boolean; running: boolean }
  licenses?: { id: string; name: string; license: string; file?: string }[]
  form?: CustomConsoleForm
  pad?: { name: string; api: string } | null
  pkg: { choice: PackageChoice; size?: number; progress?: PackageProgress; busy: boolean; result?: string; useSettings?: boolean; code?: string }
  setup?: { done: boolean; existing: boolean; filesDir: string }
  update?: UpdateState
  /** Shown once after starting (crash, rescue, What's new). */
  notes?: StartNotes
  /** Couch check progress (Settings → Diagnostics). */
  couch?: CouchStatus
  /** Compress / decompress progress per game. */
  compressing: Record<string, string>
  /** PS3 updates waiting per game, and the progress line while one runs. */
  ps3Update: Record<string, Ps3UpdateInfo>
  ps3Updating: Record<string, string>
  storage?: StorageInfo
  /** Nexus Mods link waiting for "Which game is this for?" */
  nexus?: NexusRequest
  /** A mod put into the mods folder whose game Starstation couldn't tell. */
  modInbox?: { id: string; name: string; games: string[] }
  nexusStatus?: { key: boolean; registered: boolean; patches: { pcsx2?: string; rpcs3?: string } }
  patchesBusy?: boolean
  wallpapers?: Wallpapers
  profiles?: ProfileInfo[]
  sys?: {
    audio?: { id: string; name: string; default: boolean }[]
    display?: { w: number; h: number; hz: number; current: boolean }[]
    bt?: { address: string; name: string; connected: boolean; paired: boolean; cod: number }[]
    btBusy?: string
    keepLeft?: number
  }
  /** Received package with profiles that exist here: how to bring each one in. */
  pkgAsk?: { profiles: string[]; folder?: string; choices: Record<string, ProfileMerge> }
  /** Accessibility: the button each menu action is on now (✕, ○ …). */
  buttonNames?: Record<string, string>
}

export interface PItem {
  key: string
  label: string
  value?: string
  /** Return 'keep' to leave the panel open (e.g. toggles). */
  run?: () => void | 'keep' | Promise<void | 'keep'>
  disabled?: boolean
  /** Static text rows (game info). */
  info?: boolean
}

export interface Panel {
  id: string
  title: string
  items: PItem[]
  /** Picture shown above the items (GameBanana preview). */
  image?: string
}

export interface PanelHandlers {
  setSetting: <K extends keyof Settings>(k: K, v: Settings[K]) => void
  command: (cmd: string, arg?: string) => void
  launch: (g: Game, anyway?: boolean, noUpdate?: boolean) => void
  toggleFavorite: (g: Game) => void
  openPanel: (id: string, arg?: string) => void
  installEmulator: (id: string) => void
  checkUpdates: () => void
  runImport: (index: number) => void
  launchMode: (g: Game, mode: 'fresh' | 'resume', noUpdate?: boolean) => void
  openEntry: (kind: 'new-collection' | 'rename-collection', target?: string) => void
  collectionToggle: (id: string, gameId: string) => void
  collectionDelete: (id: string) => void
  backupNow: (g: Game) => void
  restoreBackup: (g: Game, backupId: string) => void
  restorePreviousResume: (g: Game) => void
  setGameOption: (g: Game, key: 'graphics' | 'crt' | 'patch', value: string | boolean, patchId?: string) => void
  modToggle: (g: Game, modId: string, on: boolean, winner?: 'this' | 'other') => void
  modDelete: (g: Game, modId: string) => void
  modAddDialog: (g: Game, folder: boolean) => void
  modPlace: (gameId: string, pending: string, target: string) => void
  gbOpen: (g: Game) => void
  gbChoose: (g: Game, gbGameId: number) => void
  gbMore: (g: Game) => void
  gbInstall: (g: Game, modId: number, fileId: number) => void
  refreshArtwork: (g: Game) => void
  customArt: (g: Game, kind: 'icon' | 'background' | 'reset') => void
  runHealth: () => void
  exportReport: () => void
  raLogin: () => void
  raLogout: () => void
  playOnline: (g: Game, how: { host: true } | { join: NetplayRoom }) => void
  loadRooms: (g: Game) => void
  addToSteam: () => void
  editField: (field: 'name' | 'short' | 'args' | 'extensions' | 'nickname') => void
  pickExe: () => void
  saveForm: () => void
  removeConsole: (id: string) => void
  editConsole: (id: string) => void
  newConsole: () => void
  clearCache: () => void
  testPad: () => void
  pkgToggle: (key: keyof PackageChoice | `console:${string}`) => void
  pkgSend: () => void
  pkgSaveFolder: () => void
  pkgReceiveCode: (useSettings: boolean) => void
  pkgReceiveFolder: (useSettings: boolean) => void
  pkgCancel: () => void
  installAll: () => void
  wizardNext: (to?: number) => void
  wizardFinish: (artwork: boolean) => void
  checkUpdates2: () => void
  deleteGame: (g: Game, withSaves: boolean) => void
  addGamesDialog: () => void
  addGameAs: (path: string, consoleId: string) => void
  setSafeMode: (on: boolean) => void
  undoUpdate: (to: string) => void
  releaseToEveryone: () => void
  markTested: (emulatorId: string) => void
  guideSeen: (keys: string[]) => void
  couchSave: () => void
  compressGame: (g: Game) => void
  ps3Update: (g: Game) => void
  openManual: (g: Game) => void
  modProfile: (g: Game, profileId: string) => void
  modProfileDelete: (g: Game, profileId: string) => void
  newModProfile: (g: Game) => void
  nexusInstall: (url: string, g: Game) => void
  modInboxAssign: (gameId: string) => void
  updatePatches: () => void
  setWallpaper: (kind: string, remove?: boolean) => void
  power: (action: 'sleep' | 'shutdown') => void
  switchProfile: (p: ProfileInfo) => void
  profileEdit: (id: string, what: 'name' | 'pin' | 'nopin' | 'picture' | 'own-picture' | 'delete') => void
  pkgPrepareFolder: () => void
  pkgAskChoice: (name: string) => void
  pkgFinish: () => void
  sysAudioSet: (id: string) => void
  sysDisplaySet: (w: number, h: number, hz: number) => void
  sysDisplayKeep: (keep: boolean) => void
  sysBluetooth: (scan: boolean) => void
  sysBluetoothPair: (address: string) => void
  sysBluetoothRemove: (address: string) => void
  remapButton: (action: string) => void
}

const onOff = (b: boolean) => (b ? 'On' : 'Off')
const running = (s: AppState) => !!s.running
const LEVELS: GraphicsLevel[] = ['original', 'enhanced', 'max']
export const LEVEL_LABEL: Record<GraphicsLevel, string> = { original: 'Original', enhanced: 'Enhanced', max: 'Max' }
const nextLevel = (l: GraphicsLevel) => LEVELS[(LEVELS.indexOf(l) + 1) % LEVELS.length]

export function formatDate(t: number): string {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const REASON = { launch: 'before playing', manual: 'by hand', 'before-restore': 'before a restore', 'before-mod': 'before a mod' }

function formatSize(bytes: number): string {
  if (bytes < 0) return '—'
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(0)} MB`
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`
}

const KIND_LABEL = { emulator: 'Emulators', bios: 'BIOS files', saves: 'Save folders', storage: 'Emulator storage', game: 'Games' }

export function buildPanel(id: string, arg: string | undefined, state: AppState, h: PanelHandlers, x: PanelExtra): Panel | null {
  const s = state.settings
  switch (id) {
    case 'emulators': {
      if (!x.emulators) return { id, title: 'Emulators', items: [{ key: 'loading', label: 'Loading…', info: true }] }
      return {
        id,
        title: 'Emulators',
        items: [
          ...x.emulators.map((e) => {
            const busy = x.emuProgress[e.id]
            const status = busy
              ? busy
              : !e.installed
                ? 'Not installed'
                : e.updateAvailable
                  ? `Update available (${e.latest})`
                  : 'Up to date'
            return {
              key: `emu-${e.id}`,
              label: `${e.name}${e.version ? ` ${e.version}` : ''} · ${e.consoles.join(', ')}`,
              value: status,
              disabled: !!busy,
              run: () => (h.openPanel('emulator', e.id), 'keep' as const)
            }
          }),
          { key: 'check', label: 'Check for updates', run: () => (h.checkUpdates(), 'keep') },
          { key: 'folder', label: 'Open emulators folder', run: () => h.command('open-folder', 'emulators') }
        ]
      }
    }
    case 'import': {
      if (x.importing || x.importResult) {
        const p = x.importProgress
        const phase = { copy: 'Copying', verify: 'Checking copies', move: 'Moving games', done: 'Finished', error: 'Stopped' }
        const items: PItem[] = []
        if (x.importing && p) {
          items.push({ key: 'phase', label: `${phase[p.phase]} ${p.total ? `${p.done}/${p.total}` : ''}`, info: true })
          if (p.current) items.push({ key: 'current', label: p.current, info: true })
        }
        if (x.importResult) {
          const r = x.importResult
          items.push({ key: 'res', label: r.ok ? `Done: ${r.moved} game(s) moved, ${r.copied} item(s) copied.` : 'The import stopped. Nothing was moved.', info: true })
          for (const [i, err] of r.errors.slice(0, 3).entries()) items.push({ key: `err${i}`, label: err, info: true })
          if (r.conflicts.length) items.push({ key: 'conf', label: `${r.conflicts.length} file(s) already existed and were kept as they are.`, info: true })
          items.push({ key: 'ok', label: 'OK' })
        }
        return { id, title: 'Import from EmuDeck', items }
      }
      if (!x.importSources) return { id, title: 'Import from EmuDeck', items: [{ key: 'loading', label: 'Looking for EmuDeck…', info: true }] }
      if (!x.importSources.length)
        return { id, title: 'Import from EmuDeck', items: [{ key: 'none', label: 'No EmuDeck setup found on this PC.', info: true }] }
      return {
        id,
        title: 'Import from EmuDeck',
        items: [
          { key: 'how', label: 'Copies emulators, BIOS and saves, checks the copies, then moves the games. Nothing is deleted.', info: true },
          ...x.importSources.flatMap((src) => [
            { key: `src${src.index}`, label: src.label, info: true },
            ...src.summary
              .filter((k) => k.count)
              .map((k) => ({ key: `s${src.index}-${k.kind}`, label: `${KIND_LABEL[k.kind]}: ${k.count} (${formatSize(k.bytes)})`, info: true })),
            ...(src.summary.some((k) => k.count)
              ? [{ key: `run${src.index}`, label: 'Start import', run: () => (h.runImport(src.index), 'keep' as const) }]
              : [{ key: `nothing${src.index}`, label: 'Nothing new to import.', info: true }])
          ])
        ]
      }
    }
    case 'general': {
      const screensaver = [1, 5, 10, 15, 30, 0]
      const icons: Settings['buttonIcons'][] = ['auto', 'playstation', 'xbox']
      const iconLabel = { auto: 'Automatic', playstation: 'PlayStation', xbox: 'Xbox' }
      return {
        id,
        title: 'General',
        items: [
          { key: 'fs', label: 'Start in fullscreen', value: onOff(s.startFullscreen), run: () => (h.setSetting('startFullscreen', !s.startFullscreen), 'keep') },
          { key: 'boot', label: 'Boot animation', value: onOff(s.bootAnimation), run: () => (h.setSetting('bootAnimation', !s.bootAnimation), 'keep') },
          { key: 'snd', label: 'Menu sounds', value: onOff(s.sounds), run: () => (h.setSetting('sounds', !s.sounds), 'keep') },
          { key: 'music', label: 'Background music', value: onOff(s.music), run: () => (h.setSetting('music', !s.music), 'keep') },
          {
            key: 'empty',
            label: 'Show empty consoles',
            value: onOff(s.showEmptyConsoles),
            run: () => (h.setSetting('showEmptyConsoles', !s.showEmptyConsoles), 'keep')
          },
          {
            key: 'icons',
            label: 'Button icons',
            value: iconLabel[s.buttonIcons],
            run: () => (h.setSetting('buttonIcons', icons[(icons.indexOf(s.buttonIcons) + 1) % icons.length]), 'keep')
          },
          {
            key: 'saver',
            label: 'Screensaver after',
            value: s.screensaverMinutes ? `${s.screensaverMinutes} min` : 'Never',
            run: () => (
              h.setSetting('screensaverMinutes', screensaver[(screensaver.indexOf(s.screensaverMinutes) + 1) % screensaver.length]),
              'keep'
            )
          },
          {
            key: 'login',
            label: 'Start with Windows',
            value: onOff(s.startWithWindows),
            run: () => (h.setSetting('startWithWindows', !s.startWithWindows), 'keep')
          }
        ]
      }
    }
    case 'console': {
      const c = state.consoles.find((x) => x.id === arg)
      if (!c) return null
      const items: PItem[] = [
        { key: 'status', label: c.statusText, info: true },
        { key: 'emu', label: `Emulator: ${c.emulatorName}`, info: true },
        { key: 'types', label: `Game files: ${c.extensions.join(' ')}`, info: true },
        { key: 'add', label: 'Add games…', run: () => h.addGamesDialog() },
        { key: 'games', label: 'Open games folder', run: () => h.command('open-folder', `games:${c.id}`) },
        { key: 'bios', label: 'Open BIOS folder', run: () => h.command('open-folder', `bios:${c.id}`) },
        { key: 'saves', label: 'Open saves folder', run: () => h.command('open-folder', `saves:${c.id}`) }
      ]
      if (c.custom)
        items.push(
          { key: 'edit', label: 'Edit this console…', run: () => (h.editConsole(c.id), 'keep') },
          { key: 'remove', label: 'Remove this console', run: () => (h.openPanel('console-remove', c.id), 'keep') }
        )
      return { id, title: c.name, items }
    }
    case 'console-remove': {
      const c = state.consoles.find((x) => x.id === arg)
      if (!c) return null
      return {
        id,
        title: `Remove ${c.name}?`,
        items: [
          { key: 'msg', label: 'Only the console entry is removed. Its games, saves and the emulator stay on disk.', info: true },
          { key: 'yes', label: 'Remove', run: () => h.removeConsole(c.id) },
          { key: 'no', label: 'Cancel' }
        ]
      }
    }
    case 'custom-console': {
      const f = x.form
      if (!f) return null
      const show = (v: string) => v || '—'
      return {
        id,
        title: f.id ? 'Edit console' : 'Add a console',
        items: [
          { key: 'msg', label: 'For consoles without a preset: games start with your command, without the smart features.', info: true },
          { key: 'name', label: 'Name', value: show(f.name), run: () => (h.editField('name'), 'keep') },
          { key: 'short', label: 'Short name', value: show(f.short ?? ''), run: () => (h.editField('short'), 'keep') },
          { key: 'exe', label: 'Emulator program', value: f.exe ? f.exe.split(/[\\/]/).pop() : '—', run: () => (h.pickExe(), 'keep') },
          { key: 'args', label: 'Launch command', value: show(f.args), run: () => (h.editField('args'), 'keep') },
          { key: 'ext', label: 'Game file types', value: show(f.extensions), run: () => (h.editField('extensions'), 'keep') },
          { key: 'help', label: '{launch} is replaced by the game file. Example: -f "{launch}"', info: true },
          { key: 'save', label: 'Save console', run: () => (h.saveForm(), 'keep') }
        ]
      }
    }
    case 'graphics':
      return {
        id,
        title: 'Graphics',
        items: [
          { key: 'msg', label: 'Defaults for every game. Each game can change them in its Triangle menu.', info: true },
          { key: 'gfx', label: 'Graphics level', value: LEVEL_LABEL[s.graphicsDefault], run: () => (h.setSetting('graphicsDefault', nextLevel(s.graphicsDefault)), 'keep') },
          { key: 'crt', label: 'CRT filter for NES, SNES, N64', value: onOff(s.crtDefault), run: () => (h.setSetting('crtDefault', !s.crtDefault), 'keep') }
        ]
      }
    case 'controllers': {
      const icons: Settings['buttonIcons'][] = ['auto', 'playstation', 'xbox']
      const iconLabel = { auto: 'Automatic', playstation: 'PlayStation', xbox: 'Xbox' }
      return {
        id,
        title: 'Controllers',
        items: [
          { key: 'pad', label: x.pad ? `Player 1: ${x.pad.name}` : 'No controller connected', info: true },
          { key: 'how', label: 'One mapping for every emulator: it is written into each emulator before every game (✕/A = bottom button).', info: true },
          { key: 'test', label: 'Test buttons', run: () => (h.testPad(), 'keep') },
          { key: 'icons', label: 'Button icons', value: iconLabel[s.buttonIcons], run: () => (h.setSetting('buttonIcons', icons[(icons.indexOf(s.buttonIcons) + 1) % icons.length]), 'keep') },
          { key: 'shot', label: 'Screenshot button: F12 on the keyboard; touchpad (PS4/PS5) or Share (Xbox Series) on pads the emulator sees directly.', info: true },
          { key: 'wheel', label: 'Racing wheels and pedals are ignored by the menu.', info: true },
          { key: '3ds', label: '3DS (Azahar): map the controller once in Azahar itself.', info: true }
        ]
      }
    }
    case 'emulator': {
      const e = x.emulators?.find((y) => y.id === arg)
      if (!e) return null
      const lic = x.licenses?.find((y) => y.id === e.id)
      const busy = x.emuProgress[e.id]
      const items: PItem[] = [
        { key: 'ver', label: e.installed ? `Installed: ${e.version ?? 'unknown version'}` : 'Not installed', info: true },
        { key: 'for', label: `Used for: ${e.consoles.join(', ')}`, info: true }
      ]
      if (busy) items.push({ key: 'busy', label: busy, info: true })
      if (e.page) items.push({ key: 'page', label: 'Open download page', run: () => h.command('open-url', e.page!) })
      else if (e.canInstall) {
        if (!e.installed) items.push({ key: 'install', label: `Install ${e.name}`, disabled: !!busy, run: () => (h.installEmulator(e.id), 'keep') })
        else {
          if (e.updateAvailable) items.push({ key: 'update', label: `Update to ${e.latest}`, disabled: !!busy, run: () => (h.installEmulator(e.id), 'keep') })
          items.push({ key: 'repair', label: 'Repair / reinstall', value: 'keeps settings and saves', disabled: !!busy, run: () => (h.installEmulator(e.id), 'keep') })
        }
      }
      if (state.info.tester && e.tested) items.push({ key: 'tested', label: `Tested version (everyone gets it): ${e.tested}`, info: true })
      if (e.untested) items.push({ key: 'mark', label: 'Mark as tested', value: 'offer this version to everyone', disabled: !!busy, run: () => (h.markTested(e.id), 'keep') })
      items.push({ key: 'folder', label: 'Open emulator folder', run: () => h.command('open-folder', `emulators:${e.id}`) })
      if (lic) items.push({ key: 'lic', label: `License: ${lic.license}`, info: !lic.file, run: lic.file ? () => h.command('open-path', lic.file!) : undefined })
      return { id, title: e.name, items }
    }
    case 'health': {
      if (!x.health) return { id, title: 'Health check', items: [{ key: 'loading', label: 'Checking…', info: true }] }
      const mark = { error: '✕', warning: '!', info: 'i' }
      const items: PItem[] = x.health.length
        ? x.health.map((i, k) => ({
            key: `h${k}`,
            label: `${mark[i.severity]}  ${i.title}${i.detail ? ' — ' + i.detail : ''}`,
            value: i.fix?.label,
            info: !i.fix,
            run: i.fix ? () => h.command(i.fix!.command, i.fix!.arg) : undefined
          }))
        : [{ key: 'ok', label: 'Everything looks good: emulators, BIOS, games and disk space.', info: true }]
      items.push({ key: 'again', label: 'Check again', run: () => (h.runHealth(), 'keep') })
      return { id, title: 'Health check', items }
    }
    case 'retroachievements': {
      const r = x.ra
      if (!r) return { id, title: 'RetroAchievements', items: [{ key: 'loading', label: 'Loading…', info: true }] }
      const items: PItem[] = []
      if (r.loggedIn) {
        items.push({ key: 'who', label: `Logged in as ${r.username}. PCSX2, Dolphin and RetroArch use this login automatically.`, info: true })
        items.push({ key: 'ds', label: 'PS1 (DuckStation) protects its login: log in once inside DuckStation.', info: true })
        if (!r.hasApiKey) items.push({ key: 'key', label: 'Add your web API key to secrets.json to see unlocks here after playing.', info: true })
        items.push({ key: 'out', label: 'Log out', run: () => (h.raLogout(), 'keep') })
      } else {
        items.push({ key: 'how', label: 'Put your username and password into secrets.json, save it, then choose Log in. Only a login token is kept for the emulators.', info: true })
        items.push({ key: 'in', label: 'Log in', disabled: !r.hasPassword, run: () => (h.raLogin(), 'keep') })
      }
      items.push({ key: 'file', label: 'Open secrets.json', run: () => h.command('open-secrets') })
      return { id, title: 'RetroAchievements', items }
    }
    case 'netplay-settings': {
      const relays = ['madrid', 'nyc', 'saopaulo', 'singapore']
      const relayName: Record<string, string> = { madrid: 'Madrid', nyc: 'New York', saopaulo: 'São Paulo', singapore: 'Singapore' }
      return {
        id,
        title: 'Netplay',
        items: [
          { key: 'msg', label: 'Play NES, SNES and N64 games online. Host or join from a game\'s Triangle menu → Play online.', info: true },
          { key: 'nick', label: 'Your name', value: s.netplayNickname, run: () => (h.editField('nickname'), 'keep') },
          { key: 'relay', label: 'Relay server', value: relayName[s.netplayRelay] ?? s.netplayRelay, run: () => (h.setSetting('netplayRelay', relays[(relays.indexOf(s.netplayRelay) + 1) % relays.length]), 'keep') }
        ]
      }
    }
    case 'netplay': {
      const g = state.library.games.find((y) => y.id === arg)
      if (!g) return null
      return {
        id,
        title: `Play online · ${g.title}`,
        items: [
          { key: 'name', label: `You play as "${s.netplayNickname}" (change it in Settings → Netplay).`, info: true },
          { key: 'host', label: 'Host a game', value: 'others join you', run: () => h.playOnline(g, { host: true }) },
          { key: 'join', label: 'Join a game…', run: () => (h.loadRooms(g), 'keep') }
        ]
      }
    }
    case 'rooms': {
      const g = state.library.games.find((y) => y.id === arg)
      if (!g) return null
      const r = x.rooms?.gameId === g.id ? x.rooms : undefined
      const items: PItem[] = []
      if (!r || (!r.list && !r.error)) items.push({ key: 'loading', label: 'Looking for open games…', info: true })
      if (r?.error) items.push({ key: 'err', label: r.error, info: true })
      if (r?.list && !r.list.length) items.push({ key: 'none', label: 'Nobody is hosting this game right now.', info: true })
      for (const [k, room] of (r?.list ?? []).entries())
        items.push({
          key: `r${k}`,
          label: `${room.host}${room.country ? ` (${room.country.toUpperCase()})` : ''} · ${room.game}`,
          value: room.password ? 'password' : room.sameGame ? 'same game' : 'other version',
          disabled: room.password,
          run: () => h.playOnline(g, { join: room })
        })
      items.push({ key: 'again', label: 'Refresh', run: () => (h.loadRooms(g), 'keep') })
      return { id, title: 'Join a game', items }
    }
    case 'steam': {
      const st = x.steam
      const items: PItem[] = []
      if (!st) items.push({ key: 'loading', label: 'Looking for Steam…', info: true })
      else if (!st.found) items.push({ key: 'none', label: "Steam isn't installed on this PC.", info: true })
      else {
        items.push({ key: 'msg', label: 'Adds Starstation to your Steam library, so it starts from Big Picture mode in fullscreen.', info: true })
        if (st.added) items.push({ key: 'added', label: 'Starstation is already in Steam.', info: true })
        if (st.running) items.push({ key: 'run', label: 'Steam is running: close it first (Steam → Exit).', info: true })
        items.push({ key: 'add', label: st.added ? 'Update the Steam shortcut' : 'Add Starstation to Steam', disabled: st.running, run: () => (h.addToSteam(), 'keep') })
      }
      return { id, title: 'Steam', items }
    }
    case 'diagnostics':
      return {
        id,
        title: 'Diagnostics',
        items: [
          { key: 'msg', label: 'A zip with logs, settings and a summary of this PC. Logins (secrets.json), saves and games are never included.', info: true },
          { key: 'export', label: 'Export report…', run: () => h.exportReport() },
          { key: 'couch', label: 'Couch check', value: 'test the PS button menu with your controller', run: () => (h.openPanel('couch-check'), 'keep') },
          { key: 'logs', label: 'Open logs folder', run: () => h.command('open-folder', 'logs') }
        ]
      }
    case 'packages':
      return {
        id,
        title: 'Packages',
        items: [
          { key: 'msg', label: 'Copy this whole setup to another PC: by code (both PCs online) or with a folder (e.g. a USB drive).', info: true },
          { key: 'send', label: 'Send package…', run: () => (h.openPanel('pkg-send'), 'keep') },
          { key: 'receive', label: 'Receive package…', run: () => (h.openPanel('pkg-receive'), 'keep') },
          { key: 'never', label: 'Never included: favorites, play time, recently played, logins.', info: true }
        ]
      }
    case 'pkg-send': {
      const c = x.pkg.choice
      const gamesLabel = c.games === 'all' ? 'All' : `${c.games.length} console${c.games.length === 1 ? '' : 's'}`
      const size = x.pkg.size === undefined ? '…' : formatSize(x.pkg.size)
      return {
        id,
        title: 'Send package',
        items: [
          { key: 'emulators', label: 'Emulators', value: onOff(c.emulators), run: () => (h.pkgToggle('emulators'), 'keep') },
          { key: 'bios', label: 'BIOS & firmware', value: onOff(c.bios), run: () => (h.pkgToggle('bios'), 'keep') },
          { key: 'games', label: 'Games', value: gamesLabel, run: () => (h.openPanel('pkg-games'), 'keep') },
          { key: 'mods', label: 'Mods (with on/off)', value: onOff(c.mods), run: () => (h.pkgToggle('mods'), 'keep') },
          { key: 'settings', label: 'Settings', value: onOff(c.settings), run: () => (h.pkgToggle('settings'), 'keep') },
          { key: 'saves', label: 'Saves', value: onOff(c.saves), run: () => (h.pkgToggle('saves'), 'keep') },
          ...(x.profiles ?? [])
            .filter((p) => !p.guest)
            .map((p) => ({
              key: `prof-${p.id}`,
              label: `Profile: ${p.name}`,
              value: (c.profiles ?? []).includes(p.id) ? 'On: saves, play time, trophies, favorites' : 'Off',
              run: () => (h.pkgToggle(`profile:${p.id}` as keyof PackageChoice), 'keep' as const)
            })),
          { key: 'onlynew', label: 'Only new since last time', value: c.onlyNew ? 'On' : 'Off', run: () => (h.pkgToggle('onlyNew'), 'keep') },
          { key: 'smart', label: 'Only what the other PC is missing is sent (it tells Starstation what it has).', info: true },
          { key: 'size', label: `Size: ${size}`, info: true },
          { key: 'code', label: 'Send by code', disabled: x.pkg.busy, run: () => (h.pkgSend(), 'keep') },
          { key: 'folder', label: 'Save to folder…', disabled: x.pkg.busy, run: () => (h.pkgSaveFolder(), 'keep') }
        ]
      }
    }
    case 'pkg-games': {
      const c = x.pkg.choice
      const items: PItem[] = [{ key: 'all', label: 'All games', value: onOff(c.games === 'all'), run: () => (h.pkgToggle('games'), 'keep') }]
      for (const con of state.consoles) {
        const n = state.library.games.filter((g) => g.console === con.id).length
        if (!n) continue
        const on = c.games === 'all' || c.games.includes(con.id)
        items.push({ key: `c-${con.id}`, label: `${con.name} (${n})`, value: onOff(on), run: () => (h.pkgToggle(`console:${con.id}`), 'keep') })
      }
      return { id, title: 'Which games?', items }
    }
    case 'pkg-receive': {
      const existing = state.library.games.length > 0
      const items: PItem[] = []
      if (existing) {
        items.push({ key: 'ask', label: 'This PC already has a setup. New games and mods are added; nothing is deleted. Settings:', info: true })
        items.push({ key: 'set', label: 'Settings from the package', value: x.pkg.useSettings ? 'Use the package\'s' : 'Keep mine', run: () => (h.pkgToggle('useSettings' as keyof PackageChoice), 'keep') })
      }
      items.push({ key: 'code', label: 'Enter code…', disabled: x.pkg.busy, run: () => (h.pkgReceiveCode(!existing || !!x.pkg.useSettings), 'keep') })
      items.push({ key: 'usb', label: 'Prepare a USB drive first…', value: 'then only what is missing here goes on it', run: () => (h.pkgPrepareFolder(), 'keep') })
      items.push({ key: 'folder', label: 'From a folder…', disabled: x.pkg.busy, run: () => (h.pkgReceiveFolder(!existing || !!x.pkg.useSettings), 'keep') })
      return { id, title: 'Receive package', items }
    }
    case 'pkg-profiles': {
      const a = x.pkgAsk
      if (!a) return null
      const label = { merge: 'Merge (keep both sets of saves)', replace: 'Replace with the package’s', both: 'Keep both (adds a new profile)' }
      return {
        id,
        title: 'Profiles already here',
        items: [
          { key: 'what', label: 'These profiles exist on this PC too. For each one:', info: true },
          ...a.profiles.map((n) => ({ key: `pp-${n}`, label: n, value: label[a.choices[n] ?? 'merge'], run: () => (h.pkgAskChoice(n), 'keep' as const) })),
          { key: 'go', label: 'Continue', run: () => h.pkgFinish() }
        ]
      }
    }
    case 'pkg-progress': {
      const p = x.pkg.progress
      const label = { packing: 'Packing', waiting: 'Waiting for the other PC', sending: 'Sending', receiving: 'Receiving', unpacking: 'Unpacking', done: 'Done', error: 'Stopped' }
      const items: PItem[] = []
      const code = p?.code ?? x.pkg.code
      if (code && p?.phase !== 'done') {
        items.push({ key: 'code', label: `Code: ${code}`, info: true })
        items.push({ key: 'how', label: 'On the other PC: Settings → Packages → Receive package → Enter code.', info: true })
      }
      if (p) items.push({ key: 'phase', label: `${label[p.phase]}${p.phase === 'done' || p.phase === 'error' ? '' : ` · ${Math.round(p.pct * 100)}%`}`, info: true })
      if (p?.detail) items.push({ key: 'detail', label: p.detail, info: true })
      if (x.pkg.result) items.push({ key: 'result', label: x.pkg.result, info: true })
      items.push(x.pkg.busy ? { key: 'cancel', label: 'Cancel', run: () => (h.pkgCancel(), 'keep') } : { key: 'ok', label: 'OK' })
      return { id, title: 'Package', items }
    }
    // ---------------- first-start wizard ----------------
    case 'wiz-welcome':
      return {
        id,
        title: 'Welcome to Starstation',
        items: [
          { key: 'msg', label: 'All your consoles in one menu. Let\'s set up this PC — it takes a few minutes.', info: true },
          { key: 'start', label: 'Start', run: () => (h.wizardNext(1), 'keep') }
        ]
      }
    case 'wiz-location': {
      const st = x.setup
      return {
        id,
        title: 'Where everything lives',
        items: [
          { key: 'where', label: `Starstation keeps emulators, games, saves and settings in ${st?.filesDir ?? 'Files'}.`, info: true },
          ...(st?.existing
            ? [
                { key: 'found', label: 'There is already a Starstation setup here.', info: true },
                { key: 'continue', label: 'Continue where you left off', run: () => (h.wizardFinish(true), 'keep' as const) },
                { key: 'again', label: 'Run the setup anyway', run: () => (h.wizardNext(2), 'keep' as const) }
              ]
            : [{ key: 'next', label: 'Next', run: () => (h.wizardNext(2), 'keep' as const) }])
        ]
      }
    }
    case 'wiz-start':
      return {
        id,
        title: 'How do you want to start?',
        items: [
          { key: 'receive', label: 'Receive a package', value: 'from another PC', run: () => (h.openPanel('pkg-receive'), 'keep') },
          { key: 'import', label: 'Import from EmuDeck', value: 'copies, deletes nothing', run: () => (h.openPanel('import'), 'keep') },
          { key: 'fresh', label: 'Start fresh', run: () => (h.wizardNext(3), 'keep') },
          { key: 'next', label: 'Next', run: () => (h.wizardNext(3), 'keep') }
        ]
      }
    case 'wiz-emulators': {
      const list = x.emulators ?? []
      const missing = list.filter((e) => !e.installed && e.canInstall)
      return {
        id,
        title: 'Emulators',
        items: [
          { key: 'msg', label: 'Downloaded from their official releases into Files\\emulators, set up in portable mode.', info: true },
          ...list.map((e) => ({ key: `e-${e.id}`, label: `${e.name} · ${e.consoles.join(', ')}`, value: x.emuProgress[e.id] || (e.installed ? `Ready ${e.version ?? ''}` : e.page ? 'Download by hand' : 'Not installed'), info: true })),
          ...(missing.length ? [{ key: 'all', label: `Download all missing (${missing.length})`, run: () => (h.installAll(), 'keep' as const) }] : []),
          { key: 'next', label: 'Next', run: () => (h.wizardNext(4), 'keep') }
        ]
      }
    }
    case 'wiz-bios': {
      const items: PItem[] = [{ key: 'msg', label: 'Some consoles need files from your own console. Starstation checks them:', info: true }]
      for (const c of state.consoles) {
        const needs = c.status === 'missing-bios'
        items.push({
          key: `b-${c.id}`,
          label: `${c.short}: ${needs ? c.statusText.split(' · ').pop() : 'OK'}`,
          value: needs ? (c.id === 'ps3' ? 'Install firmware' : 'Open BIOS folder') : undefined,
          info: !needs,
          run: needs ? () => (c.id === 'ps3' ? h.command('install-ps3-firmware') : h.command('open-folder', `bios:${c.id}`), 'keep' as const) : undefined
        })
      }
      items.push({ key: 'next', label: 'Next', run: () => (h.wizardNext(5), 'keep') })
      return { id, title: 'BIOS & firmware', items }
    }
    case 'wiz-controller':
      return {
        id,
        title: 'Controller',
        items: [
          { key: 'pad', label: x.pad ? `Found: ${x.pad.name}` : 'Plug in a controller (or use the keyboard: arrows, Enter, Esc).', info: true },
          { key: 'map', label: 'Starstation writes one mapping into every emulator — nothing to set up per emulator.', info: true },
          { key: 'test', label: 'Test buttons', run: () => (h.testPad(), 'keep') },
          { key: 'next', label: 'Next', run: () => (h.wizardNext(6), 'keep') }
        ]
      }
    case 'wiz-artwork':
      return {
        id,
        title: 'Artwork',
        items: [
          { key: 'msg', label: 'Box art and screenshots for your games come from libretro (free, no account).', info: true },
          { key: 'now', label: 'Download artwork now', run: () => (h.wizardFinish(true), 'keep') },
          { key: 'later', label: 'Later', value: 'Settings → Library', run: () => (h.wizardFinish(false), 'keep') }
        ]
      }
    case 'licenses':
      return {
        id,
        title: 'Licenses',
        items: [
          { key: 'msg', label: 'Starstation runs these emulators. Each one belongs to its authors under its own license.', info: true },
          ...(x.licenses ?? []).map((l) => ({
            key: `l-${l.id}`,
            label: l.name,
            value: l.license,
            info: !l.file,
            run: l.file ? () => h.command('open-path', l.file!) : undefined
          }))
        ]
      }
    case 'library':
      return {
        id,
        title: 'Library',
        items: [
          { key: 'count', label: `${state.library.games.length} games`, info: true },
          { key: 'add', label: 'Add games…', run: () => h.addGamesDialog() },
          { key: 'drop', label: 'Tip: you can also drag game files into this window.', info: true },
          {
            key: 'sortdl',
            label: 'Sort new downloads automatically',
            value: onOff(s.sortDownloads),
            run: () => (h.setSetting('sortDownloads', !s.sortDownloads), 'keep')
          },
          { key: 'dltip', label: 'Save games to games\\New downloads: zip, 7z and rar are unpacked, the archive goes to the Recycle Bin.', info: true },
          { key: 'dl', label: 'Open New downloads folder', run: () => h.command('open-folder', 'games:New downloads') },
          { key: 'rescan', label: 'Rescan games', run: () => h.command('rescan') },
          { key: 'refresh', label: 'Refresh titles and artwork', run: () => h.clearCache() },
          { key: 'arttip', label: 'Missing artwork is looked for again every time Starstation starts. Own pictures: game options → Choose cover…', info: true },
          { key: 'ss', label: 'ScreenScraper (extra artwork): add your login to secrets.json', info: true },
          { key: 'secrets', label: 'Open secrets.json', run: () => h.command('open-secrets') },
          { key: 'games', label: 'Open games folder', run: () => h.command('open-folder', 'games') }
        ]
      }
    case 'about': {
      const u = x.update
      const items: PItem[] = [
        { key: 'v', label: `Version ${state.info.version}`, info: true },
        {
          key: 'channel',
          label: state.info.tester ? 'Beta channel: this PC gets new versions first' : 'Gets versions once they are released to everyone',
          info: true
        }
      ]
      if (u?.canRelease)
        items.push({ key: 'release', label: 'Release to everyone', value: 'only this PC has this version so far', run: () => (h.openPanel('release'), 'keep') })
      if (whatsNewFor(state.info.version, compareVersions)) items.push({ key: 'new', label: "What's new", run: () => (h.openPanel('whats-new'), 'keep') })
      if (u?.previous?.length) items.push({ key: 'undo', label: 'Undo update', value: `back to ${u.previous[0]}`, run: () => (h.openPanel('undo-update'), 'keep') })
      if (u?.skipped) items.push({ key: 'skip', label: `Version ${u.skipped} is skipped until a newer one comes out.`, info: true })
      return {
        id,
        title: 'About Starstation',
        items: [
          ...items,
          {
            key: 'update',
            label: 'Check for updates',
            value: (() => {
              const u = x.update
              if (!u || u.status === 'idle') return undefined
              return { checking: 'Checking…', latest: 'Up to date', downloading: `Downloading ${u.version}…`, ready: `${u.version} on next start`, error: 'Check failed', dev: 'Development build' }[u.status]
            })(),
            run: () => (h.checkUpdates2(), 'keep')
          },
          { key: 'f', label: `Folder: ${state.info.filesDir}`, info: true },
          { key: 'logs', label: 'Open logs folder', run: () => h.command('open-folder', 'logs') },
          { key: 'lic', label: 'Licenses of the emulators', run: () => (h.openPanel('licenses'), 'keep') },
          { key: 'own', label: 'Starstation uses only its own artwork and sounds.', info: true }
        ]
      }
    }
    case 'release':
      return {
        id,
        title: 'Release to everyone',
        items: [
          { key: 'what', label: `Version ${state.info.version} becomes the version every other Starstation updates to.`, info: true },
          { key: 'when', label: 'They get it on their next start. Undo update still works on every PC.', info: true },
          { key: 'go', label: `Release ${state.info.version} to everyone`, run: () => h.releaseToEveryone() },
          { key: 'no', label: 'Not yet', run: () => undefined }
        ]
      }
    case 'undo-update': {
      const prev = x.update?.previous ?? []
      return {
        id,
        title: 'Undo update',
        items: [
          { key: 'what', label: 'Starstation closes, installs the older version and starts again. Games, saves and settings stay.', info: true },
          ...prev.map((v) => ({ key: `to-${v}`, label: `Go back to ${v}`, run: () => h.undoUpdate(v) })),
          { key: 'no', label: 'Keep this version', run: () => undefined }
        ]
      }
    }
    case 'whats-new': {
      const w = x.notes?.whatsNew ?? whatsNewFor(state.info.version, compareVersions)
      if (!w) return null
      return {
        id,
        title: `What's new in ${state.info.version}`,
        items: [
          ...w.summary.map((line, i) => ({ key: `s${i}`, label: line, info: true })),
          { key: 'more', label: 'Show details', run: () => (h.openPanel('whats-new-details'), 'keep') },
          { key: 'ok', label: 'OK', run: () => undefined }
        ]
      }
    }
    case 'whats-new-details': {
      const w = x.notes?.whatsNew ?? whatsNewFor(state.info.version, compareVersions)
      if (!w) return null
      return { id, title: `All changes in ${state.info.version}`, items: w.details.map((line, i) => ({ key: `d${i}`, label: line, info: true })) }
    }
    case 'compress': {
      const g = state.library.games.find((y) => y.id === arg)
      const c = g && x.details[g.id]?.compress
      if (!g || !c) return null
      const busy = x.compressing[g.id]
      return {
        id,
        title: c.action === 'compress' ? `Compress ${g.title}` : `Decompress ${g.title}`,
        items:
          c.action === 'compress'
            ? [
                { key: 'what', label: `Makes a smaller ${c.format} file. Lossless: the game runs exactly the same.`, info: true },
                { key: 'safe', label: 'The original goes to the Recycle Bin only after the new file was checked against it.', info: true },
                { key: 'time', label: 'Takes a few minutes; you can keep using Starstation (not this game).', info: true },
                { key: 'go', label: busy || 'Compress now', disabled: !!busy, run: () => (h.compressGame(g), 'keep') }
              ]
            : [
                { key: 'what', label: `Turns the compressed file back into ${c.format}, checked bit for bit where Starstation compressed it.`, info: true },
                { key: 'go', label: busy || 'Decompress now', disabled: !!busy, run: () => (h.compressGame(g), 'keep') }
              ]
      }
    }
    case 'ps3-update': {
      const g = state.library.games.find((y) => y.id === arg)
      const u = g && x.ps3Update[g.id]
      if (!g || !u) return null
      const busy = x.ps3Updating[g.id]
      const size = u.size >= 1024 ** 3 ? `${(u.size / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(u.size / 1024 ** 2))} MB`
      return {
        id,
        title: `Update for ${g.title}`,
        items: [
          { key: 'what', label: `Version ${u.latest} is available. Yours is ${u.installed === '00.00' ? 'not updated yet' : u.installed}.`, info: true },
          { key: 'size', label: `${u.count === 1 ? '1 update' : `${u.count} updates`} from PlayStation Network, ${size}. Updates fix bugs and crashes.`, info: true },
          { key: 'go', label: busy || 'Update now', disabled: !!busy, run: () => (h.ps3Update(g), 'keep') },
          ...(busy
            ? [{ key: 'bg', label: 'You can leave this screen; the update carries on.', info: true }]
            : [
                { key: 'skip', label: 'Play without updating', run: () => h.launchMode(g, 'fresh', true) },
                { key: 'no', label: 'Cancel', run: () => undefined }
              ])
        ]
      }
    }
    case 'compat-warn': {
      const g = state.library.games.find((y) => y.id === arg)
      if (!g?.compat) return null
      const emu = g.compat.source
      return {
        id,
        title: `${g.title} may not start`,
        items: [
          { key: 'what', label: `${emu}'s compatibility list says this game doesn't start yet ("${g.compat.status}").`, info: true },
          { key: 'why', label: 'Emulators get better all the time; it may work with a newer version.', info: true },
          { key: 'go', label: 'Start anyway', run: () => h.launch(g, true) },
          { key: 'no', label: 'Cancel', run: () => undefined }
        ]
      }
    }
    case 'storage': {
      const s = x.storage
      if (!s) return { id, title: 'Storage', items: [{ key: 'loading', label: 'Adding up…', info: true }] }
      const gb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0, Math.round(n / 1024 ** 2))} MB`)
      const items: PItem[] = [{ key: 'free', label: `Free on this drive: ${gb(s.free)} of ${gb(s.total)}`, info: true }]
      for (const c of s.consoles)
        items.push({
          key: `st-${c.id}`,
          label: `${c.short}: ${gb(c.games + c.saves + c.mods + c.media + c.emulator)}`,
          value: [`games ${gb(c.games)}`, c.saves ? `saves ${gb(c.saves)}` : '', c.mods ? `mods ${gb(c.mods)}` : '', c.emulator ? `emulator ${gb(c.emulator)}` : ''].filter(Boolean).join(' · '),
          info: true
        })
      if (s.backups) items.push({ key: 'bk', label: `Save backups: ${gb(s.backups)}`, info: true })
      items.push({ key: 'tip', label: 'PS1 / PS2 / GameCube / Wii games can be made smaller: game options → Compress.', info: true })
      return { id, title: 'Storage', items }
    }
    case 'couch-check': {
      const done = new Set(x.couch?.done ?? [])
      const step = (key: string, label: string, ok: boolean): PItem => ({ key: `c-${key}`, label, value: ok ? '✓' : '—', info: true })
      const items: PItem[] = [
        { key: 'what', label: 'Do these with your controller only. Each step gets a ✓ when Starstation sees it happen.', info: true },
        step('pad', 'Move around this menu with the controller', done.has('pad')),
        step('launch', 'Start any game', done.has('launch')),
        step('home', 'In the game, press the PS button', done.has('home')),
        step('menu', 'The PS button menu opens over the game', done.has('menu')),
        step('resume', 'Choose Resume: you are back in the game', done.has('resume')),
        step('savequit', 'Press PS again and choose Save and quit', done.has('savequit')),
        step('closed', 'The game closes', done.has('closed')),
        step('back', 'Starstation is back in front', done.has('back'))
      ]
      const pads = (x.couch?.pads ?? []).filter((p) => !/^hid:0$/.test(p))
      items.push({ key: 'pads', label: pads.length ? `The PS button watcher sees: ${pads.join(', ')}` : 'The PS button watcher sees no controller yet', info: true })
      if (x.couch?.conflicts.gameBar) items.push({ key: 'gb', label: 'Xbox Game Bar may open with the PS button (see Health check).', info: true })
      if (x.couch?.conflicts.steam) items.push({ key: 'st', label: 'Steam is running and may take the PS button (see Health check).', info: true })
      items.push({ key: 'save', label: 'Save the result', value: `${done.size} of 8 done`, run: () => h.couchSave() })
      return { id, title: 'Couch check', items }
    }
    case 'home-guide': {
      const c = x.notes?.homeConflicts ?? []
      const items: PItem[] = [{ key: 'what', label: 'During a game the PS button opens Starstation’s menu. Other apps can take that button first:', info: true }]
      if (c.includes('gameBar'))
        items.push(
          { key: 'gb', label: 'Xbox Game Bar: Windows Settings → Gaming → Xbox Game Bar', info: true },
          { key: 'gb2', label: 'switch off “Open Xbox Game Bar using this button on a controller”.', info: true }
        )
      if (c.includes('steam'))
        items.push(
          { key: 'st', label: 'Steam: Settings → Controller → switch off “Guide button focuses Steam”,', info: true },
          { key: 'st2', label: 'or close Steam while you play here.', info: true }
        )
      items.push(
        { key: 'own', label: 'Starstation never changes other apps’ settings. The health check lists this again.', info: true },
        { key: 'ok', label: 'OK', run: () => h.guideSeen(c) }
      )
      return { id, title: 'The PS button', items }
    }
    case 'crashed':
      return {
        id,
        title: 'Starstation closed unexpectedly',
        items: [
          { key: 'what', label: 'Last time Starstation stopped without closing normally.', info: true },
          { key: 'safe', label: 'Start in safe mode', value: 'without mods and custom settings', run: () => h.setSafeMode(true) },
          { key: 'normal', label: 'Start normally', run: () => undefined }
        ]
      }
    case 'safe-mode':
      return state.info.safeMode
        ? {
            id,
            title: 'Safe mode',
            items: [
              { key: 'what', label: 'Starstation runs without mods, themes and custom settings. Changes made now are not kept.', info: true },
              { key: 'leave', label: 'Leave safe mode', value: 'everything comes back', run: () => h.setSafeMode(false) },
              { key: 'stay', label: 'Stay in safe mode', run: () => undefined }
            ]
          }
        : {
            id,
            title: 'Start in safe mode',
            items: [
              { key: 'what', label: 'Starts without mods, themes and custom settings, to find out what causes a problem. Nothing is deleted.', info: true },
              { key: 'tip', label: 'Also: hold ○ while Starstation starts.', info: true },
              { key: 'go', label: 'Start in safe mode', run: () => h.setSafeMode(true) },
              { key: 'no', label: 'Cancel', run: () => undefined }
            ]
          }
    case 'game': {
      const g = state.library.games.find((x) => x.id === arg)
      if (!g) return null
      const st = state.library.stats[g.id]
      const c = state.consoles.find((x) => x.id === g.console)
      const d = x.details[g.id]
      const items: PItem[] = []
      if (d?.resume) {
        items.push({ key: 'resume', label: 'Resume', value: formatDate(d.resume.savedAt), run: () => h.launchMode(g, 'resume') })
        items.push({ key: 'fresh', label: 'Start fresh', run: () => h.launchMode(g, 'fresh') })
      } else items.push({ key: 'play', label: 'Play', run: () => h.launchMode(g, 'fresh') })
      items.push(
        { key: 'fav', label: st?.favorite ? 'Remove from Favorites' : 'Add to Favorites', run: () => (h.toggleFavorite(g), 'keep') },
        { key: 'collect', label: 'Add to collection…', run: () => (h.openPanel('add-to-collection', g.id), 'keep') }
      )
      if (c?.netplay) items.splice(d?.resume ? 2 : 1, 0, { key: 'online', label: 'Play online', run: () => (h.openPanel('netplay', g.id), 'keep') })
      if (d?.available.graphics)
        items.push({
          key: 'graphics',
          label: 'Graphics',
          value: LEVEL_LABEL[d.options.graphics],
          run: () => (h.setGameOption(g, 'graphics', nextLevel(d.options.graphics)), 'keep')
        })
      if (d?.available.crt) items.push({ key: 'crt', label: 'CRT filter', value: onOff(d.options.crt), run: () => (h.setGameOption(g, 'crt', !d.options.crt), 'keep') })
      for (const p of d?.available.patches ?? [])
        items.push({
          key: `patch-${p.id}`,
          label: p.label,
          value: onOff(!!d?.options.patches[p.id]),
          run: () => (h.setGameOption(g, 'patch', !d?.options.patches[p.id], p.id), 'keep')
        })
      if (d?.canBackup ?? true)
        items.push({
          key: 'backups',
          label: 'Save backups',
          value: d ? `${d.backups.length}` : undefined,
          run: () => (h.openPanel('backups', g.id), 'keep')
        })
      // always: patch files and mods installed by hand work for every console
        items.push({
          key: 'mods',
          label: 'Mods',
          value: d?.mods.total ? `${d.mods.on} of ${d.mods.total} on` : undefined,
          run: () => (h.openPanel('mods', g.id), 'keep')
        })
      items.push(
        ...(g.manual ? [{ key: 'manual', label: 'Manual', value: 'the original booklet', run: () => h.openManual(g) }] : []),
        ...((x.mods[g.id]?.profiles.length ?? 0) > 1 && x.mods[g.id]?.mods.length
          ? [{ key: 'profile', label: 'Mod profile', value: x.mods[g.id]!.profiles.find((p) => p.id === x.mods[g.id]!.active)?.name ?? 'Custom', run: () => (h.openPanel('mod-profiles', g.id), 'keep' as const) }]
          : []),
        { key: 'folders', label: 'Open folder…', run: () => (h.openPanel('folders', g.id), 'keep') },
        { key: 'info', label: 'Game info', run: () => (h.openPanel('info', g.id), 'keep') },
        ...(g.compat ? [{ key: 'compat', label: `Compatibility: ${g.compat.label}`, value: `${g.compat.source} list: ${g.compat.status}`, info: true }] : []),
        { key: 'art', label: 'Refresh artwork', run: () => (h.refreshArtwork(g), 'keep') },
        ...(d?.compress
          ? [
              {
                key: 'compress',
                label: d.compress.action === 'compress' ? `Compress (${d.compress.format})` : `Decompress (${d.compress.format})`,
                value: x.compressing[g.id] || undefined,
                disabled: !!x.compressing[g.id],
                run: () => (h.openPanel('compress', g.id), 'keep' as const)
              }
            ]
          : []),
        { key: 'cover', label: 'Choose cover…', run: () => (h.customArt(g, 'icon'), 'keep') },
        { key: 'bgpick', label: 'Choose background…', run: () => (h.customArt(g, 'background'), 'keep') }
      )
      if (g.customArt) items.push({ key: 'artreset', label: 'Use found artwork again', run: () => (h.customArt(g, 'reset'), 'keep') })
      items.push({ key: 'delete', label: 'Delete game…', run: () => (h.openPanel('delete', g.id), 'keep') })
      if (c && !c.quickResume) items.push({ key: 'noresume', label: `${c.short} games have no quick resume.`, info: true })
      return { id, title: g.title, items }
    }
    case 'resume': {
      const g = state.library.games.find((x) => x.id === arg)
      const r = g && x.details[g.id]?.resume
      if (!g || !r) return null
      return {
        id,
        title: g.title,
        items: [
          { key: 'when', label: `Saved when you closed it on ${formatDate(r.savedAt)}.`, info: true },
          ...(r.warning ? [{ key: 'warn', label: r.warning, info: true }] : []),
          { key: 'resume', label: 'Resume', run: () => h.launchMode(g, 'resume') },
          { key: 'fresh', label: 'Start fresh', run: () => h.launchMode(g, 'fresh') }
        ]
      }
    }
    case 'add-to-collection': {
      const g = state.library.games.find((x) => x.id === arg)
      if (!g) return null
      return {
        id,
        title: 'Add to collection',
        items: [
          ...state.collections.map((c) => ({
            key: `c-${c.id}`,
            label: c.name,
            value: c.games.includes(g.id) ? 'In collection' : '',
            run: () => (h.collectionToggle(c.id, g.id), 'keep' as const)
          })),
          { key: 'new', label: 'New collection…', run: () => (h.openEntry('new-collection', g.id), 'keep') }
        ]
      }
    }
    case 'collection': {
      const c = state.collections.find((x) => x.id === arg)
      if (!c) return null
      return {
        id,
        title: c.name,
        items: [
          { key: 'count', label: `${c.games.length} games`, info: true },
          { key: 'rename', label: 'Rename…', run: () => (h.openEntry('rename-collection', c.id), 'keep') },
          { key: 'delete', label: 'Delete collection', run: () => (h.openPanel('collection-delete', c.id), 'keep') }
        ]
      }
    }
    case 'collection-delete': {
      const c = state.collections.find((x) => x.id === arg)
      if (!c) return null
      return {
        id,
        title: `Delete "${c.name}"?`,
        items: [
          { key: 'msg', label: 'Only the collection is deleted. The games stay in your library.', info: true },
          { key: 'yes', label: 'Delete collection', run: () => h.collectionDelete(c.id) },
          { key: 'no', label: 'Cancel' }
        ]
      }
    }
    case 'backups': {
      const g = state.library.games.find((x) => x.id === arg)
      if (!g) return null
      const d = x.details[g.id]
      const items: PItem[] = [{ key: 'now', label: 'Back up now', run: () => (h.backupNow(g), 'keep') }]
      if (!d) items.push({ key: 'loading', label: 'Loading…', info: true })
      else if (!d.backups.length) items.push({ key: 'none', label: 'No backups yet. Saves are backed up every time you start the game (last 5 kept).', info: true })
      for (const b of d?.backups ?? [])
        items.push({
          key: `b-${b.id}`,
          label: formatDate(b.createdAt),
          value: `${REASON[b.reason]} · ${formatSize(b.bytes)}`,
          run: () => (h.openPanel('backup', `${g.id}|${b.id}`), 'keep')
        })
      if (d?.previousResume)
        items.push({
          key: 'prevresume',
          label: 'Bring back the earlier resume point',
          value: formatDate(d.previousResume),
          run: () => (h.restorePreviousResume(g), 'keep')
        })
      items.push({ key: 'folder', label: 'Open backups folder', run: () => h.command('open-folder', `backups:${g.console}`) })
      return { id, title: 'Save backups', items }
    }
    case 'backup': {
      const [gid, bid] = (arg ?? '').split('|')
      const g = state.library.games.find((x) => x.id === gid)
      const b = g && x.details[g.id]?.backups.find((y) => y.id === bid)
      if (!g || !b) return null
      return {
        id,
        title: `Backup from ${formatDate(b.createdAt)}`,
        items: [
          { key: 'msg', label: 'Restoring replaces the current saves. They are backed up first, so you can go back.', info: true },
          { key: 'restore', label: 'Restore this backup', run: () => h.restoreBackup(g, b.id) },
          { key: 'open', label: 'Open this backup folder', run: () => h.command('open-path', b.folder) },
          { key: 'cancel', label: 'Cancel' }
        ]
      }
    }
    case 'folders': {
      const g = state.library.games.find((x) => x.id === arg)
      if (!g) return null
      return {
        id,
        title: 'Open folder',
        items: [
          { key: 'game', label: 'Game files', run: () => h.command('open-folder', `game:${g.id}`) },
          { key: 'saves', label: 'Saves', run: () => h.command('open-folder', `saves:${g.console}`) },
          { key: 'backups', label: 'Save backups', run: () => h.command('open-folder', `backups:${g.console}`) },
          { key: 'shots', label: 'Screenshots', run: () => h.command('open-folder', `screenshots:${g.console}`) },
          { key: 'mods', label: 'Mods', run: () => h.command('open-folder', `mods:${g.console}`) }
        ]
      }
    }
    case 'delete': {
      const g = state.library.games.find((x) => x.id === arg)
      if (!g) return null
      const d = x.details[g.id]
      const items: PItem[] = [
        { key: 'msg', label: `${g.title} goes to the Recycle Bin, so you can still get it back.`, info: true },
        { key: 'keep', label: 'Delete game, keep saves', run: () => h.deleteGame(g, false) }
      ]
      if (d?.ownSaves) items.push({ key: 'all', label: 'Delete game and its saves', run: () => h.deleteGame(g, true) })
      else items.push({ key: 'shared', label: 'Its saves stay: none belong only to this game (memory cards are shared).', info: true })
      items.push({ key: 'cancel', label: 'Cancel' })
      return { id, title: 'Delete game?', items }
    }
    case 'mods': {
      const g = state.library.games.find((x) => x.id === arg)
      if (!g) return null
      const v = x.mods[g.id]
      if (!v) return { id, title: 'Mods', items: [{ key: 'loading', label: 'Loading…', info: true }] }
      const items: PItem[] = []
      if (v.reason) items.push({ key: 'reason', label: `${v.reason} Patch files still work.`, info: true })
      if (v.mods.length)
        items.push({ key: 'profile', label: 'Mod profile', value: v.profiles.find((p) => p.id === v.active)?.name ?? 'Custom', run: () => (h.openPanel('mod-profiles', g.id), 'keep') })
      for (const m of v.mods)
        items.push({
          key: `mod-${m.id}`,
          label: m.name,
          value: m.manual ? 'by hand' : m.enabled ? 'On' : 'Off',
          run: () => (h.openPanel(m.manual ? 'mod-manual' : 'mod', `${g.id}|${m.id}`), 'keep')
        })
      if (!v.mods.length && !v.reason)
        items.push({ key: 'none', label: 'No mods yet. Easiest: put the mod (zip, 7z, folder or patch) into the mods folder — Starstation adds it and switches it on by itself.', info: true })
      // patch files (.ips .bps .ppf .xdelta) work for every game
      items.push({ key: 'add-file', label: 'Add mod from file…', value: v.targets.length ? undefined : 'patch files: .ips .bps .ppf .xdelta', run: () => (h.modAddDialog(g, false), 'keep') })
      if (v.targets.length) {
        items.push({ key: 'add-folder', label: 'Add mod folder…', run: () => (h.modAddDialog(g, true), 'keep') })
        if (v.gamebanana) items.push({ key: 'gb', label: 'Browse GameBanana…', run: () => (h.gbOpen(g), 'keep') })
      }
      items.push({ key: 'open', label: 'Open mods folder', value: 'drop mods here', run: () => h.command('open-folder', `mods:${g.console}`) })
      return { id, title: `Mods · ${g.title}`, items }
    }
    case 'mod-inbox': {
      const q = x.modInbox
      if (!q) return null
      const games = q.games.map((gid) => state.library.games.find((g) => g.id === gid)).filter((g): g is Game => !!g)
      return {
        id,
        title: 'New mod',
        items: [
          { key: 'name', label: q.name, info: true },
          { key: 'ask', label: 'Which game is this mod for?', info: true },
          ...games.map((g) => ({ key: `mi-${g.id}`, label: g.title, value: state.consoles.find((c) => c.id === g.console)?.short, run: () => h.modInboxAssign(g.id) })),
          { key: 'later', label: 'Not now', value: 'asked again next time', run: () => h.modInboxAssign('') }
        ]
      }
    }
    case 'nexus': {
      const n = x.nexus
      if (!n) return null
      // games whose names share the most words with the Nexus game come first
      const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1))
      const want = words(n.gameName)
      const ranked = state.library.games
        .map((g) => ({ g, n: [...words(g.title)].filter((w) => want.has(w)).length }))
        .sort((a, b) => b.n - a.n || a.g.title.localeCompare(b.g.title))
        .slice(0, 15)
      return {
        id,
        title: `Nexus Mods · ${n.modName}`,
        image: n.picture,
        items: [
          ...(n.summary ? [{ key: 'sum', label: n.summary, info: true }] : []),
          { key: 'from', label: `On Nexus Mods for: ${n.gameName}${n.fileName ? ` · ${n.fileName}` : ''}`, info: true },
          { key: 'ask', label: 'Which game is this mod for?', info: true },
          ...ranked.map(({ g }) => ({ key: `nx-${g.id}`, label: g.title, value: state.consoles.find((c) => c.id === g.console)?.short, run: () => h.nexusInstall(n.url, g) }))
        ]
      }
    }
    case 'system':
      return {
        id,
        title: 'System',
        items: [
          { key: 'what', label: 'Windows settings, from here with the controller.', info: true },
          { key: 'sound', label: 'Sound output', value: x.sys?.audio?.find((a) => a.default)?.name, run: () => (h.openPanel('sound'), 'keep') },
          { key: 'screen', label: 'Screen resolution and refresh rate', run: () => (h.openPanel('screen'), 'keep') },
          { key: 'bt', label: 'Bluetooth controllers', run: () => (h.openPanel('bluetooth'), 'keep') }
        ]
      }
    case 'sound': {
      const list = x.sys?.audio
      if (!list) return { id, title: 'Sound output', items: [{ key: 'loading', label: 'Looking…', info: true }] }
      return {
        id,
        title: 'Sound output',
        items: list.length
          ? list.map((a) => ({ key: `snd-${a.id}`, label: a.name, value: a.default ? 'In use' : undefined, run: () => (h.sysAudioSet(a.id), 'keep' as const) }))
          : [{ key: 'none', label: 'No playback devices found.', info: true }]
      }
    }
    case 'screen': {
      const list = x.sys?.display
      if (!list) return { id, title: 'Screen', items: [{ key: 'loading', label: 'Looking…', info: true }] }
      // the most common first: current resolution's refresh rates, then the bigger resolutions
      const sorted = [...list].sort((a, b) => Number(b.current) - Number(a.current) || b.w * b.h - a.w * a.h || b.hz - a.hz)
      return {
        id,
        title: 'Screen resolution and refresh rate',
        items: [
          { key: 'what', label: 'A new mode goes back by itself after 15 seconds unless you keep it.', info: true },
          ...sorted.slice(0, 40).map((m) => ({
            key: `mode-${m.w}x${m.h}@${m.hz}`,
            label: `${m.w} × ${m.h}`,
            value: `${m.hz} Hz${m.current ? ' · now' : ''}`,
            run: () => (m.current ? undefined : h.sysDisplaySet(m.w, m.h, m.hz))
          }))
        ]
      }
    }
    case 'screen-keep':
      return {
        id,
        title: 'Keep this screen mode?',
        items: [
          { key: 'left', label: `Going back in ${x.sys?.keepLeft ?? 15} seconds.`, info: true },
          { key: 'keep', label: 'Keep it', run: () => h.sysDisplayKeep(true) },
          { key: 'back', label: 'Go back', run: () => h.sysDisplayKeep(false) }
        ]
      }
    case 'bluetooth': {
      const list = x.sys?.bt
      const pads = (list ?? []).filter((d) => (d.cod & 0x1f00) === 0x0500 || /controller|gamepad|dualshock|dualsense|wireless|xbox|pro/i.test(d.name))
      return {
        id,
        title: 'Bluetooth controllers',
        items: [
          { key: 'how', label: 'Put the controller into pairing mode (PS4/PS5: hold Share/Create + PS until the light flashes), then search.', info: true },
          { key: 'scan', label: x.sys?.btBusy ?? 'Search for controllers', disabled: !!x.sys?.btBusy, run: () => (h.sysBluetooth(true), 'keep') },
          ...(list && !pads.length ? [{ key: 'none', label: 'No controllers found.', info: true }] : []),
          ...pads.map((d) => ({
            key: `bt-${d.address}`,
            label: d.name || d.address,
            value: d.paired ? (d.connected ? 'Connected · ✕ to forget' : 'Paired · ✕ to forget') : 'Pair',
            disabled: !!x.sys?.btBusy,
            run: () => ((d.paired ? h.sysBluetoothRemove(d.address) : h.sysBluetoothPair(d.address)), 'keep' as const)
          }))
        ]
      }
    }
    case 'accessibility': {
      const map = (() => {
        try {
          return JSON.parse(s.buttonMap || '{}') as Record<string, number>
        } catch {
          return {}
        }
      })()
      const names: Record<string, string> = { confirm: 'Select (confirm)', back: 'Back', options: 'Options (game menu)', search: 'Search', select: 'Favorite', start: 'Start', l1: 'Previous column', r1: 'Next column' }
      const label = { normal: 'Normal', large: 'Large', larger: 'Larger' }
      const order: Settings['textSize'][] = ['normal', 'large', 'larger']
      return {
        id,
        title: 'Accessibility',
        items: [
          { key: 'text', label: 'Text size', value: label[s.textSize], run: () => (h.setSetting('textSize', order[(order.indexOf(s.textSize) + 1) % order.length]), 'keep') },
          { key: 'btn', label: 'Menu buttons (press to move to the next button):', info: true },
          ...Object.entries(names).map(([a, n]) => ({ key: `map-${a}`, label: n, value: x.buttonNames?.[a] ?? '', run: () => (h.remapButton(a), 'keep' as const) })),
          ...(Object.keys(map).length ? [{ key: 'reset', label: 'Standard buttons again', run: () => (h.setSetting('buttonMap', ''), 'keep' as const) }] : [])
        ]
      }
    }
    case 'who': {
      const list = x.profiles ?? []
      return {
        id,
        title: 'Who’s playing?',
        items: list.map((p) => ({
          key: `who-${p.id}`,
          label: p.name,
          value: [p.active ? 'last time' : '', p.hasPin ? 'PIN' : ''].filter(Boolean).join(' · ') || undefined,
          run: () => (p.active ? undefined : h.switchProfile(p))
        }))
      }
    }
    case 'profile': {
      const p = x.profiles?.find((y) => y.id === arg)
      if (!p) return null
      const me = x.profiles?.find((y) => y.active)
      return {
        id,
        title: p.name,
        items: [
          ...(p.active ? [] : [{ key: 'switch', label: 'Switch to this profile', run: () => h.switchProfile(p) }]),
          { key: 'name', label: 'Rename…', run: () => h.profileEdit(p.id, 'name') },
          { key: 'pic', label: 'Picture', value: p.image ? 'your picture' : 'change', run: () => (h.profileEdit(p.id, 'picture'), 'keep') },
          { key: 'own', label: 'Use your own picture…', run: () => (h.profileEdit(p.id, 'own-picture'), 'keep') },
          { key: 'pin', label: p.hasPin ? 'Change PIN…' : 'Set a PIN…', value: '4 digits', run: () => h.profileEdit(p.id, 'pin') },
          ...(p.hasPin ? [{ key: 'nopin', label: me?.main && !p.main ? 'Reset PIN (first profile)' : 'Remove PIN', run: () => h.profileEdit(p.id, 'nopin') }] : []),
          ...(p.main || p.active ? [] : [{ key: 'del', label: 'Delete profile…', value: 'its saves go to the Recycle Bin', run: () => h.profileEdit(p.id, 'delete') }])
        ]
      }
    }
    case 'display': {
      const keys = Object.keys(THEMES)
      const w = x.wallpapers
      return {
        id,
        title: 'Theme & display',
        items: [
          ...(state.info.safeMode ? [{ key: 'safe', label: 'Safe mode: themes and pictures are off until you leave it.', info: true }] : []),
          { key: 'theme', label: 'Theme', value: THEMES[s.theme]?.label ?? s.theme, run: () => (h.setSetting('theme', keys[(keys.indexOf(s.theme) + 1) % keys.length]), 'keep') },
          { key: 'tv', label: 'TV mode', value: s.tvMode ? 'On: everything bigger' : 'Off', run: () => (h.setSetting('tvMode', !s.tvMode), 'keep') },
          { key: 'video', label: 'Video previews', value: s.videoPreviews ? 'On (after 2 s on a game)' : 'Off', run: () => (h.setSetting('videoPreviews', !s.videoPreviews), 'keep') },
          { key: 'own', label: 'Background picture', value: w?.own ? 'your picture' : 'none', run: () => (h.setWallpaper('own'), 'keep') },
          ...(w?.own ? [{ key: 'own-off', label: 'Remove background picture', run: () => (h.setWallpaper('own', true), 'keep' as const) }] : []),
          { key: 'consoles', label: 'Wallpaper per console…', run: () => (h.openPanel('wallpapers'), 'keep') }
        ]
      }
    }
    case 'wallpapers': {
      const w = x.wallpapers
      const withGames = state.consoles.filter((c) => c.gameCount > 0)
      return {
        id,
        title: 'Wallpaper per console',
        items: [
          { key: 'what', label: 'Shown on that console’s column. Pick a picture, or press again to remove it.', info: true },
          ...withGames.map((c) => ({
            key: `wp-${c.id}`,
            label: c.name,
            value: w?.consoles[c.id] ? 'your picture (✕ to remove)' : 'none',
            run: () => (h.setWallpaper(`console:${c.id}`, !!w?.consoles[c.id]), 'keep' as const)
          }))
        ]
      }
    }
    case 'power':
      return {
        id,
        title: 'Power',
        items: [
          { key: 'sleep', label: 'Sleep', value: 'the PC sleeps; a key or the power button wakes it', run: () => h.power('sleep') },
          { key: 'off', label: 'Turn off PC', run: () => (h.openPanel('power-off'), 'keep') },
          { key: 'quit', label: 'Quit Starstation', run: () => h.command('quit') }
        ]
      }
    case 'power-off':
      return {
        id,
        title: 'Turn off the PC?',
        items: [
          { key: 'what', label: running(state) ? 'A game is still running: close it first.' : 'Windows shuts down right away.', info: true },
          { key: 'go', label: 'Turn off PC', disabled: running(state), run: () => h.power('shutdown') },
          { key: 'no', label: 'Cancel', run: () => undefined }
        ]
      }
    case 'mod-sources': {
      const s = x.nexusStatus
      return {
        id,
        title: 'Mod sources',
        items: [
          { key: 'gb', label: 'GameBanana: built in — game options → Mods → Browse GameBanana', info: true },
          {
            key: 'nx',
            label: s?.key ? 'Nexus Mods: ready' : 'Nexus Mods: needs your free API key',
            value: s?.key ? (s.registered ? '“Download with mod manager” opens Starstation' : 'links open the installed Starstation') : undefined,
            info: true
          },
          ...(s?.key
            ? []
            : [
                { key: 'nx1', label: 'nexusmods.com → your account → API keys: copy the personal key,', info: true },
                { key: 'nx2', label: 'then put it into secrets.json under "nexus" → "apiKey".', info: true }
              ]),
          { key: 'site', label: 'Open nexusmods.com', run: () => h.command('open-url', 'https://www.nexusmods.com') },
          {
            key: 'patches',
            label: x.patchesBusy ? 'Updating patches…' : 'Update patches',
            value: `widescreen, 60 fps and fixes for PCSX2 + RPCS3${s?.patches.pcsx2 || s?.patches.rpcs3 ? ` · last ${formatDate(Date.parse(s.patches.pcsx2 ?? s.patches.rpcs3 ?? ''))}` : ''}`,
            disabled: !!x.patchesBusy,
            run: () => (h.updatePatches(), 'keep')
          },
          { key: 'dolphin', label: 'Dolphin’s own game patches come with Dolphin updates.', info: true },
          { key: 'secrets', label: 'Open secrets.json', run: () => h.command('open-secrets') }
        ]
      }
    }
    case 'mod-manual': {
      const [gid, mid] = (arg ?? '').split('|')
      const g = state.library.games.find((y) => y.id === gid)
      const m = g && x.mods[g.id]?.mods.find((y) => y.id === mid)
      if (!g || !m?.manual) return null
      const emu = state.consoles.find((c) => c.id === g.console)?.emulatorId
      return {
        id,
        title: `${m.name} · install by hand`,
        items: [
          { key: 'why', label: 'Starstation can’t tell where this mod goes. Its own instructions:', info: true },
          ...m.manual.lines.map((l, i) => ({ key: `l${i}`, label: l, info: true })),
          { key: 'files', label: 'Open the mod’s files', run: () => h.command('open-path', m.manual!.folder) },
          ...(emu ? [{ key: 'target', label: 'Open the emulator folder', run: () => h.command('open-folder', `emulators:${emu}`) }] : []),
          { key: 'del', label: 'Delete this mod', run: () => h.modDelete(g, m.id) }
        ]
      }
    }
    case 'mod-profiles': {
      const g = state.library.games.find((y) => y.id === arg)
      const v = g && x.mods[g.id]
      if (!g || !v) return null
      const items: PItem[] = [{ key: 'what', label: 'Switch between sets of mods while the game isn’t running. Vanilla = no mods.', info: true }]
      for (const p of v.profiles)
        items.push({
          key: `prof-${p.id}`,
          label: p.name,
          value: p.id === v.active ? 'Active' : p.id === 'vanilla' ? 'no mods' : `${p.mods.length} mod(s)`,
          run: () => (h.modProfile(g, p.id), 'keep')
        })
      if (!v.active) items.push({ key: 'custom', label: 'Now: your own mix (Custom)', info: true })
      items.push({ key: 'save', label: 'Save the mods that are on now as a profile…', run: () => h.newModProfile(g) })
      if (v.profiles.length > 1) items.push({ key: 'del', label: 'Delete a profile…', run: () => (h.openPanel('mod-profile-delete', g.id), 'keep') })
      return { id, title: `Mod profiles · ${g.title}`, items }
    }
    case 'mod-profile-delete': {
      const g = state.library.games.find((y) => y.id === arg)
      const v = g && x.mods[g.id]
      if (!g || !v) return null
      return {
        id,
        title: 'Delete a profile',
        items: [
          { key: 'what', label: 'The mods stay installed; only the profile goes.', info: true },
          ...v.profiles.filter((p) => p.id !== 'vanilla').map((p) => ({ key: `delp-${p.id}`, label: `Delete “${p.name}”`, run: () => h.modProfileDelete(g, p.id) }))
        ]
      }
    }
    case 'mod': {
      const [gid, mid] = (arg ?? '').split('|')
      const g = state.library.games.find((y) => y.id === gid)
      const m = g && x.mods[g.id]?.mods.find((y) => y.id === mid)
      if (!g || !m) return null
      const items: PItem[] = []
      if (m.description) items.push({ key: 'desc', label: m.description.length > 260 ? m.description.slice(0, 257) + '…' : m.description, info: true })
      items.push({ key: 'where', label: `${m.target} · ${m.files} file${m.files === 1 ? '' : 's'}${m.source === 'gamebanana' ? ' · from GameBanana' : ''}`, info: true })
      items.push({ key: 'toggle', label: m.enabled ? 'Switch off' : 'Switch on', value: m.enabled ? 'On' : 'Off', run: () => (h.modToggle(g, m.id, !m.enabled), 'keep') })
      items.push({ key: 'delete', label: 'Delete mod', run: () => (h.modDelete(g, m.id), undefined) })
      return { id, title: m.name, items, image: m.image }
    }
    case 'mod-conflict': {
      const q = x.modConflict
      const g = q && state.library.games.find((y) => y.id === q.gameId)
      if (!q || !g) return null
      return {
        id,
        title: 'Two mods change the same files',
        items: [
          { key: 'msg', label: `${q.name} and ${q.with.join(', ')} both change ${q.files} file${q.files === 1 ? '' : 's'}. Which one should win?`, info: true },
          { key: 'this', label: `Use ${q.name}`, run: () => (h.modToggle(g, q.modId, true, 'this'), 'keep') },
          { key: 'other', label: `Keep ${q.with.join(', ')}`, run: () => (h.modToggle(g, q.modId, true, 'other'), 'keep') },
          { key: 'cancel', label: 'Cancel' }
        ]
      }
    }
    case 'mod-place': {
      const q = x.modAsk
      if (!q) return null
      return {
        id,
        title: 'Where does this mod go?',
        items: [
          { key: 'msg', label: `Starstation isn't sure what kind of mod "${q.name}" is.`, info: true },
          ...q.targets.map((t) => ({ key: `t-${t.id}`, label: t.label, run: () => (h.modPlace(q.gameId, q.pending, t.id), 'keep' as const) })),
          { key: 'manual', label: 'None of these: keep it and show its instructions', run: () => (h.modPlace(q.gameId, q.pending, 'manual'), 'keep' as const) },
          { key: 'cancel', label: 'Cancel', run: () => (h.modPlace(q.gameId, q.pending, ''), 'keep' as const) }
        ]
      }
    }
    case 'gb-games': {
      const g = state.library.games.find((y) => y.id === arg)
      if (!g) return null
      const items: PItem[] = []
      if (x.gb.busy) items.push({ key: 'busy', label: x.gb.busy, info: true })
      if (x.gb.error) items.push({ key: 'err', label: x.gb.error, info: true })
      if (x.gb.games && !x.gb.games.length) items.push({ key: 'none', label: `GameBanana has no page for "${g.title}".`, info: true })
      for (const gg of x.gb.games ?? []) items.push({ key: `gg-${gg.id}`, label: gg.name, run: () => (h.gbChoose(g, gg.id), 'keep') })
      return { id, title: 'Which game on GameBanana?', items }
    }
    case 'gb-mods': {
      const g = state.library.games.find((y) => y.id === arg)
      if (!g) return null
      const items: PItem[] = []
      if (x.gb.busy) items.push({ key: 'busy', label: x.gb.busy, info: true })
      if (x.gb.error) items.push({ key: 'err', label: x.gb.error, info: true })
      if (x.gb.mods && !x.gb.mods.length) items.push({ key: 'none', label: 'No mods for this game on GameBanana.', info: true })
      for (const m of x.gb.mods ?? [])
        items.push({
          key: `gm-${m.id}`,
          label: m.name,
          value: m.downloads ? `${m.downloads.toLocaleString()} downloads` : undefined,
          run: () => (h.openPanel('gb-mod', `${g.id}|${m.id}`), 'keep')
        })
      if (x.gb.more) items.push({ key: 'more', label: 'Show more…', run: () => (h.gbMore(g), 'keep') })
      return { id, title: 'GameBanana', items }
    }
    case 'gb-mod': {
      const [gid, mid] = (arg ?? '').split('|')
      const g = state.library.games.find((y) => y.id === gid)
      const d = x.gb.detail[Number(mid)]
      if (!g) return null
      if (!d) return { id, title: 'GameBanana', items: [{ key: 'loading', label: x.gb.error ?? 'Loading…', info: true }] }
      const items: PItem[] = []
      if (x.gb.busy) items.push({ key: 'busy', label: x.gb.busy, info: true })
      if (d.text) items.push({ key: 'text', label: d.text.length > 320 ? d.text.slice(0, 317) + '…' : d.text, info: true })
      for (const f of d.files)
        items.push(
          f.ok
            ? { key: `f-${f.id}`, label: `Install ${f.name}`, value: formatSize(f.size), disabled: !!x.gb.busy, run: () => (h.gbInstall(g, d.id, f.id), 'keep') }
            : { key: `f-${f.id}`, label: `${f.name}: can't be installed here`, info: true }
        )
      if (!d.files.length) items.push({ key: 'nofiles', label: 'This mod has no files to download.', info: true })
      return { id, title: d.name, items, image: d.image }
    }
    case 'add-ask': {
      const q = x.addAsk?.[0]
      if (!q) return null
      const name = q.path.split(/[\\/]/).pop()
      return {
        id,
        title: 'Which console is this for?',
        items: [
          { key: 'file', label: name ?? q.path, info: true },
          ...q.options.map((o) => {
            const c = state.consoles.find((y) => y.id === o)
            return { key: `as-${o}`, label: c?.name ?? o, run: () => (h.addGameAs(q.path, o), 'keep' as const) }
          }),
          { key: 'skip', label: 'Skip this file', run: () => (h.addGameAs(q.path, ''), 'keep' as const) }
        ]
      }
    }
    case 'info': {
      const g = state.library.games.find((x) => x.id === arg)
      if (!g) return null
      const st = state.library.stats[g.id]
      const rows: [string, string | undefined][] = [
        ['Title', g.title],
        ['ID', g.serial],
        ['Year', g.year],
        ['Genre', g.genre],
        ['Players', g.players ? String(g.players) : undefined],
        ['Size', formatSize(g.size)],
        ['Play time', formatPlayTime(st?.playTime ?? 0)],
        ['File', g.path]
      ]
      return {
        id,
        title: 'Game info',
        items: rows.filter(([, v]) => v).map(([k, v]) => ({ key: k, label: `${k}: ${v}`, info: true }))
      }
    }
  }
  return null
}
