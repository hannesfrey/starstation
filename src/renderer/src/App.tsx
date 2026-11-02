import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { input, type Action, type PadKind } from './input'
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
import type { AppState, Game, LaunchResult, Notice, Settings } from '../../shared/types'

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
  const [errorPanel, setErrorPanel] = useState<{ title: string; result: LaunchResult; index: number } | null>(null)
  const [pad, setPad] = useState<PadKind | null>(null)
  const [idle, setIdle] = useState(false)
  const [extra, setExtra] = useState<PanelExtra>({ emuProgress: {}, importing: false })
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
    const early: Partial<AppState> = {}
    const apply = (patch: Partial<AppState>) =>
      setState((s) => {
        if (!s) {
          Object.assign(early, patch)
          return s
        }
        return { ...s, ...patch }
      })
    api.getState().then((s) => {
      setState({ ...s, ...early })
      if (!s.settings.bootAnimation) setBooting(false)
    })
    const offs = [
      api.on('library', (library) => {
        scanned.current = true
        apply({ library })
      }),
      api.on('consoles', (consoles) => apply({ consoles })),
      api.on('running', (running) => apply({ running })),
      api.on('import-progress', (p) => setExtra((x) => ({ ...x, importProgress: p }))),
      api.on('emulator-progress', ({ id, text }) => setExtra((x) => ({ ...x, emuProgress: { ...x.emuProgress, [id]: text } }))),
      api.on('notice', (n) => {
        setNotices((l) => [...l, n])
        sfx.notify()
      })
    ]
    input.start()
    const offPad = input.onPad((e) => {
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

  const launch = useCallback(
    async (g: Game) => {
      sfx.launch()
      setPanels([])
      const r = await api.launch(g.id)
      if (!r.ok) {
        sfx.error()
        setErrorPanel({ title: `Can't start ${g.title}`, result: r, index: 1 })
      }
    },
    []
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
    if (id === 'emulators') {
      api.emulators().then((emulators) => setExtra((x) => ({ ...x, emulators })))
      api.checkEmulatorUpdates().then((emulators) => setExtra((x) => ({ ...x, emulators })))
    }
    if (id === 'import') {
      setExtra((x) => (x.importing ? x : { ...x, importSources: undefined, importResult: undefined, importProgress: undefined }))
      api.importScan().then((importSources) => setExtra((x) => ({ ...x, importSources })))
    }
  }, [])

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

  // ---- model ----
  const columns = useMemo(
    () =>
      state
        ? buildColumns(state, {
            openPanel,
            command,
            toggleFullscreen: () => void api.toggleFullscreen(),
            quit: () => void api.quit()
          })
        : [],
    [state, openPanel, command]
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
  const row = byKey >= 0 ? byKey : Math.min(saved?.index ?? 0, Math.max(0, items.length - 1))
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
    return buildPanel(activePanelRef.id, activePanelRef.arg, state, { setSetting, command, launch, toggleFavorite, openPanel, installEmulator, checkUpdates, runImport }, extra)
  }, [activePanelRef, errorPanel, state, setSetting, command, launch, toggleFavorite, openPanel, installEmulator, checkUpdates, runImport, extra])

  const panelIndex = activePanel
    ? firstSelectable(activePanel, Math.min(errorPanel ? errorPanel.index : (activePanelRef?.index ?? 0), activePanel.items.length - 1), 1)
    : 0
  const setPanelIndex = (i: number) => {
    if (errorPanel) setErrorPanel({ ...errorPanel, index: i })
    else setPanels((p) => p.map((x, k) => (k === p.length - 1 ? { ...x, index: i } : x)))
  }

  // ---- input ----
  const handler = useRef<(a: Action) => void>(() => undefined)
  handler.current = (a: Action) => {
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
        break
    }
  }

  useEffect(() => input.on((a) => handler.current(a)), [])

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

  const bgArt = !activePanel && current?.game?.background
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
