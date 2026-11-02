import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
  getState: () => ipcRenderer.invoke('state'),
  importScan: () => ipcRenderer.invoke('import-scan'),
  importRun: (index: number) => ipcRenderer.invoke('import-run', index),
  emulators: () => ipcRenderer.invoke('emulators'),
  checkEmulatorUpdates: () => ipcRenderer.invoke('emulators-check'),
  installEmulator: (id: string) => ipcRenderer.invoke('emulator-install', id),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('set-setting', key, value),
  rescan: () => ipcRenderer.invoke('rescan'),
  launch: (gameId: string, mode?: string) => ipcRenderer.invoke('launch', gameId, mode),
  gameDetails: (gameId: string) => ipcRenderer.invoke('game-details', gameId),
  backupNow: (gameId: string) => ipcRenderer.invoke('backup-now', gameId),
  restoreBackup: (gameId: string, backupId: string) => ipcRenderer.invoke('backup-restore', gameId, backupId),
  restorePreviousResume: (gameId: string) => ipcRenderer.invoke('resume-restore-previous', gameId),
  deleteGame: (gameId: string, withSaves: boolean) => ipcRenderer.invoke('delete-game', gameId, withSaves),
  collectionCreate: (name: string, firstGame?: string) => ipcRenderer.invoke('collection-create', name, firstGame),
  collectionRename: (id: string, name: string) => ipcRenderer.invoke('collection-rename', id, name),
  collectionDelete: (id: string) => ipcRenderer.invoke('collection-delete', id),
  collectionToggle: (id: string, gameId: string) => ipcRenderer.invoke('collection-toggle', id, gameId),
  addGames: (paths: string[], consoleId?: string) => ipcRenderer.invoke('add-games', paths, consoleId),
  addGamesDialog: () => ipcRenderer.invoke('add-games-dialog'),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  toggleFavorite: (gameId: string) => ipcRenderer.invoke('toggle-favorite', gameId),
  openFolder: (kind: string, arg?: string) => ipcRenderer.invoke('open-folder', kind, arg),
  runCommand: (command: string, arg?: string) => ipcRenderer.invoke('run-command', command, arg),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  quit: () => ipcRenderer.invoke('quit'),
  mediaUrl: (absPath: string) => `starstation-media://local/${encodeURIComponent(absPath)}`,
  on: (channel: string, cb: (payload: unknown) => void) => {
    const allowed = ['notice', 'library', 'consoles', 'collections', 'running', 'navigate', 'import-progress', 'emulator-progress']
    if (!allowed.includes(channel)) throw new Error(`Unknown channel ${channel}`)
    const h = (_e: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, h)
    return () => ipcRenderer.removeListener(channel, h)
  }
}

contextBridge.exposeInMainWorld('starstation', api)
