import type { AppState, ConsoleInfo, Game, GameStats } from '../../../shared/types'

export interface XItem {
  key: string
  label: string
  sub?: string
  icon: string
  /** Absolute path of box art / icon image. */
  art?: string
  game?: Game
  kind: 'game' | 'folder' | 'action' | 'info'
  /** For folders: the items inside. */
  children?: () => XItem[]
  /** For actions: what ✕ does. */
  run?: () => void
  /** What △ does on a non-game item (e.g. rename a collection). */
  options?: () => void
  /** Shown under the item list when a folder is empty. */
  emptyText?: string
}

export interface XColumn {
  id: string
  label: string
  icon: string
  items: XItem[]
  console?: ConsoleInfo
  /** Number of games in this console column. */
  games?: number
}

export interface ModelHandlers {
  openPanel: (id: string, arg?: string) => void
  command: (cmd: string, arg?: string) => void
  toggleFullscreen: () => void
  quit: () => void
  openSearch: () => void
  newCollection: () => void
}

export function formatPlayTime(sec: number): string {
  if (sec < 60) return sec > 0 ? 'Played less than a minute' : 'Not played yet'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `Played ${h ? `${h}h ` : ''}${m}m`
}

export function gameItem(g: Game, s?: GameStats, c?: ConsoleInfo): XItem {
  const play = s && s.playTime > 0 ? formatPlayTime(s.playTime) : 'Not played yet'
  return {
    key: g.id,
    label: g.title,
    sub: c ? `${c.short} · ${play}` : play,
    icon: c?.icon ?? 'disc',
    art: g.icon,
    game: g,
    kind: 'game'
  }
}

const byTitle = (a: Game, b: Game) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true })

export function buildColumns(state: AppState, h: ModelHandlers): XColumn[] {
  const { library, consoles, settings } = state
  const stats = library.stats
  const cols: XColumn[] = []

  // ---- Settings ----
  cols.push({
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    items: [
      { key: 'general', label: 'General', sub: 'Fullscreen, sounds, empty consoles, button icons', icon: 'settings', kind: 'action', run: () => h.openPanel('general') },
      {
        key: 'consoles',
        label: 'Consoles',
        sub: `${consoles.filter((c) => c.gameCount > 0).length} with games`,
        icon: 'controller',
        kind: 'folder',
        children: () =>
          consoles.map((c) => ({
            key: `console-${c.id}`,
            label: c.name,
            sub: c.statusText,
            icon: c.icon,
            kind: 'action' as const,
            run: () => h.openPanel('console', c.id)
          }))
      },
      {
        key: 'emulators',
        label: 'Emulators',
        sub: 'Installed versions and updates',
        icon: 'emulator',
        kind: 'action',
        run: () => h.openPanel('emulators')
      },
      {
        key: 'import',
        label: 'Import from EmuDeck',
        sub: 'Bring emulators, BIOS, saves and games over',
        icon: 'package',
        kind: 'action',
        run: () => h.openPanel('import')
      },
      {
        key: 'library',
        label: 'Library',
        sub: `${library.games.length} games`,
        icon: 'library',
        kind: 'action',
        run: () => h.openPanel('library')
      },
      {
        key: 'display',
        label: 'Fullscreen',
        sub: 'Switch between window and fullscreen',
        icon: 'display',
        kind: 'action',
        run: () => h.toggleFullscreen()
      },
      {
        key: 'about',
        label: 'About Starstation',
        sub: `Version ${state.info.version}`,
        icon: 'about',
        kind: 'action',
        run: () => h.openPanel('about')
      },
      { key: 'quit', label: 'Quit Starstation', icon: 'power', kind: 'action', run: () => h.quit() }
    ]
  })

  // ---- Photo ----
  cols.push({
    id: 'photo',
    label: 'Photo',
    icon: 'photo',
    items: [
      {
        key: 'screenshots-folder',
        label: 'Screenshots folder',
        sub: 'Open the folder with all screenshots',
        icon: 'folder',
        kind: 'action',
        run: () => h.command('open-folder', 'screenshots')
      }
    ]
  })

  // ---- Collections ----
  const byId = new Map(consoles.map((c) => [c.id, c]))
  const mixed = (list: Game[]) => list.map((g) => gameItem(g, stats[g.id], byId.get(g.console)))
  const favs = library.games.filter((g) => stats[g.id]?.favorite).sort(byTitle)
  const known = new Map(library.games.map((g) => [g.id, g]))
  const colItems: XItem[] = [
    {
      key: 'col-favorites',
      label: 'Favorites',
      sub: `${favs.length} games`,
      icon: 'favorite',
      kind: 'folder',
      children: () => mixed(favs),
      emptyText: 'Press SELECT on a game to add it to Favorites.'
    }
  ]
  for (const uc of state.collections) {
    const list = uc.games.map((id) => known.get(id)).filter((g): g is Game => !!g).sort(byTitle)
    colItems.push({
      key: `col-${uc.id}`,
      label: uc.name,
      sub: `${list.length} games`,
      icon: 'collections',
      kind: 'folder',
      children: () => mixed(list),
      emptyText: 'Press TRIANGLE on a game and choose "Add to collection".',
      options: () => h.openPanel('collection', uc.id)
    })
  }
  const monthAgo = Date.now() - 30 * 24 * 3600_000
  const auto: [string, string, Game[]][] = [
    ['auto-recent', 'Recently added', library.games.filter((g) => g.addedAt > monthAgo).sort((x, y) => y.addedAt - x.addedAt).slice(0, 30)],
    ['auto-multi', '2+ players', library.games.filter((g) => (g.players ?? 0) >= 2).sort(byTitle)],
    ['auto-unplayed', 'Not played yet', library.games.filter((g) => !stats[g.id]?.playTime).sort(byTitle)],
    [
      'auto-most',
      'Most played',
      library.games
        .filter((g) => (stats[g.id]?.playTime ?? 0) > 0)
        .sort((x, y) => (stats[y.id]?.playTime ?? 0) - (stats[x.id]?.playTime ?? 0))
        .slice(0, 20)
    ]
  ]
  for (const [key, label, list] of auto)
    if (list.length) colItems.push({ key, label, sub: `${list.length} games · automatic`, icon: 'library', kind: 'folder', children: () => mixed(list) })
  colItems.push({ key: 'col-new', label: 'New collection', sub: 'Make your own list of games', icon: 'collections', kind: 'action', run: () => h.newCollection() })
  cols.push({ id: 'collections', label: 'Collections', icon: 'collections', items: colItems })

  // ---- Consoles ----
  for (const c of consoles) {
    const games = library.games.filter((g) => g.console === c.id).sort(byTitle)
    if (games.length === 0 && !settings.showEmptyConsoles) continue
    const items: XItem[] = games.length
      ? [{ key: `${c.id}-search`, label: 'Search', sub: 'Find a game on any console', icon: 'search', kind: 'action', run: () => h.openSearch() }]
      : []
    const recent = games
      .filter((g) => stats[g.id]?.lastPlayed)
      .sort((a, b) => (stats[b.id]!.lastPlayed ?? 0) - (stats[a.id]!.lastPlayed ?? 0))
      .slice(0, 10)
    const cFavs = games.filter((g) => stats[g.id]?.favorite)
    if (recent.length)
      items.push({
        key: `${c.id}-recent`,
        label: 'Recently played',
        sub: recent[0].title,
        icon: 'recent',
        kind: 'folder',
        children: () => recent.map((g) => gameItem(g, stats[g.id]))
      })
    if (cFavs.length)
      items.push({
        key: `${c.id}-favorites`,
        label: 'Favorites',
        sub: `${cFavs.length} games`,
        icon: 'favorite',
        kind: 'folder',
        children: () => cFavs.map((g) => gameItem(g, stats[g.id]))
      })
    for (const g of games) items.push({ ...gameItem(g, stats[g.id]), icon: c.icon })
    if (!games.length)
      items.push({
        key: `${c.id}-empty`,
        label: 'No games yet',
        sub: `Put ${c.short} games in Files\\games\\${c.id}`,
        icon: 'empty',
        kind: 'action',
        run: () => h.command('open-folder', `games:${c.id}`)
      })
    cols.push({ id: c.id, label: c.short, icon: c.icon, items, console: c, games: games.length })
  }
  return cols
}
