import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getState: () => ipcRenderer.invoke('state'),
  importScan: () => ipcRenderer.invoke('import-scan'),
  importRun: (index: number) => ipcRenderer.invoke('import-run', index),
  emulators: () => ipcRenderer.invoke('emulators'),
  checkEmulatorUpdates: () => ipcRenderer.invoke('emulators-check'),
  installEmulator: (id: string) => ipcRenderer.invoke('emulator-install', id),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('set-setting', key, value),
  rescan: () => ipcRenderer.invoke('rescan'),
  launch: (gameId: string) => ipcRenderer.invoke('launch', gameId),
  toggleFavorite: (gameId: string) => ipcRenderer.invoke('toggle-favorite', gameId),
  openFolder: (kind: string, arg?: string) => ipcRenderer.invoke('open-folder', kind, arg),
  runCommand: (command: string, arg?: string) => ipcRenderer.invoke('run-command', command, arg),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  quit: () => ipcRenderer.invoke('quit'),
  mediaUrl: (absPath: string) => `starstation-media://local/${encodeURIComponent(absPath)}`,
  on: (channel: string, cb: (payload: unknown) => void) => {
    const allowed = ['notice', 'library', 'consoles', 'running', 'navigate', 'import-progress', 'emulator-progress']
    if (!allowed.includes(channel)) throw new Error(`Unknown channel ${channel}`)
    const h = (_e: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, h)
    return () => ipcRenderer.removeListener(channel, h)
  }
}

contextBridge.exposeInMainWorld('starstation', api)
