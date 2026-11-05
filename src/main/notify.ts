import type { BrowserWindow } from 'electron'
import type { Notice } from '../shared/types'

let win: BrowserWindow | null = null
let nextId = 1
/** Focus guard (SPEC-v2 A): while a game runs, notices wait and are shown when it ends. */
let holding = false
let held: Notice[] = []

export function attachWindow(w: BrowserWindow): void {
  win = w
}

export function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

export function notify(n: Omit<Notice, 'id'>): void {
  const notice = { ...n, id: nextId++ }
  if (holding) held.push(notice)
  else send('notice', notice)
}

/** Start holding notices (a game started) or show the held ones (it ended). */
export function holdNotices(on: boolean): void {
  holding = on
  if (on) return
  const list = held
  held = []
  // many notices at once: the first three, then one summary
  for (const n of list.slice(0, 3)) send('notice', n)
  if (list.length > 3) send('notice', { kind: 'info', title: `${list.length - 3} more notifications`, detail: 'From while you were playing.', id: nextId++ })
}

export function heldNotices(): number {
  return held.length
}
