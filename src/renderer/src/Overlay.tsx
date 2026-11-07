import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { guideHolder, input, isMenuPad, padName } from './input'
import { sfx } from './sound'
import type { OverlayAction, OverlayState } from '../../shared/types'

/**
 * PS button menu (SPEC-v2 A), shown in its own see-through window over the running game.
 * Controller: ↑↓ choose, ✕ select, ○ or the PS button again = back to the game.
 */

type Item = { key: string; label: string; action?: OverlayAction; sub?: 'pads' }

/** Controller presses this soon after the menu opens were meant for the game (see openedAt). */
const OPEN_GRACE_MS = 400

function items(s: OverlayState): Item[] {
  const list: Item[] = [{ key: 'resume', label: 'Resume', action: 'resume' }]
  if (s.canSaveState) list.push({ key: 'save', label: 'Save state', action: 'save-state' })
  if (s.canLoadState) list.push({ key: 'load', label: 'Load state', action: 'load-state' })
  list.push({ key: 'shot', label: 'Screenshot', action: 'screenshot' })
  list.push({ key: 'pads', label: 'Controller settings', sub: 'pads' })
  list.push({ key: 'savequit', label: s.quickResume ? 'Save and quit' : 'Quit game', action: 'save-quit' })
  if (s.quickResume) list.push({ key: 'quit', label: 'Quit without saving a state', action: 'quit' })
  return list
}

export function Overlay() {
  const [state, setState] = useState<OverlayState | null>(null)
  const [row, setRow] = useState(0)
  const [view, setView] = useState<'menu' | 'pads'>('menu')
  const [busy, setBusy] = useState(false)
  const stateRef = useRef(state)
  stateRef.current = state
  /**
   * When the menu opened. Presses in the first moment are dropped: they were meant for the game
   * (2026-11-07, Black Ops II with two players: the other player's buttons picked "Screenshot" within 0.1 s
   * of the menu opening, again and again). A button pressed then counts only after it is let go.
   */
  const openedAt = useRef(0)

  useEffect(() => {
    document.documentElement.classList.add('overlay-page')
    void api.overlayState().then(setState)
    // only the player who pressed PS drives the menu: the controller still holding PS as it appears.
    // Not seen (a very short tap) → every controller, as before; never a guess.
    let watch = 0
    const findOpener = () => {
      window.clearInterval(watch)
      const until = performance.now() + 800
      watch = window.setInterval(() => {
        const who = guideHolder(navigator.getGamepads ? navigator.getGamepads() : [])
        if (who !== null) input.setOnlyPad(who)
        if (who !== null || performance.now() > until) window.clearInterval(watch)
      }, 16)
    }
    const off = api.on('overlay', (s) => {
      if (s.open && !stateRef.current?.open) {
        openedAt.current = performance.now()
        input.setOnlyPad(null)
        findOpener()
      }
      if (!s.open) {
        window.clearInterval(watch)
        input.setOnlyPad(null)
      }
      setState(s)
      if (s.open) {
        setRow(0)
        setView('menu')
        setBusy(false)
        sfx.confirm()
      }
    })
    input.start()
    return () => {
      off()
      window.clearInterval(watch)
      input.stop()
    }
  }, [])

  const run = useCallback(async (it: Item) => {
    if (it.sub) {
      setView('pads')
      sfx.confirm()
      return
    }
    if (!it.action) return
    sfx.confirm()
    setBusy(true)
    await api.overlayAction(it.action)
    setBusy(false)
  }, [])

  useEffect(
    () =>
      input.on((a, source) => {
        const s = stateRef.current
        if (!s?.open || s.closing || busy) return
        if (source === 'gamepad' && performance.now() - openedAt.current < OPEN_GRACE_MS) return
        const list = items(s)
        if (view === 'pads') {
          if (a === 'back' || a === 'confirm') {
            setView('menu')
            sfx.back()
          }
          return
        }
        if (a === 'up' || a === 'down') {
          setRow((r) => Math.max(0, Math.min(list.length - 1, r + (a === 'up' ? -1 : 1))))
          sfx.move()
        } else if (a === 'confirm') void run(list[Math.min(row, list.length - 1)])
        else if (a === 'back') {
          sfx.back()
          void api.overlayAction('resume')
        }
      }),
    [row, view, busy, run]
  )

  if (!state?.open) return <div className="overlay-root" data-testid="overlay-closed" />
  if (state.closing)
    return (
      <div className="overlay-root open" data-testid="overlay">
        <div className="overlay-panel">
          <div className="overlay-game">
            <div className="overlay-title">{state.title}</div>
            <div className="overlay-console">{state.console}</div>
          </div>
          <div className="overlay-items" data-testid="overlay-closing">
            <div className="overlay-info">{state.quickResume ? 'Saving and closing…' : 'Closing…'}</div>
          </div>
          <div className="overlay-hint">Back to Starstation in a moment</div>
        </div>
      </div>
    )
  const list = items(state)
  const pads = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter((p): p is Gamepad => !!p && p.connected && isMenuPad(p))
  return (
    <div className="overlay-root open" data-testid="overlay">
      <div className="overlay-panel">
        <div className="overlay-game">
          <div className="overlay-title">{state.title}</div>
          <div className="overlay-console">{state.console}</div>
        </div>
        {view === 'menu' ? (
          <div className="overlay-items">
            {list.map((it, i) => (
              <div
                key={it.key}
                className={`overlay-item ${i === row ? 'sel' : ''}`}
                data-testid={`overlay-${it.key}`}
                onMouseEnter={() => setRow(i)}
                onClick={() => void run(it)}
              >
                {it.label}
              </div>
            ))}
          </div>
        ) : (
          <div className="overlay-items" data-testid="overlay-pads">
            {pads.length ? (
              pads.map((p, i) => (
                <div key={p.index} className="overlay-info">
                  Player {i + 1}: {padName(p.id)}
                </div>
              ))
            ) : (
              <div className="overlay-info">No controller found.</div>
            )}
            <div className="overlay-info dim">Player order is chosen when a game for 2+ players starts.</div>
            <div className="overlay-item sel" onClick={() => setView('menu')}>
              Back
            </div>
          </div>
        )}
        <div className="overlay-hint">○ or the PS button: back to the game</div>
      </div>
    </div>
  )
}
