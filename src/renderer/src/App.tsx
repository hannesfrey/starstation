import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { input, BACKSPACE, type Action, type PadKind } from './input'
import { PhotoViewer } from './components/PhotoViewer'
import { PadTest } from './components/PadTest'
import { isMenuPad, padName } from './input'
import { TextEntry, KEY_ROWS, clampCol, type EntryState, type EntryResult } from './components/TextEntry'
import { music, sfx } from './sound'
import { Background } from './components/Background'
import { Boot } from './components/Boot'
import { PlayerAssign, menuPads } from './components/PlayerAssign'
import { TopBar } from './components/TopBar'
import { Notices } from './components/Notices'
import { KeyHints, type GlyphButton } from './components/Glyph'
import { Xmb } from './xmb/Xmb'
import { PanelView } from './xmb/PanelView'
import { buildColumns, type XItem } from './xmb/model'
import { buildPanel, type Panel, type PanelExtra } from './xmb/panels'
import type { AddGamesResult, AppState, BatteryInfo, CustomConsoleForm, NetplayRoom, Game, LaunchResult, ModAddResult, Notice, PlayerPad, Screenshot, Settings } from '../../shared/types'

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
  const [extra, setExtra] = useState<PanelExtra>({
    emuProgress: {},
    importing: false,
    details: {},
    mods: {},
    gb: { page: 1, more: false, detail: {} },
    // everything except saves is ticked by default (spec 12)
    pkg: { choice: { emulators: true, bios: true, games: 'all', mods: true, settings: true, saves: false }, busy: false }
  })
  /** First-start wizard: step + selected row (null = not shown). */
  const [wizard, setWizard] = useState<{ step: number; index: number } | null>(null)
  const [entry, setEntry] = useState<EntryState | null>(null)
  const [shots, setShots] = useState<Screenshot[]>([])
  const [photo, setPhoto] = useState<number | null>(null)
  const [battery, setBattery] = useState<BatteryInfo | null>(null)
  const [padTest, setPadTest] = useState(false)
  const [assign, setAssign] = useState<{ title: string; max: number; resolve: (r: PlayerPad[] | null | 'cancel') => void } | null>(null)
  const newConsoleRef = useRef<() => void>(() => undefined)
  const [dragging, setDragging] = useState(false)
  const lastInput = useRef(Date.now())

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
    void api.screenshots().then(setShots)
    api.getState().then((s) => {
      loaded = true
      setState({ ...s, ...early })
      if (!s.settings.bootAnimation) setBooting(false)
    })
    // first start on this PC: the setup wizard comes before the boot animation
    void api.setupStatus().then((setup) => {
      setExtra((x) => ({ ...x, setup }))
      if (!setup.done) {
        setBooting(false)
        setWizard({ step: 0, index: 0 })
      }
    })
    const offs = [
      api.on('library', (library) => apply({ library })),
      api.on('consoles', (consoles) => apply({ consoles })),
      api.on('collections', (collections) => apply({ collections })),
      api.on('screenshots', (s) => setShots(s)),
      api.on('battery', (b) => setBattery(b)),
      api.on('package-progress', (p) =>
        setExtra((x) => ({ ...x, pkg: { ...x.pkg, progress: p, busy: p.phase !== 'done' && p.phase !== 'error' ? x.pkg.busy : false } }))
      ),
      api.on('running', (running) => apply({ running })),
      api.on('import-progress', (p) => setExtra((x) => ({ ...x, importProgress: p }))),
      api.on('emulator-progress', ({ id, text }) => setExtra((x) => ({ ...x, emuProgress: { ...x.emuProgress, [id]: text } }))),
      // a file from New downloads whose console is unclear
      api.on('add-ask', (ask) => {
        setExtra((x) => ({ ...x, addAsk: [...(x.addAsk ?? []).filter((q) => !ask.some((n) => n.path === q.path)), ...ask] }))
        setPanels((p) => [...p.filter((q) => q.id !== 'add-ask'), { id: 'add-ask', index: 0 }])
      }),
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
  // background music: off by default; quiet while a game runs or the screensaver is on
  useEffect(() => {
    if (settings?.music && !running && !idle) music.start()
    else music.stop()
  }, [settings?.music, running, idle])

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
    // 2+ controllers and a game for 2+ players: who is player 1, 2, …?
    let pads: PlayerPad[] | undefined
    const max = Math.min(4, g.players ?? 4)
    if (menuPads().length >= 2 && max >= 2 && g.console !== '3ds') {
      const r = await new Promise<PlayerPad[] | null | 'cancel'>((resolve) => setAssign({ title: g.title, max, resolve }))
      setAssign(null)
      if (r === 'cancel') return
      pads = r ?? undefined
    }
    const r = await api.launch(g.id, mode, undefined, pads)
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

  // ---- safe updates + safe mode ----
  const setSafeMode = useCallback(
    (on: boolean) => {
      void api.setSafeMode(on).then((r) => {
        if (!r.ok && r.error) notify({ kind: 'error', title: on ? 'Safe mode not started' : 'Still in safe mode', detail: r.error })
      })
    },
    [notify]
  )
  const undoUpdate = useCallback(
    (to: string) => {
      notify({ kind: 'update', title: `Going back to ${to}…`, detail: 'Starstation closes and starts again by itself.' })
      void api.undoUpdate(to).then((r) => {
        if (!r.ok) notify({ kind: 'error', title: 'Could not go back', detail: r.error })
      })
    },
    [notify]
  )
  const releaseToEveryone = useCallback(() => {
    void api.releaseToEveryone().then(() => api.updateState().then((update) => setExtra((x) => ({ ...x, update }))))
  }, [])
  const guideSeen = useCallback((keys: string[]) => void api.guideSeen(keys), [])
  const couchSave = useCallback(() => void api.couchSave(), [])
  const markTested = useCallback((id: string) => {
    void api.markTested(id).then(() => api.emulators().then((emulators) => setExtra((x) => ({ ...x, emulators }))))
  }, [])

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
    if (id === 'about') void api.updateState().then((update) => setExtra((x) => ({ ...x, update })))
    if (id === 'health') {
      setExtra((x) => ({ ...x, health: undefined }))
      void api.health().then((health) => setExtra((x) => ({ ...x, health })))
    }
    if (id === 'controllers') {
      const p = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find((x): x is Gamepad => !!x && x.connected && isMenuPad(x))
      setExtra((x) => ({ ...x, pad: p ? { name: padName(p.id), api: /xinput/i.test(p.id) ? 'XInput' : 'SDL' } : null }))
    }
    if (id === 'retroachievements') void api.raStatus().then((ra) => setExtra((x) => ({ ...x, ra })))
    if (id === 'steam') void api.steamStatus().then((steam) => setExtra((x) => ({ ...x, steam })))
    if (id === 'licenses' || id === 'emulator') void api.licenses().then((licenses) => setExtra((x) => ({ ...x, licenses })))
    if (id === 'emulator') void api.emulators().then((emulators) => setExtra((x) => ({ ...x, emulators })))
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

  // ---- settings (step 10) ----
  const runHealth = useCallback(() => {
    setExtra((x) => ({ ...x, health: undefined }))
    void api.health().then((health) => setExtra((x) => ({ ...x, health })))
  }, [])
  const exportReport = useCallback(() => void api.exportReport(), [])
  const loadRa = useCallback(() => void api.raStatus().then((ra) => setExtra((x) => ({ ...x, ra }))), [])
  const raLogin = useCallback(() => void api.raLogin().then(loadRa), [loadRa])
  const raLogout = useCallback(() => void api.raLogout().then(loadRa), [loadRa])
  const loadRooms = useCallback((g: Game) => {
    setExtra((x) => ({ ...x, rooms: { gameId: g.id } }))
    setPanels((p) => (p[p.length - 1]?.id === 'rooms' ? p : [...p, { id: 'rooms', arg: g.id, index: 0 }]))
    api
      .netplayRooms(g.id)
      .then((list) => setExtra((x) => ({ ...x, rooms: { gameId: g.id, list } })))
      .catch((e) => setExtra((x) => ({ ...x, rooms: { gameId: g.id, error: `The netplay lobby can't be reached (${(e as Error).message}).` } })))
  }, [])
  const playOnline = useCallback(async (g: Game, how: { host: true } | { join: NetplayRoom }) => {
    sfx.launch()
    setPanels([])
    const r = await api.launch(g.id, 'fresh', how)
    if (!r.ok) {
      sfx.error()
      setErrorPanel({ title: `Can't start ${g.title}`, result: r, index: 1 })
    }
  }, [])
  const loadSteam = useCallback(() => void api.steamStatus().then((steam) => setExtra((x) => ({ ...x, steam }))), [])
  const addToSteam = useCallback(() => void api.addToSteam().then(loadSteam), [loadSteam])
  const formRef = useRef<CustomConsoleForm | undefined>(undefined)
  formRef.current = extra.form
  const setForm = (f: CustomConsoleForm) => setExtra((x) => ({ ...x, form: f }))
  const newConsole = useCallback(() => {
    setExtra((x) => ({ ...x, form: { name: '', short: '', exe: '', args: '"{launch}"', extensions: '' } }))
    setPanels((p) => [...p, { id: 'custom-console', index: 1 }])
  }, [])
  const editConsole = useCallback((id: string) => {
    void api.customConsole(id).then((f) => {
      if (!f) return
      setExtra((x) => ({ ...x, form: f }))
      setPanels((p) => [...p, { id: 'custom-console', index: 1 }])
    })
  }, [])
  const pickExe = useCallback(() => {
    void api.pickExe().then((exe) => {
      const f = formRef.current
      if (exe && f) setForm({ ...f, exe, name: f.name || exe.split(/[\\/]/).pop()!.replace(/\.exe$/i, '') })
    })
  }, [])
  const saveForm = useCallback(() => {
    const f = formRef.current
    if (!f) return
    void api.saveCustomConsole(f).then((r) => {
      if (!r.ok) {
        sfx.error()
        notify({ kind: 'error', title: "Console not saved", detail: r.error })
        return
      }
      notify({ kind: 'success', title: f.id ? 'Console saved' : 'Console added', detail: `Put its games in Files\\games\\${r.id}` })
      setPanels([])
    })
  }, [notify])
  const removeConsole = useCallback((id: string) => void api.removeCustomConsole(id), [])
  const clearCache = useCallback(() => {
    notify({ kind: 'info', title: 'Refreshing titles and artwork…' })
    void api.clearLibraryCache()
  }, [notify])
  const editField = useCallback(
    (field: 'name' | 'short' | 'args' | 'extensions' | 'nickname') => {
      const titles = { name: 'Console name', short: 'Short name', args: 'Launch command', extensions: 'Game file types', nickname: 'Your netplay name' }
      const f = formRef.current
      const value = field === 'nickname' ? (state?.settings.netplayNickname ?? '') : ((f?.[field] as string | undefined) ?? '')
      setEntry({ kind: 'field', title: titles[field], value, row: 0, col: 0, focus: 'keys', result: 0, target: field, overPanel: true })
    },
    [state?.settings.netplayNickname]
  )
  const testPad = useCallback(() => setPadTest(true), [])
  newConsoleRef.current = newConsole

  // ---- packages + wizard (step 11) ----
  const pkgRef = useRef(extra.pkg)
  pkgRef.current = extra.pkg
  const refreshPkgSize = (choice: PanelExtra['pkg']['choice']) => {
    setExtra((x) => ({ ...x, pkg: { ...x.pkg, size: undefined } }))
    void api.packageSize(choice).then((size) => setExtra((x) => ({ ...x, pkg: { ...x.pkg, size } })))
  }
  const pkgToggle = useCallback(
    (key: string) => {
      const p = pkgRef.current
      if (key === 'useSettings') {
        setExtra((x) => ({ ...x, pkg: { ...x.pkg, useSettings: !x.pkg.useSettings } }))
        return
      }
      const c = { ...p.choice }
      const withGames = (state?.consoles ?? []).filter((con) => state?.library.games.some((g) => g.console === con.id)).map((con) => con.id)
      if (key === 'games') c.games = c.games === 'all' ? [] : 'all'
      else if (key.startsWith('console:')) {
        const id = key.slice(8)
        const cur = c.games === 'all' ? withGames : c.games
        const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
        c.games = next.length === withGames.length ? 'all' : next
      } else if (key in c) (c as unknown as Record<string, boolean>)[key] = !(c as unknown as Record<string, boolean>)[key]
      setExtra((x) => ({ ...x, pkg: { ...x.pkg, choice: c } }))
      refreshPkgSize(c)
    },
    [state?.consoles, state?.library.games]
  )
  const startPkg = (code?: string) => {
    setExtra((x) => ({ ...x, pkg: { ...x.pkg, busy: true, result: undefined, progress: undefined, code } }))
    setPanels((p) => [...p.filter((q) => q.id !== 'pkg-progress'), { id: 'pkg-progress', index: 0 }])
  }
  const endPkg = (r: { ok: boolean; error?: string; added?: number; kept?: number; folder?: string } | null) =>
    setExtra((x) => ({
      ...x,
      pkg: {
        ...x.pkg,
        busy: false,
        result: !r ? 'Cancelled.' : r.ok ? (r.added !== undefined ? `Done: ${r.added} file(s) added, ${r.kept ?? 0} kept.` : r.folder ? `Saved in ${r.folder}` : 'Done.') : (r.error ?? 'Stopped.')
      }
    }))
  const pkgSend = useCallback(() => {
    startPkg()
    void api.packageSend(pkgRef.current.choice).then(endPkg)
  }, [])
  const pkgSaveFolder = useCallback(() => {
    startPkg()
    void api.packageSaveToFolder(pkgRef.current.choice).then(endPkg)
  }, [])
  const receiveSettingsRef = useRef(true)
  const pkgReceiveCode = useCallback((useSettings: boolean) => {
    receiveSettingsRef.current = useSettings
    setEntry({ kind: 'field', title: 'Package code', value: '', row: 0, col: 0, focus: 'keys', result: 0, target: 'pkgcode', overPanel: true })
  }, [])
  const pkgReceiveFolder = useCallback((useSettings: boolean) => {
    startPkg()
    void api.packageReceiveFolder(useSettings).then(endPkg)
  }, [])
  const pkgCancel = useCallback(() => void api.packageCancel(), [])
  const installAll = useCallback(() => {
    void (async () => {
      const list = (await api.emulators()).filter((e) => !e.installed && e.canInstall)
      for (const e of list) await api.installEmulator(e.id)
      setExtra({ ...extraRef.current, emulators: await api.emulators() })
    })()
  }, [])
  const extraRef = useRef(extra)
  extraRef.current = extra
  const WIZ_STEPS = ['wiz-welcome', 'wiz-location', 'wiz-start', 'wiz-emulators', 'wiz-bios', 'wiz-controller', 'wiz-artwork']
  const wizardNext = useCallback((to?: number) => {
    setWizard((w) => {
      const step = to ?? (w ? w.step + 1 : 0)
      if (WIZ_STEPS[step] === 'wiz-emulators') void api.emulators().then((emulators) => setExtra((x) => ({ ...x, emulators })))
      if (WIZ_STEPS[step] === 'wiz-controller') {
        const p = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find((x): x is Gamepad => !!x && x.connected && isMenuPad(x))
        setExtra((x) => ({ ...x, pad: p ? { name: padName(p.id), api: /xinput/i.test(p.id) ? 'XInput' : 'SDL' } : null }))
      }
      return { step, index: 0 }
    })
    setPanels([])
  }, [])
  const wizardFinish = useCallback(
    (artwork: boolean) => {
      setSetting('artworkAuto', artwork)
      void api.setupDone()
      if (artwork) void api.runCommand('rescan')
      setWizard(null)
      setPanels([])
      if (state?.settings.bootAnimation) setBooting(true)
    },
    [setSetting, state?.settings.bootAnimation]
  )

  const checkUpdates2 = useCallback(() => {
    setExtra((x) => ({ ...x, update: { status: 'checking' } }))
    void api.checkForUpdates().then((update) => setExtra((x) => ({ ...x, update })))
  }, [])
  const refreshArtwork = useCallback(
    (g: Game) => {
      notify({ kind: 'info', title: 'Looking for artwork…', detail: g.title })
      void api.refreshArtwork(g.id)
    },
    [notify]
  )
  const customArt = useCallback(
    (g: Game, kind: 'icon' | 'background' | 'reset') => {
      void api.customArt(g.id, kind).then((r) => {
        if (r.error) notify({ kind: 'error', title: 'Could not use that picture', detail: r.error })
        else if (r.ok) notify({ kind: 'success', title: kind === 'reset' ? 'Back to the found artwork' : kind === 'icon' ? 'New cover set' : 'New background set', detail: g.title })
      })
    },
    [notify]
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
    if (!value && entry.kind !== 'field') {
      sfx.error()
      return
    }
    sfx.confirm()
    if (entry.kind === 'field') {
      const field = entry.target as 'name' | 'short' | 'args' | 'extensions' | 'nickname'
      if ((entry.target as string) === 'pkgcode') {
        setEntry(null)
        startPkg()
        void api.packageReceive(value, receiveSettingsRef.current).then(endPkg)
        return
      }
      if (field === 'nickname') setSetting('netplayNickname', value.slice(0, 30))
      else if (formRef.current) setForm({ ...formRef.current, [field]: entry.value.trim() })
      setEntry(null)
      return
    }
    if (entry.kind === 'new-collection')
      void api.collectionCreate(value, entry.target).then((cols) => {
        applyCollections(cols)
        notify({ kind: 'success', title: 'Collection created', detail: value })
      })
    else if (entry.target) void api.collectionRename(entry.target, value).then(applyCollections)
    setEntry(null)
    setPanels([])
  }, [entry, searchHits, applyCollections, notify, setSetting])

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
    input.setTextHandler(entry && (entry.overPanel || (!panels.length && !errorPanel)) ? typeChar : null)
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
            newCollection: () => openEntry('new-collection'),
            openPhoto: (i) => setPhoto(i),
            newConsole: () => newConsoleRef.current()
          }, shots)
        : [],
    [state, openPanel, command, openSearch, openEntry, shots]
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
    // keep following the library until a console with games was shown (or the user picked a column)
    if (firstConsole) autoColumn.current = false
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
    const ref = activePanelRef ?? (wizard ? { id: WIZ_STEPS[wizard.step], arg: undefined, index: wizard.index } : null)
    if (!ref || !state) return null
    return buildPanel(
      ref.id,
      ref.arg,
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
        refreshArtwork,
        customArt,
        runHealth,
        exportReport,
        raLogin,
        raLogout,
        playOnline,
        loadRooms,
        addToSteam,
        editField,
        pickExe,
        saveForm,
        removeConsole,
        editConsole,
        newConsole,
        clearCache,
        testPad,
        pkgToggle,
        pkgSend,
        pkgSaveFolder,
        pkgReceiveCode,
        pkgReceiveFolder,
        pkgCancel,
        installAll,
        wizardNext,
        wizardFinish,
        checkUpdates2,
        deleteGame,
        addGamesDialog,
        addGameAs,
        setSafeMode,
        undoUpdate,
        releaseToEveryone,
        markTested,
        guideSeen,
        couchSave
      },
      extra
    )
  }, [
    activePanelRef,
    wizard,
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
    refreshArtwork,
    customArt,
    runHealth,
    exportReport,
    raLogin,
    raLogout,
    playOnline,
    loadRooms,
    addToSteam,
    editField,
    pickExe,
    saveForm,
    removeConsole,
    editConsole,
    newConsole,
    clearCache,
    testPad,
    pkgToggle,
    pkgSend,
    pkgSaveFolder,
    pkgReceiveCode,
    pkgReceiveFolder,
    pkgCancel,
    installAll,
    wizardNext,
    wizardFinish,
    checkUpdates2,
    deleteGame,
    addGamesDialog,
    addGameAs,
    setSafeMode,
    undoUpdate,
    releaseToEveryone,
    markTested,
    guideSeen,
    couchSave,
    extra
  ])

  // couch check: started when its panel opens; progress every second; controller moves in the menu count
  const couchOpen = panels.some((p) => p.id === 'couch-check')
  useEffect(() => {
    if (!couchOpen) return
    void api.couchStart()
    const t = setInterval(() => void api.couchStatus().then((couch) => setExtra((x) => ({ ...x, couch }))), 1000)
    const off = input.on((_a, source) => {
      if (source === 'gamepad') void api.couchPad()
    })
    return () => {
      clearInterval(t)
      off()
    }
  }, [couchOpen])

  // once after starting (and after the boot animation): crash → offer safe mode, rescue note, What's new
  const notesTaken = useRef(false)
  useEffect(() => {
    if (booting || !state || wizard || notesTaken.current) return
    notesTaken.current = true
    void api.startNotes().then((notes) => {
      setExtra((x) => ({ ...x, notes }))
      if (notes.rescued)
        notify({
          kind: 'update',
          title: `Back on version ${notes.rescued.to}`,
          detail: `Version ${notes.rescued.from} closed unexpectedly twice right after updating, so Starstation went back. It is skipped until a newer version comes out.`
        })
      // one after the other: the question on top, the guide underneath
      const queue: string[] = []
      if (notes.homeConflicts?.length) queue.push('home-guide')
      if (notes.crashed) queue.push('crashed')
      else if (notes.whatsNew) queue.push('whats-new')
      if (queue.length) setPanels((p) => [...p, ...queue.map((id) => ({ id, index: 0 }))])
    })
  }, [booting, state, wizard, notify])

  // a panel whose subject is gone (deleted game, finished question) closes itself
  useEffect(() => {
    if (activePanelRef && state && !activePanel) setPanels((p) => p.slice(0, -1))
  }, [activePanelRef, activePanel, state])

  const wizardShown = !!wizard && !activePanelRef && !errorPanel
  const panelIndex = activePanel
    ? firstSelectable(activePanel, Math.min(errorPanel ? errorPanel.index : wizardShown ? wizard!.index : (activePanelRef?.index ?? 0), activePanel.items.length - 1), 1)
    : 0
  const setPanelIndex = (i: number) => {
    if (errorPanel) setErrorPanel({ ...errorPanel, index: i })
    else if (wizardShown) setWizard((w) => (w ? { ...w, index: i } : w))
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

    if (padTest) {
      if (a === 'back') {
        sfx.back()
        setPadTest(false)
      }
      return
    }
    if (photo !== null) {
      if (a === 'left' || a === 'up' || a === 'l1') {
        if (photo > 0) {
          sfx.move()
          setPhoto(photo - 1)
        }
      } else if (a === 'right' || a === 'down' || a === 'r1') {
        if (photo < shots.length - 1) {
          sfx.move()
          setPhoto(photo + 1)
        }
      } else if (a === 'back' || a === 'confirm') {
        sfx.back()
        setPhoto(null)
      }
      return
    }

    // the on-screen keyboard's input (search, names, form fields)
    const entryInput = (entry: EntryState) => {
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
      }

    if (entry?.overPanel) {
      entryInput(entry)
      return
    }

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
          if (r === 'keep' || wizardShown) return
          if (errorPanel) setErrorPanel(null)
          else setPanels([])
        })
      } else if (a === 'back' || a === 'options' || a === 'left') {
        if (wizardShown) {
          if (wizard!.step > 0) {
            sfx.back()
            setWizard({ step: wizard!.step - 1, index: 0 })
          }
          return
        }
        sfx.back()
        if (errorPanel) setErrorPanel(null)
        else setPanels((p) => p.slice(0, -1))
      }
      return
    }

    if (entry) {
      entryInput(entry)
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
        <Boot onDone={() => setBooting(false)} onSafeMode={() => setSafeMode(true)} />
      ) : (
        <>
          <TopBar pad={pad} battery={battery} />
          {assign && <PlayerAssign title={assign.title} max={assign.max} onDone={assign.resolve} />}
          {state?.info.safeMode && (
            <div className="safe-badge" data-testid="safe-badge">
              Safe mode
            </div>
          )}
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
          {photo !== null && <PhotoViewer shots={shots} index={photo} />}
          {padTest && <PadTest />}
          {activePanel && (
            <PanelView
              wizard={wizardShown}
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
