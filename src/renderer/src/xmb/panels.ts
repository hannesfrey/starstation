import type { AddGamesResult, AppState, EmulatorInfo, Game, GameDetails, GbGame, GbMod, GbModDetails, ModsView, GraphicsLevel, ImportProgressInfo, ImportResultInfo, ImportSourceInfo, Settings } from '../../../shared/types'
import { formatPlayTime } from './model'

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
  deleteGame: (g: Game, withSaves: boolean) => void
  addGamesDialog: () => void
  addGameAs: (path: string, consoleId: string) => void
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
              run: () => {
                if (e.page) h.command('open-url', e.page)
                else if (!e.installed || e.updateAvailable) h.installEmulator(e.id)
                return 'keep' as const
              }
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
            key: 'gfx',
            label: 'Graphics for games',
            value: LEVEL_LABEL[s.graphicsDefault],
            run: () => (h.setSetting('graphicsDefault', nextLevel(s.graphicsDefault)), 'keep')
          },
          { key: 'crt', label: 'CRT filter for retro games', value: onOff(s.crtDefault), run: () => (h.setSetting('crtDefault', !s.crtDefault), 'keep') },
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
      return {
        id,
        title: c.name,
        items: [
          { key: 'status', label: c.statusText, info: true },
          { key: 'emu', label: `Emulator: ${c.emulatorName}`, info: true },
          { key: 'types', label: `Game files: ${c.extensions.join(' ')}`, info: true },
          { key: 'games', label: 'Open games folder', run: () => h.command('open-folder', `games:${c.id}`) },
          { key: 'bios', label: 'Open BIOS folder', run: () => h.command('open-folder', `bios:${c.id}`) },
          { key: 'saves', label: 'Open saves folder', run: () => h.command('open-folder', `saves:${c.id}`) }
        ]
      }
    }
    case 'library':
      return {
        id,
        title: 'Library',
        items: [
          { key: 'count', label: `${state.library.games.length} games`, info: true },
          { key: 'add', label: 'Add games…', run: () => h.addGamesDialog() },
          { key: 'drop', label: 'Tip: you can also drag game files into this window.', info: true },
          { key: 'rescan', label: 'Rescan games', run: () => h.command('rescan') },
          { key: 'games', label: 'Open games folder', run: () => h.command('open-folder', 'games') }
        ]
      }
    case 'about':
      return {
        id,
        title: 'About Starstation',
        items: [
          { key: 'v', label: `Version ${state.info.version}`, info: true },
          { key: 'f', label: `Folder: ${state.info.filesDir}`, info: true },
          { key: 'logs', label: 'Open logs folder', run: () => h.command('open-folder', 'logs') }
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
        { key: 'delete', label: 'Delete game…', run: () => (h.openPanel('delete', g.id), 'keep') }
      )
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
