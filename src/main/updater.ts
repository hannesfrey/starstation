import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { logger } from './log'
import type { Notice } from '../shared/types'

/**
 * Starstation updates itself from GitHub releases: checked at startup, downloaded in the background,
 * installed when Starstation closes — so the new version is active on the next start.
 * Its download cache is inside Files\config\electron (see paths.redirectElectronPaths).
 */

const log = logger('updater')
let state: { status: 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'error' | 'dev'; version?: string; error?: string } = { status: 'idle' }

export function updateState(): typeof state {
  return app.isPackaged ? state : { status: 'dev' }
}

export function startUpdater(notify: (n: Omit<Notice, 'id'>) => void): void {
  if (!app.isPackaged || process.env.STARSTATION_HEADLESS === '1') return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: (m: unknown) => log.info(String(m)), warn: (m: unknown) => log.warn(String(m)), error: (m: unknown) => log.error(String(m)), debug: () => undefined }
  autoUpdater.on('checking-for-update', () => (state = { status: 'checking' }))
  autoUpdater.on('update-not-available', () => (state = { status: 'latest', version: app.getVersion() }))
  autoUpdater.on('update-available', (i) => (state = { status: 'downloading', version: i.version }))
  autoUpdater.on('update-downloaded', (i) => {
    state = { status: 'ready', version: i.version }
    notify({ kind: 'update', title: 'Starstation update ready', detail: `Version ${i.version} is used from the next start.` })
  })
  autoUpdater.on('error', (e) => {
    state = { status: 'error', error: e.message }
    log.warn('update check failed', e)
  })
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => undefined), 8000)
}

export async function checkNow(): Promise<typeof state> {
  if (!app.isPackaged) return { status: 'dev' }
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    state = { status: 'error', error: (e as Error).message }
  }
  return state
}
