import type { AppState, EmulatorInfo, Game, ImportProgressInfo, ImportResultInfo, ImportSourceInfo, Settings } from '../../../shared/types'
import { formatPlayTime } from './model'

/** Data some panels load on demand. */
export interface PanelExtra {
  emulators?: EmulatorInfo[]
  emuProgress: Record<string, string>
  importSources?: ImportSourceInfo[]
  importProgress?: ImportProgressInfo
  importResult?: ImportResultInfo
  importing: boolean
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
}

const onOff = (b: boolean) => (b ? 'On' : 'Off')

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
      return {
        id,
        title: g.title,
        items: [
          { key: 'play', label: 'Play', run: () => h.launch(g) },
          {
            key: 'fav',
            label: st?.favorite ? 'Remove from Favorites' : 'Add to Favorites',
            run: () => (h.toggleFavorite(g), 'keep')
          },
          { key: 'folder', label: 'Open game folder', run: () => h.command('open-folder', `game:${g.id}`) },
          { key: 'saves', label: 'Open saves folder', run: () => h.command('open-folder', `saves:${g.console}`) },
          { key: 'info', label: 'Game info', run: () => (h.openPanel('info', g.id), 'keep') }
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
