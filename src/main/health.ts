import fs from 'node:fs'
import path from 'node:path'
import { filesDir } from './paths'
import { allConsoles, getEmulator } from './presets'
import { emulatorInstalled } from './emuconfig'
import { biosStatus } from './bios'
import { view } from './library/library'
import { referencedFiles } from './formats/gameid'
import { emulatorInfos } from './emulators'
import { gpuDrivers, homeConflicts } from './system'
import type { HealthIssue } from '../shared/types'

/** Settings → Health check: everything that would stop a game from starting, each with a fix or an instruction. */
export function healthCheck(): HealthIssue[] {
  const issues: HealthIssue[] = []
  const games = view().games
  const updates = new Map(emulatorInfos().map((e) => [e.id, e]))

  for (const c of allConsoles()) {
    const mine = games.filter((g) => g.console === c.id)
    if (!mine.length) continue
    const e = getEmulator(c.emulator)
    if (!emulatorInstalled(c)) {
      issues.push({
        severity: 'error',
        title: `${e?.name ?? c.emulator} is not installed`,
        detail: `${mine.length} ${c.short} game(s) can't start.`,
        fix: e?.download?.type === 'page' ? { label: 'Open download page', command: 'open-url', arg: e.download.page } : { label: `Install ${e?.name ?? c.emulator}`, command: 'install-emulator', arg: c.emulator }
      })
      continue
    }
    const bios = biosStatus(c)
    if (!bios.ok)
      issues.push({
        severity: 'error',
        title: `${c.short} needs ${bios.missing.join(', ')}`,
        detail: c.bios?.hint ?? `Put the file in the ${c.short} BIOS folder.`,
        fix: bios.fix ?? { label: 'Open BIOS folder', command: 'open-folder', arg: `bios:${c.id}` }
      })
    const u = updates.get(c.emulator)
    if (u?.updateAvailable)
      issues.push({ severity: 'info', title: `${u.name} update available`, detail: `${u.version} → ${u.latest}`, fix: { label: `Update ${u.name}`, command: 'install-emulator', arg: u.id } })
  }

  // broken games: missing launch file, empty file, disc tracks a .cue/.m3u points to but that are gone
  for (const g of games) {
    if (g.kind === 'installed') continue
    let problem: string | null = null
    if (!fs.existsSync(g.launchPath)) problem = 'The game file is missing.'
    else if (g.kind === 'file' && fs.statSync(g.path).size === 0) problem = 'The game file is empty (0 bytes) — the download or copy probably failed.'
    else if (/\.(cue|m3u)$/i.test(g.path)) {
      const missing = referencedFiles(g.path).filter((f) => !fs.existsSync(f))
      if (missing.length) problem = `${missing.length} file(s) it refers to are missing, e.g. ${path.basename(missing[0])}.`
    }
    if (problem) issues.push({ severity: 'warning', title: `${g.title} looks broken`, detail: problem, fix: { label: 'Open game folder', command: 'open-folder', arg: `game:${g.id}` } })
  }

  // disk space on the drive with Files\
  try {
    const s = fs.statfsSync(filesDir())
    const free = s.bavail * s.bsize
    if (free < 10 * 1024 ** 3)
      issues.push({
        severity: free < 2 * 1024 ** 3 ? 'error' : 'warning',
        title: 'Low disk space',
        detail: `Only ${(free / 1024 ** 3).toFixed(1)} GB free on the drive with Starstation. Saves, states and updates need room.`
      })
  } catch {
    /* statfs not available */
  }

  // OneDrive syncing the folder would upload every game and fight over open saves
  if (/\\OneDrive[^\\]*\\/i.test(filesDir() + '\\'))
    issues.push({ severity: 'warning', title: 'Starstation is inside OneDrive', detail: 'OneDrive would upload all games and can lock saves while a game runs. Move the Starstation folder out of OneDrive.' })

  // the PS / Home button has to reach Starstation's menu during games
  const hc = homeConflicts()
  if (hc.gameBar)
    issues.push({
      severity: 'warning',
      title: 'Xbox Game Bar takes the PS / Home button',
      detail: 'Windows Settings → Gaming → Xbox Game Bar: switch off "Open Xbox Game Bar using this button on a controller". Starstation doesn’t change it for you.'
    })
  if (hc.steam)
    issues.push({
      severity: 'info',
      title: 'Steam is running',
      detail: 'Steam can take the PS / Home button: in Steam → Settings → Controller, switch off "Guide button focuses Steam" — or close Steam while you play here.'
    })

  // old graphics drivers are the most common reason for crashes and glitches in PS3 / Xbox 360 / Switch-era emulators
  const limit = Date.now() - 548 * 24 * 3600_000 // about 18 months
  for (const g of gpuDrivers()) {
    if (!g.date || /basic display|remote|virtual|parsec|meta/i.test(g.name)) continue
    if (Date.parse(g.date) < limit)
      issues.push({
        severity: 'warning',
        title: 'Old graphics driver',
        detail: `${g.name}: driver from ${g.date}. Get the newest one from the NVIDIA, AMD or Intel website.`
      })
  }

  return issues
}
