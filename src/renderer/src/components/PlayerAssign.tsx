import { useEffect, useRef, useState } from 'react'
import { isMenuPad, padName } from '../input'
import { sfx } from '../sound'
import type { PlayerPad } from '../../../shared/types'

/**
 * Controller assignment (SPEC-v2 A): with 2+ controllers and a game for 2+ players,
 * "Press ✕ for Player 1" … up to 4. Start = play with the players so far, ○ = the usual order.
 */

const XINPUT = /xinput|xbox/i

export function menuPads(): Gamepad[] {
  return [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter((p): p is Gamepad => !!p && p.connected && isMenuPad(p))
}

/** Gamepad API pad → the device number its API (XInput / SDL) gives it. */
function toPlayerPad(p: Gamepad, all: Gamepad[]): PlayerPad {
  const xin = XINPUT.test(p.id)
  const same = all.filter((q) => XINPUT.test(q.id) === xin).sort((a, b) => a.index - b.index)
  return { api: xin ? 'xinput' : 'sdl', index: Math.max(0, same.findIndex((q) => q.index === p.index)), id: p.id }
}

export function PlayerAssign({ title, max, onDone }: { title: string; max: number; onDone: (r: PlayerPad[] | null | 'cancel') => void }) {
  const [order, setOrder] = useState<Gamepad[]>([])
  const orderRef = useRef<Gamepad[]>([])
  const done = useRef(false)

  useEffect(() => {
    const was = new Map<string, boolean>()
    let timer = 0
    const finish = (r: PlayerPad[] | null | 'cancel') => {
      if (done.current) return
      done.current = true
      onDone(r)
    }
    const tick = () => {
      const pads = menuPads()
      for (const p of pads) {
        const pressed = (b: number) => !!p.buttons[b]?.pressed
        const key = (b: number) => `${p.index}:${b}`
        const edge = (b: number) => {
          const now = pressed(b)
          const before = was.get(key(b)) ?? true // ignore buttons already held when the screen opens
          was.set(key(b), now)
          return now && !before
        }
        const cross = edge(0)
        const circle = edge(1)
        const start = edge(9)
        const taken = orderRef.current.some((q) => q.index === p.index)
        if (cross && !taken && orderRef.current.length < max) {
          orderRef.current = [...orderRef.current, p]
          setOrder(orderRef.current)
          sfx.confirm()
          if (orderRef.current.length >= Math.min(max, pads.length)) {
            const list = orderRef.current
            setTimeout(() => finish(list.map((q) => toPlayerPad(q, menuPads()))), 500)
          }
        } else if (start && orderRef.current.length) finish(orderRef.current.map((q) => toPlayerPad(q, pads)))
        else if (circle) {
          sfx.back()
          finish(null)
        }
      }
      if (done.current) window.clearInterval(timer)
    }
    // a timer, not animation frames: those stop when the window is hidden or in the background
    timer = window.setInterval(tick, 16)
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish('cancel')
      else if (e.key === 'Enter') finish(orderRef.current.length ? orderRef.current.map((q) => toPlayerPad(q, menuPads())) : null)
    }
    window.addEventListener('keydown', key)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('keydown', key)
    }
  }, [max, onDone])

  const next = order.length + 1
  return (
    <div className="assign" data-testid="assign">
      <div className="assign-title">{title}</div>
      <div className="assign-ask">{next <= max ? `Press ✕ for Player ${next}` : 'Ready'}</div>
      <div className="assign-list">
        {Array.from({ length: max }, (_, i) => (
          <div key={i} className={`assign-slot ${order[i] ? 'set' : ''}`}>
            <div className="assign-player">Player {i + 1}</div>
            <div className="assign-pad">{order[i] ? padName(order[i].id) : '—'}</div>
          </div>
        ))}
      </div>
      <div className="assign-hint">Start: play now · ○: usual order</div>
    </div>
  )
}
