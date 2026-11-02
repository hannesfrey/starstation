import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { input, BACKSPACE, type Action, type PadKind } from './input'
import { TextEntry, KEY_ROWS, clampCol, type EntryState, type EntryResult } from './components/TextEntry'
import { sfx } from './sound'
import { Background } from './components/Background'
import { Boot } from './components/Boot'
import { TopBar } from './components/TopBar'
import { Notices } from './components/Notices'
import { KeyHints, type GlyphButton } from './components/Glyph'
import { Xmb } from './xmb/Xmb'
import { PanelView } from './xmb/PanelView'
import { buildColumns, type XItem } from './xmb/model'
import { buildPanel, type Panel, type PanelExtra } from './xmb/panels'
import type { AddGamesResult, AppState, Game, LaunchResult, ModAddResult, Notice, Settings } from '../../shared/types'

const byTitle = (a: Game, b: Game) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true })

interface PanelRef {
  id: string
  arg?: string
  index: number
}
interface FolderRef {
  key: string
  label: string
  row: number
}

let localNoticeId = 1_000_000

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [booting, setBooting] = useState(true)
  const [notices, setNotices] = useState<Notice[]>([])
  const [colId, setColId] = useState<string | null>(null)
  // selection per list, remembered by item key so it survives items being added above it
  const [rows, setRows] = useState<Record<string, { index: number; key?: string }>>({})
  const [folders, setFolders] = useState<Record<string, FolderRef[]>>({})
  const [panels, setPanels] = useState<PanelRef[]>([])
  const panelsRef = useRef<PanelRef[]>([])
  panelsRef.current = panels
  const [errorPanel, setErrorPanel] = useState<{ title: string; result: LaunchResult; index: number } | null>(null)
  const [pad, setPad] = useState<PadKind | null>(null)
  const [idle, setIdle] = useState(false)
  const [extra, setExtra] = useState<PanelExtra>({ emuProgress: {}, importing: false, details: {}, mods: {}, gb: { page: 1, more: false, detail: {} } })
  const [entry, setEntry] = useState<EntryState | null>(null)
  const [dragging, setDragging] = useState(false)
  const lastInput = useRef(Date.now())
  const scanned = useRef(false)

  const notify = useCallback((n: Omit<Notice, 'id'>) => {
    setNotices((l) => [...l, { ...n, id: localNoticeId++ }])
    sfx.notify()
  }, [])
  const expire = useCallback((id: number) => setNotices((l) => l.filter((n) => n.id !== id)), [])

  // ---- load + subscribe ----
  useEffect(() => {
    // Updates can arrive before the first state does; keep them and apply on top.
    // (decided right away, not inside a React updater: updaters run later and could miss the first state)
    const early: Partial<AppState> = {}
    let loaded = false
    const apply = (patch: Partial<AppState>) => {
      if (!loaded) Object.assign(early, patch)
      else setState((s) => (s ? { ...s, ...patch } : s))
    }
    api.getState().then((s) => {
      loaded = true
      setState({ ...s, ...early })
      if (!s.settings.bootAnimation) setBooting(false)
    })
    const offs = [
      api.on('library', (library) => {
        scanned.current = true
        apply({ library })
      }),
      api.on('consoles', (consoles) => apply({ consoles })),
      api.on('collections', (collections) => apply({ collections })),
      api.on('running', (running) => apply({ running })),
      api.on('import-progress', (p) => setExtra((x) => ({ ...x, importProgress: p }))),
      api.on('emulator-progress', ({ id, text }) => setExtra((x) => ({ ...x, emuProgress: { ...x.emuProgress, [id]: text } }))),
      api.on('notice', (n) => {
        setNotices((l) => [...l, n])
        sfx.notify()
      })
    ]
    input.start()
    const sendPads = () => {
      const ids = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter((p): p is Gamepad => !!p && p.connected).map((p) => p.id)
      void api.reportPads(ids)
    }
    const offPad = input.onPad((e) => {
      sendPads()
      setPad(e.type === 'connected' ? e.kind : null)
      setNotices((l) => [
        ...l,
        { id: localNoticeId++, kind: 'controller', title: e.type === 'connected' ? 'Controller connected' : 'Controller disconnected', detail: e.name }
      ])
    })
    return () => {
      offs.forEach((o) => o())
      offPad()
      input.stop()
    }
  }, [])

  const settings = state?.settings
  const running = state?.running ?? null
  useEffect(() => {
    sfx.enabled = !!settings?.sounds
  }, [settings?.sounds])
  useEffect(() => {
    input.setEnabled(!running)
    sfx.paused = !!running
  }, [running])

  const setSetting = useCallback(<K extends keyof Settings>(k: K, v: Settings[K]) => {
    api.setSetting(k, v).then((settings) => setState((s) => (s ? { ...s, settings } : s)))
  }, [])

  const command = useCallback((cmd: string, arg?: string) => {
    void api.runCommand(cmd, arg)
  }, [])

  const loadDetails = useCallback(async (id: string) => {
    const d = await api.gameDetails(id)
    if (d) setExtra((x) => ({ ...x, details: { ...x.details, [id]: d } }))
    return d
  }, [])

  const stateRef = useRef<AppState | null>(null)
  stateRef.current = state
  const launchMode = useCallback(async (g: Game, mode: 'fresh' | 'resume') => {
    sfx.launch()
    setPanels([])
    const s = stateRef.current
    const c = s?.consoles.find((x) => x.id === g.console)
    if (c?.shaderHint && !s?.library.stats[g.id]?.playCount) {
      setNotices((l) => [
        ...l,
        { id: localNoticeId++, kind: 'info', title: 'First start', detail: 'The first minutes may stutter while the emulator prepares its shaders. It gets smooth after that.' }
      ])
      await new Promise((r) => setTimeout(r, 3500))
    }
    const r = await api.launch(g.id, mode)
    if (!r.ok) {
      sfx.error()
      setErrorPanel({ title: `Can't start ${g.title}`, result: r, index: 1 })
    }
  }, [])

  /** ✕ on a game: offer Resume / Start fresh when a resume state exists, otherwise just play. */
  const launch = useCallback(
    async (g: Game) => {
      const c = state?.consoles.find((x) => x.id === g.console)
      if (c?.quickResume) {
        const d = await loadDetails(g.id)
        if (d?.resume) {
          sfx.confirm()
          setPanels([{ id: 'resume', arg: g.id, index: 0 }])
          return
        }
      }
      void launchMode(g, 'fresh')
    },
    [state?.consoles, loadDetails, launchMode]
  )

  const handleAdd = useCallback((r: AddGamesResult | null) => {
    if (!r?.ask.length) return
    setExtra((x) => ({ ...x, addAsk: r.ask }))
    setPanels((p) => [...p.filter((q) => q.id !== 'add-ask'), { id: 'add-ask', index: 0 }])
  }, [])

  const addGameAs = useCallback(
    (p: string, consoleId: string) => {
      setExtra((x) => {
        const rest = (x.addAsk ?? []).filter((q) => q.path !== p)
        if (!rest.length) setPanels((ps) => ps.filter((q) => q.id !== 'add-ask'))
        return { ...x, addAsk: rest }
      })
      if (consoleId) void api.addGames([p], consoleId).then(handleAdd)
    },
    [handleAdd]
  )

  const openSearch = useCallback(() => {
    sfx.confirm()
    setEntry({ kind: 'search', title: 'Search', value: '', row: 0, col: 0, focus: 'keys', result: 0 })
  }, [])

  const openEntry = useCallback(
    (kind: 'new-collection' | 'rename-collection', target?: string) => {
      const name = kind === 'rename-collection' ? (state?.collections.find((c) => c.id === target)?.name ?? '') : ''
      setPanels([]) // the keyboard takes over the screen
      setEntry({ kind, title: kind === 'new-collection' ? 'New collection' : 'Rename collection', value: name, row: 0, col: 0, focus: 'keys', result: 0, target })
    },
    [state?.collections]
  )

  const toggleFavorite = useCallback(
    (g: Game) => {
      api.toggleFavorite(g.id).then((st) => {
        setState((s) => (s ? { ...s, library: { ...s.library, stats: { ...s.library.stats, [g.id]: st } } } : s))
        notify({ kind: 'success', title: st.favorite ? 'Added to Favorites' : 'Removed from Favorites', detail: g.title })
      })
    },
    [notify]
  )

  const openPanel = useCallback((id: string, arg?: string) => {
    setPanels((p) => [...p, { id, arg, index: 0 }])
    if (arg && ['game', 'backups', 'delete'].includes(id)) void loadDetails(arg)
    if (arg && id === 'mods') void api.mods(arg).then((v) => v && setExtra((x) => ({ ...x, mods: { ...x.mods, [arg]: v } })))
    if (arg && id === 'gb-mod') {
      const mid = Number(arg.split('|')[1])
      api
        .gbMod(mid)
        .then((d) => setExtra((x) => ({ ...x, gb: { ...x.gb, detail: { ...x.gb.detail, [mid]: d } } })))
        .catch((e) => setExtra((x) => ({ ...x, gb: { ...x.gb, error: `GameBanana can't be reached right now (${(e as Error).message}).` } })))
    }
    if (id === 'emulators') {
      api.emulators().then((emulators) => setExtra((x) => ({ ...x, emulators })))
      api.checkEmulatorUpdates().then((emulators) => setExtra((x) => ({ ...x, emulators })))
    }
    if (id === 'import') {
      setExtra((x) => (x.importing ? x : { ...x, importSources: undefined, importResult: undefined, importProgress: undefined }))
      api.importScan().then((importSources) => setExtra((x) => ({ ...x, importSources })))
    }
  }, [loadDetails])

  const installEmulator = useCallback((id: string) => {
    api.installEmulator(id).then(() => api.emulators().then((emulators) => setExtra((x) => ({ ...x, emulators }))))
  }, [])
  const checkUpdates = useCallback(() => {
    api.checkEmulatorUpdates().then((emulators) => setExtra((x) => ({ ...x, emulators })))
  }, [])
  const runImport = useCallback((index: number) => {
    setExtra((x) => ({ ...x, importing: true, importResult: undefined }))
    api.importRun(index).then((importResult) => setExtra((x) => ({ ...x, importing: false, importResult })))
  }, [])

  const applyCollections = useCallback((collections: AppState['collections']) => setState((s) => (s ? { ...s, collections } : s)), [])
  const collectionToggle = useCallback(
    (id: string, gameId: string) => void api.collectionToggle(id, gameId).then(applyCollections),
    [applyCollections]
  )
  const collectionDelete = useCallback((id: string) => void api.collectionDelete(id).then(applyCollections), [applyCollections])
  const backupNow = useCallback((g: Game) => void api.backupNow(g.id).then(() => loadDetails(g.id)), [loadDetails])
  const restoreBackup = useCallback(
    (g: Game, id: string) => void api.restoreBackup(g.id, id).then(() => loadDetails(g.id)),
    [loadDetails]
  )
  const setGameOption = useCallback((g: Game, key: 'graphics' | 'crt' | 'patch', value: string | boolean, patchId?: string) => {
    void api.setGameOption(g.id, key, value, patchId).then((options) => {
      if (options) setExtra((x) => (x.details[g.id] ? { ...x, details: { ...x.details, [g.id]: { ...x.details[g.id], options } } } : x))
    })
  }, [])
  // ---- mods ----
  const loadMods = useCallback(async (gid: string) => {
    const v = await api.mods(gid)
    if (v) setExtra((x) => ({ ...x, mods: { ...x.mods, [gid]: v } }))
    void loadDetails(gid)
  }, [loadDetails])
  const onModAdded = useCallback(
    (gid: string, r: ModAddResult | null) => {
      if (!r) return
      if (!r.ok && 'ask' in r) {
        setExtra((x) => ({ ...x, modAsk: { gameId: gid, ...r.ask } }))
        setPanels((p) => [...p.filter((q) => q.id !== 'mod-place'), { id: 'mod-place', index: 0 }])
        return
      }
      setPanels((p) => p.filter((q) => q.id !== 'mod-place'))
      void loadMods(gid)
    },
    [loadMods]
  )
  const modToggle = useCallback(
    (g: Game, modId: string, on: boolean, winner?: 'this' | 'other') => {
      void api.modToggle(g.id, modId, on, winner).then((r) => {
        if (!r.ok && 'conflict' in r) {
          const name = extra.mods[g.id]?.mods.find((m) => m.id === modId)?.name ?? modId
          setExtra((x) => ({ ...x, modConflict: { gameId: g.id, modId, name, ...r.conflict } }))
          setPanels((p) => [...p, { id: 'mod-conflict', index: 0 }])
          return
        }
        if (!r.ok && 'error' in r) notify({ kind: 'error', title: "Couldn't switch the mod", detail: r.error })
        if (r.ok && r.skipped) notify({ kind: 'warning', title: 'Some files were left alone', detail: `${r.skipped} file(s) were already there and weren't made by Starstation.` })
        if (r.ok && on) notify({ kind: 'mod', title: 'Mod switched on', detail: g.title })
        setPanels((p) => p.filter((q) => q.id !== 'mod-conflict'))
        void loadMods(g.id)
      })
    },
    [extra.mods, loadMods, notify]
  )
  const modDelete = useCallback((g: Game, modId: string) => void api.modDelete(g.id, modId).then(() => loadMods(g.id)), [loadMods])
  const modAddDialog = useCallback((g: Game, folder: boolean) => void api.modAddDialog(g.id, folder).then((r) => onModAdded(g.id, r)), [onModAdded])
  const modPlace = useCallback((gid: string, pending: string, target: string) => void api.modPlace(gid, pending, target).then((r) => onModAdded(gid, r)), [onModAdded])
  const gbFail = (e: unknown) => setExtra((x) => ({ ...x, gb: { ...x.gb, busy: undefined, error: `GameBanana can't be reached right now (${(e as Error).message}).` } }))
  const gbLoadMods = useCallback((gbId: number, page: number) => {
    setExtra((x) => ({ ...x, gb: { ...x.gb, busy: 'Loading mods…', error: undefined, ...(page === 1 ? { mods: undefined } : {}) } }))
    api
      .gbMods(gbId, page)
      .then((r) => setExtra((x) => ({ ...x, gb: { ...x.gb, busy: undefined, page, more: r.more, mods: page === 1 ? r.mods : [...(x.gb.mods ?? []), ...r.mods] } })))
      .catch(gbFail)
  }, [])
  const gbGameRef = useRef<Record<string, number>>({})
  const gbOpen = useCallback(
    (g: Game) => {
      setExtra((x) => ({ ...x, gb: { page: 1, more: false, detail: x.gb.detail, busy: 'Looking for the game on GameBanana…' } }))
      api
        .gbSearch(g.id)
        .then((r) => {
          const pick = r.chosen ?? (r.games.length === 1 ? r.games[0].id : undefined)
          if (pick) {
            gbGameRef.current[g.id] = pick
            if (!r.chosen) void api.gbChoose(g.id, pick)
            setPanels((p) => [...p, { id: 'gb-mods', arg: g.id, index: 0 }])
            gbLoadMods(pick, 1)
          } else {
            setExtra((x) => ({ ...x, gb: { ...x.gb, busy: undefined, games: r.games } }))
            setPanels((p) => [...p, { id: 'gb-games', arg: g.id, index: 0 }])
          }
        })
        .catch(gbFail)
    },
    [gbLoadMods]
  )
  const gbChoose = useCallback(
    (g: Game, gbId: number) => {
      gbGameRef.current[g.id] = gbId
      void api.gbChoose(g.id, gbId)
      setPanels((p) => [...p.filter((q) => q.id !== 'gb-games'), { id: 'gb-mods', arg: g.id, index: 0 }])
      gbLoadMods(gbId, 1)
    },
    [gbLoadMods]
  )
  const gbMore = useCallback((g: Game) => {
    const id = gbGameRef.current[g.id]
    if (id) gbLoadMods(id, extra.gb.page + 1)
  }, [gbLoadMods, extra.gb.page])
  const gbInstall = useCallback(
    (g: Game, modId: number, fileId: number) => {
      setExtra((x) => ({ ...x, gb: { ...x.gb, busy: 'Downloading and installing…' } }))
      api
        .gbInstall(g.id, modId, fileId)
        .then((r) => {
          setExtra((x) => ({ ...x, gb: { ...x.gb, busy: undefined } }))
          onModAdded(g.id, r)
          if (r.ok) setPanels((p) => p.filter((q) => !q.id.startsWith('gb-')))
        })
        .catch(gbFail)
    },
    [onModAdded]
  )

  const restorePreviousResume = useCallback((g: Game) => void api.restorePreviousResume(g.id).then(() => loadDetails(g.id)), [loadDetails])
  const deleteGame = useCallback((g: Game, withSaves: boolean) => void api.deleteGame(g.id, withSaves), [])
  const addGamesDialog = useCallback(() => void api.addGamesDialog().then(handleAdd), [handleAdd])

  // ---- text entry (search, collection names) ----
  const searchHits = useMemo((): { game: Game; item: EntryResult }[] | undefined => {
    if (!entry || entry.kind !== 'search' || !state) return undefined
    const words = entry.value.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return []
    const cons = new Map(state.consoles.map((c) => [c.id, c]))
    return state.library.games
      .filter((g) => {
        const hay = `${g.title} ${g.serial ?? ''} ${cons.get(g.console)?.short ?? ''}`.toLowerCase()
        return words.every((w) => hay.includes(w))
      })
      .sort(byTitle)
      .slice(0, 100)
      .map((g) => ({
        game: g,
        item: { key: g.id, label: g.title, sub: cons.get(g.console)?.name ?? g.console, icon: cons.get(g.console)?.icon ?? 'disc', art: g.icon }
      }))
  }, [entry, state])

  const typeChar = useCallback((ch: string) => {
    setEntry((e) => {
      if (!e) return e
      if (ch === BACKSPACE) return { ...e, value: e.value.slice(0, -1), result: 0 }
      // on-screen keys are capitals: write words as "Title case"
      const prev = e.value.slice(-1)
      const c = /[A-Z]/.test(ch) && prev && prev !== ' ' ? ch.toLowerCase() : ch
      return { ...e, value: (e.value + c).slice(0, 40), result: 0 }
    })
  }, [])

  const entryDone = useCallback(() => {
    if (!entry) return
    const value = entry.value.trim()
    if (entry.kind === 'search') {
      if (searchHits?.length) setEntry({ ...entry, focus: 'results', result: 0 })
      else setEntry(null)
      return
    }
    if (!value) {
      sfx.error()
      return
    }
    sfx.confirm()
    if (entry.kind === 'new-collection')
      void api.collectionCreate(value, entry.target).then((cols) => {
        applyCollections(cols)
        notify({ kind: 'success', title: 'Collection created', detail: value })
      })
    else if (entry.target) void api.collectionRename(entry.target, value).then(applyCollections)
    setEntry(null)
    setPanels([])
  }, [entry, searchHits, applyCollections, notify])

  const pressKey = useCallback(
    (r: number, c: number) => {
      const k = KEY_ROWS[r][c]
      setEntry((e) => (e ? { ...e, row: r, col: c, focus: 'keys' } : e))
      sfx.move()
      if (k === 'SPACE') typeChar(' ')
      else if (k === 'DELETE') typeChar(BACKSPACE)
      else if (k === 'DONE') entryDone()
      else typeChar(k)
    },
    [typeChar, entryDone]
  )

  useEffect(() => {
    input.setTextHandler(entry && !panels.length && !errorPanel ? typeChar : null)
    return () => input.setTextHandler(null)
  }, [entry, panels.length, errorPanel, typeChar])

  // ---- drag & drop game files into the window ----
  useEffect(() => {
    const over = (e: DragEvent) => {
      e.preventDefault()
      setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false)
    }
    const drop = (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const paths = [...(e.dataTransfer?.files ?? [])].map((f) => api.pathForFile(f)).filter(Boolean)
      const top = panelsRef.current[panelsRef.current.length - 1]
      if (paths.length && top?.id === 'mods' && top.arg) {
        const gid = top.arg
        for (const p of paths) void api.modAdd(gid, p).then((r) => onModAdded(gid, r))
      } else if (paths.length) void api.addGames(paths).then(handleAdd)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [handleAdd, onModAdded])

  // ---- model ----
  const columns = useMemo(
    () =>
      state
        ? buildColumns(state, {
            openPanel,
            command,
            toggleFullscreen: () => void api.toggleFullscreen(),
            quit: () => void api.quit(),
            openSearch,
            newCollection: () => openEntry('new-collection')
          })
        : [],
    [state, openPanel, command, openSearch, openEntry]
  )

  // initial column: first console with games, otherwise Settings
  // (until the user picks a column themselves, follow the scan as it finds games)
  const autoColumn = useRef(true)
  useEffect(() => {
    if (!columns.length) return
    if (colId && columns.some((c) => c.id === colId) && !autoColumn.current) return
    const firstConsole = columns.find((c) => (c.games ?? 0) > 0)
    const want = (firstConsole ?? columns.find((c) => c.id === colId) ?? columns[0]).id
    if (want !== colId) setColId(want)
    if (scanned.current) autoColumn.current = false
  }, [columns, colId])
  const chooseColumn = (id: string) => {
    autoColumn.current = false
    setColId(id)
  }

  const col = Math.max(0, columns.findIndex((c) => c.id === colId))
  const column = columns[col]
  const folderStack = (column && folders[column.id]) || []

  // resolve folder stack to the visible item list
  const { items, folderTitle, emptyText } = useMemo(() => {
    if (!column) return { items: [] as XItem[], folderTitle: null, emptyText: undefined }
    let list = column.items
    let title: string | null = null
    let empty: string | undefined
    for (const f of folderStack) {
      const it = list.find((x) => x.key === f.key)
      if (!it?.children) break
      list = it.children()
      title = it.label
      empty = it.emptyText
    }
    return { items: list, folderTitle: title, emptyText: empty }
  }, [column, folderStack])

  const rowKey = column ? column.id + folderStack.map((f) => '/' + f.key).join('') : ''
  const saved = rows[rowKey]
  const byKey = saved?.key ? items.findIndex((it) => it.key === saved.key) : -1
  // a console column opens on its first game, not on the Search item above it
  const firstGame = Math.max(0, items.findIndex((it) => it.kind === 'game'))
  const row = byKey >= 0 ? byKey : Math.min(saved?.index ?? firstGame, Math.max(0, items.length - 1))
  const current = items[row]

  const activePanelRef = errorPanel ? null : panels[panels.length - 1]
  const activePanel: Panel | null = useMemo(() => {
    if (errorPanel) {
      const fix = errorPanel.result.fix
      return {
        id: 'error',
        title: errorPanel.title,
        items: [
          { key: 'msg', label: errorPanel.result.error ?? 'Something went wrong.', info: true },
          ...(fix ? [{ key: 'fix', label: fix.label, run: () => command(fix.command, fix.arg) }] : []),
          { key: 'ok', label: 'OK', run: () => undefined }
        ]
      }
    }
    if (!activePanelRef || !state) return null
    return buildPanel(
      activePanelRef.id,
      activePanelRef.arg,
      state,
      {
        setSetting,
        command,
        launch,
        toggleFavorite,
        openPanel,
        installEmulator,
        checkUpdates,
        runImport,
        launchMode,
        openEntry,
        collectionToggle,
        collectionDelete,
        backupNow,
        restoreBackup,
        restorePreviousResume,
        setGameOption,
        modToggle,
        modDelete,
        modAddDialog,
        modPlace,
        gbOpen,
        gbChoose,
        gbMore,
        gbInstall,
        deleteGame,
        addGamesDialog,
        addGameAs
      },
      extra
    )
  }, [
    activePanelRef,
    errorPanel,
    state,
    setSetting,
    command,
    launch,
    toggleFavorite,
    openPanel,
    installEmulator,
    checkUpdates,
    runImport,
    launchMode,
    openEntry,
    collectionToggle,
    collectionDelete,
    backupNow,
    restoreBackup,
    restorePreviousResume,
    setGameOption,
    modToggle,
    modDelete,
    modAddDialog,
    modPlace,
    gbOpen,
    gbChoose,
    gbMore,
    gbInstall,
    deleteGame,
    addGamesDialog,
    addGameAs,
    extra
  ])

  // a panel whose subject is gone (deleted game, finished question) closes itself
  useEffect(() => {
    if (activePanelRef && state && !activePanel) setPanels((p) => p.slice(0, -1))
  }, [activePanelRef, activePanel, state])

  const panelIndex = activePanel
    ? firstSelectable(activePanel, Math.min(errorPanel ? errorPanel.index : (activePanelRef?.index ?? 0), activePanel.items.length - 1), 1)
    : 0
  const setPanelIndex = (i: number) => {
    if (errorPanel) setErrorPanel({ ...errorPanel, index: i })
    else setPanels((p) => p.map((x, k) => (k === p.length - 1 ? { ...x, index: i } : x)))
  }

  // ---- input ----
  const handler = useRef<(a: Action, src?: string) => void>(() => undefined)
  handler.current = (a: Action, src?: string) => {
    lastInput.current = Date.now()
    if (idle) {
      setIdle(false)
      return
    }
    if (booting || !state) return

    if (activePanel) {
      const n = activePanel.items.length
      if (a === 'up' || a === 'down') {
        const next = firstSelectable(activePanel, panelIndex + (a === 'up' ? -1 : 1), a === 'up' ? -1 : 1)
        if (next !== panelIndex && next >= 0 && next < n) {
          sfx.move()
          setPanelIndex(next)
        }
      } else if (a === 'confirm') {
        const it = activePanel.items[panelIndex]
        if (!it || it.info || it.disabled) return
        sfx.confirm()
        const res = it.run?.()
        Promise.resolve(res).then((r) => {
          if (r === 'keep') return
          if (errorPanel) setErrorPanel(null)
          else setPanels([])
        })
      } else if (a === 'back' || a === 'options' || a === 'left') {
        sfx.back()
        if (errorPanel) setErrorPanel(null)
        else setPanels((p) => p.slice(0, -1))
      }
      return
    }

    if (entry) {
      const hits = searchHits ?? []
      if (entry.focus === 'keys') {
        const move = (row: number, col: number) => {
          sfx.move()
          setEntry({ ...entry, row, col: clampCol(row, col) })
        }
        switch (a) {
          case 'up':
            if (entry.row > 0) move(entry.row - 1, entry.col)
            break
          case 'down':
            if (entry.row < KEY_ROWS.length - 1) move(entry.row + 1, entry.col)
            break
          case 'left':
            if (entry.col > 0) move(entry.row, entry.col - 1)
            break
          case 'right':
            if (entry.col < KEY_ROWS[entry.row].length - 1) move(entry.row, entry.col + 1)
            else if (hits.length) {
              sfx.column()
              setEntry({ ...entry, focus: 'results', result: 0 })
            }
            break
          case 'r1':
            if (hits.length) {
              sfx.column()
              setEntry({ ...entry, focus: 'results', result: 0 })
            }
            break
          case 'confirm':
            // Enter on a real keyboard finishes; ✕ types the highlighted key
            if (src === 'keyboard') entryDone()
            else pressKey(entry.row, entry.col)
            break
          case 'search':
            sfx.back()
            typeChar(BACKSPACE)
            break
          case 'start':
            entryDone()
            break
          case 'back':
            sfx.back()
            setEntry(null)
            break
        }
      } else {
        const hit = hits[entry.result]
        switch (a) {
          case 'up':
          case 'down': {
            const next = entry.result + (a === 'up' ? -1 : 1)
            if (next >= 0 && next < hits.length) {
              sfx.move()
              setEntry({ ...entry, result: next })
            }
            break
          }
          case 'left':
          case 'l1':
          case 'back':
          case 'search':
            sfx.back()
            setEntry({ ...entry, focus: 'keys' })
            break
          case 'confirm':
            if (hit) void launch(hit.game)
            break
          case 'options':
            if (hit) {
              sfx.confirm()
              openPanel('game', hit.game.id)
            }
            break
          case 'select':
            if (hit) toggleFavorite(hit.game)
            break
        }
      }
      return
    }

    const setRow = (r: number) => setRows((m) => ({ ...m, [rowKey]: { index: r, key: items[r]?.key } }))
    const moveCol = (i: number) => {
      if (i < 0 || i >= columns.length || i === col) return
      sfx.column()
      chooseColumn(columns[i].id)
    }
    switch (a) {
      case 'left':
        if (folderStack.length) {
          sfx.back()
          setFolders((f) => ({ ...f, [column.id]: folderStack.slice(0, -1) }))
        } else moveCol(col - 1)
        break
      case 'right':
        if (!folderStack.length) moveCol(col + 1)
        break
      case 'up':
        if (row > 0) {
          sfx.move()
          setRow(row - 1)
        }
        break
      case 'down':
        if (row < items.length - 1) {
          sfx.move()
          setRow(row + 1)
        }
        break
      case 'confirm':
        if (!current) return
        if (current.kind === 'game' && current.game) void launch(current.game)
        else if (current.kind === 'folder') {
          sfx.confirm()
          setFolders((f) => ({ ...f, [column.id]: [...folderStack, { key: current.key, label: current.label, row: 0 }] }))
        } else if (current.run) {
          sfx.confirm()
          current.run()
        }
        break
      case 'back':
        if (folderStack.length) {
          sfx.back()
          setFolders((f) => ({ ...f, [column.id]: folderStack.slice(0, -1) }))
        }
        break
      case 'options':
        if (current?.game) {
          sfx.confirm()
          openPanel('game', current.game.id)
        } else if (current?.options) {
          sfx.confirm()
          current.options()
        }
        break
      case 'select':
        if (current?.game) toggleFavorite(current.game)
        break
      case 'start':
        sfx.column()
        setFolders((f) => ({ ...f, settings: [] }))
        chooseColumn('settings')
        break
      case 'l1':
      case 'r1': {
        const dir = a === 'l1' ? -1 : 1
        for (let i = col + dir; i >= 0 && i < columns.length; i += dir) {
          if (columns[i].console) {
            moveCol(i)
            break
          }
        }
        break
      }
      case 'search':
        openSearch()
        break
    }
  }

  useEffect(() => input.on((a, src) => handler.current(a, src)), [])

  // mouse activity also counts as input for the screensaver
  useEffect(() => {
    const wake = () => {
      lastInput.current = Date.now()
      setIdle(false)
    }
    window.addEventListener('mousemove', wake)
    window.addEventListener('mousedown', wake)
    const offAny = input.onAny(wake)
    return () => {
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('mousedown', wake)
      offAny()
    }
  }, [])

  // screensaver
  useEffect(() => {
    const mins = settings?.screensaverMinutes ?? 5
    if (!mins) return
    const t = setInterval(() => {
      if (!running && Date.now() - lastInput.current > mins * 60_000) setIdle(true)
    }, 5000)
    return () => clearInterval(t)
  }, [settings?.screensaverMinutes, running])

  const padKind: PadKind = settings?.buttonIcons && settings.buttonIcons !== 'auto' ? settings.buttonIcons : (pad ?? input.lastKind ?? 'playstation')

  const hints: [GlyphButton, string][] = activePanel
    ? [
        ['confirm', 'Select'],
        ['back', 'Back']
      ]
    : entry
      ? entry.focus === 'keys'
        ? [
            ['confirm', 'Type'],
            ['search', 'Delete'],
            ['start', 'Done'],
            ['back', 'Close']
          ]
        : [
            ['confirm', 'Play'],
            ['options', 'Options'],
            ['back', 'Keyboard']
          ]
      : current?.game
      ? [
          ['confirm', 'Play'],
          ['options', 'Options'],
          ['select', 'Favorite']
        ]
      : [
          ['confirm', 'Select'],
          ...(folderStack.length ? ([['back', 'Back']] as [GlyphButton, string][]) : [])
        ]

  const bgArt = !activePanel && !entry && current?.game?.background
  return (
    <div className={`app ${idle ? 'idle' : ''} ${running ? 'running' : ''}`}>
      <Background paused={!!running} dim={idle} />
      {bgArt && <div className="game-bg" style={{ backgroundImage: `url("${api.mediaUrl(bgArt)}")` }} />}
      {booting ? (
        <Boot onDone={() => setBooting(false)} />
      ) : (
        <>
          <TopBar pad={pad} battery={null} />
          {state && column && (
            <Xmb
              columns={columns}
              col={col}
              items={items}
              row={row}
              folderTitle={folderTitle}
              emptyText={emptyText}
              stats={state.library.stats}
              onSelectColumn={(i) => {
                if (i !== col) {
                  sfx.column()
                  chooseColumn(columns[i].id)
                }
              }}
              onSelectRow={(i) => {
                if (i !== row) sfx.move()
                setRows((m) => ({ ...m, [rowKey]: { index: i, key: items[i]?.key } }))
              }}
              onActivate={() => handler.current('confirm')}
              onOptions={() => handler.current('options')}
            />
          )}
          {entry && (
            <TextEntry
              entry={entry}
              results={entry.kind === 'search' ? (searchHits ?? []).map((h) => h.item) : undefined}
              onKey={(r, c) => pressKey(r, c)}
              onResult={(i) => setEntry({ ...entry, focus: 'results', result: i })}
              onResultActivate={(i) => {
                const hit = searchHits?.[i]
                if (hit) void launch(hit.game)
              }}
            />
          )}
          {activePanel && (
            <PanelView
              panel={activePanel}
              index={panelIndex}
              onSelect={setPanelIndex}
              onRun={() => handler.current('confirm')}
            />
          )}
          {!idle && <KeyHints hints={hints} kind={padKind} />}
          {running && (
            <div className="running-overlay" data-testid="running">
              <div>Playing</div>
              <div className="running-title">{running.title}</div>
              <div className="running-hint">Close the game to return here.</div>
            </div>
          )}
        </>
      )}
      {dragging && (
        <div className="drop-hint" data-testid="drop-hint">
          Drop game files to add them
        </div>
      )}
      <Notices list={notices} onExpire={expire} />
      {idle && <div className="screensaver" data-testid="screensaver" />}
    </div>
  )
}

function firstSelectable(p: Panel, from: number, dir: 1 | -1): number {
  let i = from
  while (i >= 0 && i < p.items.length && (p.items[i].info || p.items[i].disabled)) i += dir
  if (i < 0 || i >= p.items.length) {
    // nothing selectable in that direction: stay on the nearest selectable item
    i = from
    while (i >= 0 && i < p.items.length && (p.items[i].info || p.items[i].disabled)) i -= dir
  }
  return Math.max(0, Math.min(p.items.length - 1, i))
}
