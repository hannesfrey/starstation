import type { UpdateState, AddGamesResult, AppState, CustomConsoleForm, PackageChoice, PackageProgress, EmulatorInfo, Game, GameDetails, GbGame, GbMod, GbModDetails, HealthIssue, ModsView, NetplayRoom, GraphicsLevel, ImportProgressInfo, ImportResultInfo, ImportSourceInfo, Settings } from '../../../shared/types'
import { formatPlayTime } from './model'
import { compareVersions } from '../../../shared/semver'
import { whatsNewFor } from '../../../shared/whatsnew'
import type { StartNotes } from '../../../shared/types'

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
  launch: (g: Game) => void
  toggleFavorite: (g: Game) => void
  openPanel: (id: string, arg?: string) => void
  installEmulator: (id: string) => void
  checkUpdates: () => void
  runImport: (index: number) => void
  launchMode: (g: Game, mode: 'fresh' | 'resume') => void
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
}

const onOff = (b: boolean) => (b ? 'On' : 'Off')
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
      items.push({ key: 'folder', label: 'From a folder…', disabled: x.pkg.busy, run: () => (h.pkgReceiveFolder(!existing || !!x.pkg.useSettings), 'keep') })
      return { id, title: 'Receive package', items }
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
      if (d?.mods.supported ?? true)
        items.push({
          key: 'mods',
          label: 'Mods',
          value: d?.mods.total ? `${d.mods.on} of ${d.mods.total} on` : undefined,
          run: () => (h.openPanel('mods', g.id), 'keep')
        })
      items.push(
        { key: 'folders', label: 'Open folder…', run: () => (h.openPanel('folders', g.id), 'keep') },
        { key: 'info', label: 'Game info', run: () => (h.openPanel('info', g.id), 'keep') },
        { key: 'art', label: 'Refresh artwork', run: () => (h.refreshArtwork(g), 'keep') },
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
      if (v.reason) items.push({ key: 'reason', label: v.reason, info: true })
      for (const m of v.mods)
        items.push({ key: `mod-${m.id}`, label: m.name, value: m.enabled ? 'On' : 'Off', run: () => (h.openPanel('mod', `${g.id}|${m.id}`), 'keep') })
      if (!v.mods.length && !v.reason) items.push({ key: 'none', label: 'No mods yet. Add a file or folder, or drag one onto this window.', info: true })
      if (v.targets.length) {
        items.push({ key: 'add-file', label: 'Add mod from file…', run: () => (h.modAddDialog(g, false), 'keep') })
        items.push({ key: 'add-folder', label: 'Add mod folder…', run: () => (h.modAddDialog(g, true), 'keep') })
        if (v.gamebanana) items.push({ key: 'gb', label: 'Browse GameBanana…', run: () => (h.gbOpen(g), 'keep') })
      }
      items.push({ key: 'open', label: 'Open mods folder', run: () => h.command('open-folder', `mods:${g.console}`) })
      return { id, title: `Mods · ${g.title}`, items }
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
