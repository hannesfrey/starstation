/**
 * Unified input: keyboard, gamepads (Gamepad API) and mouse wheel → menu actions.
 * Racing wheels, pedals and flight sticks are ignored so they never move the menu.
 */
export type Action =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'confirm'
  | 'back'
  | 'options'
  | 'search'
  | 'start'
  | 'select'
  | 'l1'
  | 'r1'

export const BACKSPACE = 'Backspace'

export type PadKind = 'playstation' | 'xbox' | 'generic'

export interface PadEvent {
  type: 'connected' | 'disconnected'
  kind: PadKind
  name: string
}

const IGNORED_DEVICES = /wheel|g29|g920|g923|driving|racing|pedal|throttle|hotas|flight|joystick|rudder|shifter/i

export function padKind(id: string): PadKind {
  if (/054c|dualshock|dualsense|wireless controller|playstation|ps3|ps4|ps5/i.test(id)) return 'playstation'
  if (/xbox|xinput|045e/i.test(id)) return 'xbox'
  return 'generic'
}

export function padName(id: string): string {
  const clean = id.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim()
  return clean || 'Controller'
}

export function isMenuPad(p: Gamepad): boolean {
  if (IGNORED_DEVICES.test(p.id)) return false
  return p.mapping === 'standard' || p.buttons.length >= 10
}

/** Standard mapping: the Guide / PS / Home button. */
export const GUIDE = 16

/**
 * The controller holding the PS / Guide button right now: the one that opened the PS button menu.
 * Only when exactly one is holding it (never a guess); null otherwise.
 */
export function guideHolder(pads: readonly (Gamepad | null)[]): number | null {
  const holding = pads.filter((p): p is Gamepad => !!p && p.connected && isMenuPad(p) && !!p.buttons[GUIDE]?.pressed)
  return holding.length === 1 ? holding[0].index : null
}

// Standard mapping button indices
const BTN: Record<number, Action> = {
  0: 'confirm',
  1: 'back',
  2: 'search',
  3: 'options',
  4: 'l1',
  5: 'r1',
  8: 'select',
  9: 'start',
  12: 'up',
  13: 'down',
  14: 'left',
  15: 'right'
}
/** Settings → Accessibility: menu buttons can be moved (e.g. ○ to confirm). */
let buttons: Record<number, Action> = { ...BTN }
/** Remappable menu actions and the buttons they can go to (standard mapping indices). */
export const REMAPPABLE: Action[] = ['confirm', 'back', 'options', 'search', 'select', 'start', 'l1', 'r1']
export const BUTTON_NAMES: Record<number, string> = { 0: '✕', 1: '○', 2: '□', 3: '△', 4: 'L1', 5: 'R1', 8: 'Select', 9: 'Start' }

/** Apply a remap ({action: button}). An action moved onto a taken button swaps with that button's action. */
export function setButtonMap(map: Partial<Record<Action, number>>): void {
  const next: Record<number, Action> = { ...BTN }
  for (const [action, idx] of Object.entries(map) as [Action, number][]) {
    if (!(idx in BUTTON_NAMES) || !REMAPPABLE.includes(action)) continue
    const from = Number(Object.keys(next).find((k) => next[Number(k)] === action))
    const other = next[idx]
    next[idx] = action
    if (!Number.isNaN(from) && from !== idx) {
      if (other) next[from] = other
      else delete next[from]
    }
  }
  buttons = next
}

/** The button an action is on right now. */
export function buttonFor(action: Action): number | undefined {
  const k = Object.keys(buttons).find((i) => buttons[Number(i)] === action)
  return k === undefined ? undefined : Number(k)
}

const DIRECTIONS = new Set<Action>(['up', 'down', 'left', 'right'])
const REPEAT_DELAY = 380
const REPEAT_RATE = 95

type Listener = (a: Action, source: 'keyboard' | 'gamepad' | 'mouse') => void

export class InputManager {
  private listeners = new Set<Listener>()
  private padListeners = new Set<(e: PadEvent) => void>()
  private anyListeners = new Set<() => void>()
  private held = new Map<string, { since: number; last: number }>()
  /** Buttons already down when the menu got the focus back: ignored until let go. */
  private blocked = new Set<string>()
  private active = false
  private raf = 0
  private enabled = true
  private known = new Map<number, string>()
  private text: ((ch: string) => void) | null = null
  /** PS button menu: only this controller drives it (null = every controller). */
  private onlyPad: number | null = null
  lastKind: PadKind | null = null

  /** Only this controller's buttons count (the player who opened the PS button menu); null = all again. */
  setOnlyPad(index: number | null): void {
    this.onlyPad = index
  }

  /** The controller the PS button menu listens to (null = all); read by tests. */
  get lockedPad(): number | null {
    return this.onlyPad
  }

  start(): void {
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('gamepadconnected', this.onPadConnect)
    window.addEventListener('gamepaddisconnected', this.onPadDisconnect)
    const loop = () => {
      this.poll()
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop(): void {
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('gamepadconnected', this.onPadConnect)
    window.removeEventListener('gamepaddisconnected', this.onPadDisconnect)
    cancelAnimationFrame(this.raf)
  }

  /** While a game runs, Starstation ignores all input. */
  setEnabled(on: boolean): void {
    this.enabled = on
    this.held.clear()
  }

  /** While the on-screen keyboard is open, typed characters go here (BACKSPACE = delete). */
  setTextHandler(fn: ((ch: string) => void) | null): void {
    this.text = fn
  }

  on(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  onPad(l: (e: PadEvent) => void): () => void {
    this.padListeners.add(l)
    return () => this.padListeners.delete(l)
  }
  /** Any key or button (used to skip the boot animation / wake the screensaver). */
  onAny(l: () => void): () => void {
    this.anyListeners.add(l)
    return () => this.anyListeners.delete(l)
  }

  emit(a: Action, source: 'keyboard' | 'gamepad' | 'mouse'): void {
    if (!this.enabled) return
    for (const l of [...this.listeners]) l(a, source)
  }

  private any(): void {
    for (const l of [...this.anyListeners]) l()
  }

  private onKey = (e: KeyboardEvent) => {
    if (!this.enabled) return
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        /* fall through: let menus handle these */
      } else return
    }
    this.any()
    if (this.text && !e.ctrlKey && !e.altKey && !e.metaKey && (e.key.length === 1 || e.key === 'Backspace')) {
      e.preventDefault()
      this.text(e.key === 'Backspace' ? BACKSPACE : e.key)
      return
    }
    let a: Action | null = null
    switch (e.key) {
      case 'ArrowUp':
        a = 'up'
        break
      case 'ArrowDown':
        a = 'down'
        break
      case 'ArrowLeft':
        a = 'left'
        break
      case 'ArrowRight':
        a = 'right'
        break
      case 'Enter':
        a = 'confirm'
        break
      case 'Escape':
      case 'Backspace':
        a = 'back'
        break
      case ' ':
        a = 'options'
        break
      case 'f':
      case 'F':
        if (e.ctrlKey) a = 'search'
        else if (!e.altKey) a = 'select'
        break
      case 'PageUp':
        a = 'l1'
        break
      case 'PageDown':
        a = 'r1'
        break
      case 'Home':
        a = 'start'
        break
    }
    if (a) {
      e.preventDefault()
      this.emit(a, 'keyboard')
    }
  }

  private wheelAcc = 0
  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return
    e.preventDefault()
    this.any()
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey
    this.wheelAcc += horizontal ? e.deltaX || e.deltaY : e.deltaY
    if (Math.abs(this.wheelAcc) < 40) return
    const dir = this.wheelAcc > 0
    this.wheelAcc = 0
    this.emit(horizontal ? (dir ? 'right' : 'left') : dir ? 'down' : 'up', 'mouse')
  }

  private onPadConnect = (e: GamepadEvent) => {
    if (!isMenuPad(e.gamepad)) return
    this.known.set(e.gamepad.index, e.gamepad.id)
    this.lastKind = padKind(e.gamepad.id)
    for (const l of this.padListeners) l({ type: 'connected', kind: this.lastKind, name: padName(e.gamepad.id) })
  }

  private onPadDisconnect = (e: GamepadEvent) => {
    if (!this.known.has(e.gamepad.index)) return
    this.known.delete(e.gamepad.index)
    for (const l of this.padListeners) l({ type: 'disconnected', kind: padKind(e.gamepad.id), name: padName(e.gamepad.id) })
  }

  private poll(): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : []
    const now = performance.now()
    const pressed = new Set<string>()
    for (const p of pads) {
      if (!p || !p.connected || !isMenuPad(p)) continue
      if (this.onlyPad !== null && p.index !== this.onlyPad) continue
      p.buttons.forEach((b, i) => {
        const a = buttons[i]
        if (a && (b.pressed || b.value > 0.6)) pressed.add(`${p.index}:${a}`)
      })
      const [x = 0, y = 0] = p.axes
      if (y < -0.6) pressed.add(`${p.index}:up`)
      if (y > 0.6) pressed.add(`${p.index}:down`)
      if (x < -0.6) pressed.add(`${p.index}:left`)
      if (x > 0.6) pressed.add(`${p.index}:right`)
      if (p.buttons.some((b) => b.pressed)) this.lastKind = padKind(p.id)
    }
    if (!document.hasFocus() || !this.enabled) {
      this.held.clear()
      this.active = false
      return
    }
    // back from a game (or another window): a button still held from there is not a new press
    // (2026-11-07: the ✕ that chose "Save and quit" started the game again the moment the menu got the focus)
    if (!this.active) {
      this.active = true
      this.blocked = new Set(pressed)
    }
    for (const key of [...this.blocked]) if (!pressed.has(key)) this.blocked.delete(key)
    for (const key of pressed) {
      if (this.blocked.has(key)) continue
      const a = key.split(':')[1] as Action
      const h = this.held.get(key)
      if (!h) {
        this.held.set(key, { since: now, last: now })
        this.any()
        this.emit(a, 'gamepad')
      } else if (DIRECTIONS.has(a) && now - h.since > REPEAT_DELAY && now - h.last > REPEAT_RATE) {
        h.last = now
        this.emit(a, 'gamepad')
      }
    }
    for (const key of [...this.held.keys()]) if (!pressed.has(key)) this.held.delete(key)
  }
}

export const input = new InputManager()
