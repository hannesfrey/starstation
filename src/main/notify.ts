import type { BrowserWindow } from 'electron'
import type { Notice } from '../shared/types'

let win: BrowserWindow | null = null
let nextId = 1

export function attachWindow(w: BrowserWindow): void {
  win = w
}

export function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

export function notify(n: Omit<Notice, 'id'>): void {
  send('notice', { ...n, id: nextId++ })
}
