import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { app } from 'electron'
import { dir, filesDir } from './paths'
import { getSettings } from './settings'
import { allConsoles } from './presets'
import { consoleInfos } from './consoles'
import { emulatorInfos } from './emulators'
import { healthCheck } from './health'
import { view } from './library/library'

/**
 * Settings → Diagnostics → Export report: logs + settings + a summary in one zip.
 * Never included: secrets.json (logins), saves, BIOS, games.
 */
export async function exportReport(to: string): Promise<string> {
  const stage = dir('config', 'electron', 'temp', `report-${Date.now()}`)
  await fsp.mkdir(stage, { recursive: true })
  try {
    await fsp.cp(dir('config', 'logs'), path.join(stage, 'logs'), { recursive: true }).catch(() => undefined)
    for (const f of ['settings.json', 'controllers.json', 'imports.json']) {
      const p = dir('config', f)
      if (fs.existsSync(p)) await fsp.copyFile(p, path.join(stage, f))
    }
    const lib = view()
    const summary = {
      createdAt: new Date().toISOString(),
      starstation: { version: app.getVersion(), packaged: app.isPackaged, files: filesDir() },
      system: {
        os: `${os.type()} ${os.release()} ${os.arch()}`,
        cpu: os.cpus()[0]?.model,
        memoryGB: Math.round(os.totalmem() / 1024 ** 3),
        electron: process.versions.electron,
        chrome: process.versions.chrome
      },
      settings: getSettings(),
      consoles: consoleInfos().map((c) => ({ id: c.id, status: c.statusText })),
      emulators: emulatorInfos().map((e) => ({ id: e.id, installed: e.installed, version: e.version, latest: e.latest })),
      games: lib.games.length,
      gamesPerConsole: Object.fromEntries(allConsoles().map((c) => [c.id, lib.games.filter((g) => g.console === c.id).length])),
      health: healthCheck()
    }
    await fsp.writeFile(path.join(stage, 'summary.json'), JSON.stringify(summary, null, 2))
    await fsp.mkdir(path.dirname(to), { recursive: true })
    await fsp.rm(to, { force: true })
    // Windows' own tar writes .zip files (-a picks the format from the name)
    const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    await new Promise<void>((resolve, reject) => {
      const p = spawn(tar, ['-a', '-cf', to, '-C', stage, '.'], { windowsHide: true, stdio: 'ignore' })
      p.once('error', reject)
      p.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`zip failed (${code})`))))
    })
    return to
  } finally {
    await fsp.rm(stage, { recursive: true, force: true })
  }
}
