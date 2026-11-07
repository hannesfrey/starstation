import { Component, type ReactNode } from 'react'
import { api } from '../api'

/**
 * Safety net for the menu: an error while drawing would otherwise leave a black window that a controller
 * can't get out of. The error goes into Starstation's log and the page loads again by itself.
 * If it keeps failing (3 times within a minute) it stops reloading and says so.
 */

const KEY = 'starstation-error-reloads'

function recentReloads(): number[] {
  try {
    const list = JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as number[]
    return list.filter((t) => Date.now() - t < 60_000)
  } catch {
    return []
  }
}

export function reportError(where: string, e: unknown): void {
  const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)
  void api?.logError?.(where, msg).catch(() => undefined)
}

export class ErrorBoundary extends Component<{ where: string; children: ReactNode }, { failed: boolean; gaveUp: boolean }> {
  state = { failed: false, gaveUp: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    reportError(this.props.where, error)
    const list = recentReloads()
    if (list.length >= 3) {
      this.setState({ gaveUp: true })
      return
    }
    sessionStorage.setItem(KEY, JSON.stringify([...list, Date.now()]))
    window.setTimeout(() => window.location.reload(), 1500)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    // the PS button menu window is see-through over the game: show nothing there
    if (this.props.where === 'overlay') return null
    return (
      <div className="error-screen" data-testid="error-screen">
        <div className="error-screen-title">Something went wrong in the menu</div>
        <div className="error-screen-detail">
          {this.state.gaveUp ? 'It keeps happening. Close Starstation and start it again; the log in Files\\config\\logs has the details.' : 'Starting the menu again…'}
        </div>
      </div>
    )
  }
}

/** Errors outside drawing (timers, promises) only go into the log: they don't break the menu. */
export function logUncaughtErrors(where: string): void {
  window.addEventListener('error', (e) => reportError(where, e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e) => reportError(where, e.reason))
}
