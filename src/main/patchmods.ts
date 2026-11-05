import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { binDir } from './paths'
import { emulatorDir, getEmulator } from './presets'
import { applyBps, applyIps, applyPpfToFile, patchKind, PatchError, type PatchKind } from './formats/patch'
import { cueTracks } from './compress'
import { logger } from './log'
import type { Game } from '../shared/types'

/**
 * Patch-file mods (SPEC-v2 E): .ips / .bps / .ppf / .xdelta. Starstation makes a patched copy of the game
 * (unpacking a temporary copy first if the game is a CHD / RVZ) and keeps it with the mod. Switching the mod
 * on makes that copy the one that starts; the game keeps its single entry in the menu.
 */

const log = logger('patchmods')

export { patchKind }

function run(exe: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(exe, args, { cwd, windowsHide: true, stdio: 'ignore' })
    p.once('error', () => resolve(-1))
    p.once('exit', (code) => resolve(code ?? -1))
  })
}

/** The game as plain files (a CHD / RVZ is unpacked into `work` first). Returns the main file (.cue / .iso / ROM). */
async function plainGame(g: Game, work: string): Promise<string> {
  const ext = path.extname(g.path).toLowerCase()
  if (ext === '.chd') {
    const chdman = path.join(binDir(), 'chdman.exe')
    // CD first; a DVD image (PS2) answers "not a CD" and is extracted as an ISO
    if ((await run(chdman, ['extractcd', '-i', g.path, '-o', path.join(work, 'game.cue'), '-sb'], work)) === 0) return path.join(work, 'game.cue')
    if ((await run(chdman, ['extractdvd', '-i', g.path, '-o', path.join(work, 'game.iso')], work)) === 0) return path.join(work, 'game.iso')
    throw new PatchError('the compressed game could not be unpacked')
  }
  if (ext === '.rvz') {
    const e = getEmulator('dolphin')
    const tool = e ? path.join(emulatorDir(e), 'DolphinTool.exe') : ''
    if (!tool || !fs.existsSync(tool)) throw new PatchError('Dolphin is needed to unpack this game')
    if ((await run(tool, ['convert', '-u', path.join(work, 'user'), '-i', g.path, '-o', path.join(work, 'game.iso'), '-f', 'iso'], work)) !== 0) throw new PatchError('the compressed game could not be unpacked')
    return path.join(work, 'game.iso')
  }
  if (ext === '.m3u') throw new PatchError('multi-disc games: add the patch to the disc it is for')
  return g.path
}

/**
 * Make the patched copy in `outDir`. Returns the file to start (a .cue for CD games: the patched data
 * track plus the other tracks as they are).
 */
export async function makePatchedCopy(g: Game, patchFile: string, outDir: string, work: string): Promise<string> {
  const kind = patchKind(patchFile) as PatchKind
  const main = await plainGame(g, work)
  const isCue = path.extname(main).toLowerCase() === '.cue'
  const tracks = isCue ? cueTracks(main) : [main]
  const data = tracks[0] // the data track (patches target the game's data)
  await fsp.mkdir(outDir, { recursive: true })
  const outData = path.join(outDir, path.basename(data))
  const patch = await fsp.readFile(patchFile)
  if (kind === 'ips' || kind === 'bps') {
    if (fs.statSync(data).size > 1024 ** 3) throw new PatchError('the game is too big for an IPS / BPS patch')
    const src = await fsp.readFile(data)
    await fsp.writeFile(outData, kind === 'ips' ? applyIps(src, patch) : applyBps(src, patch))
  } else if (kind === 'ppf') {
    await fsp.copyFile(data, outData)
    applyPpfToFile(outData, patch)
  } else {
    // xdelta checks the source itself (a patch for another version stops with an error)
    const code = await run(path.join(binDir(), 'xdelta3.exe'), ['-d', '-f', '-s', data, patchFile, outData], work)
    if (code !== 0 || !fs.existsSync(outData)) throw new PatchError('this patch is for a different version of the game')
  }
  if (!isCue) return outData
  // the cue sheet: the patched data track here, the other tracks as they are (copied along if they were unpacked)
  let text = await fsp.readFile(main, 'latin1')
  for (const [i, t] of tracks.entries()) {
    let target = i === 0 ? path.basename(outData) : t
    if (i > 0 && t.toLowerCase().startsWith(path.resolve(work).toLowerCase())) {
      await fsp.copyFile(t, path.join(outDir, path.basename(t)))
      target = path.basename(t)
    }
    text = text.replace(new RegExp(`FILE\\s+"?${path.basename(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?`, 'i'), `FILE "${target}"`)
  }
  const cue = path.join(outDir, `${path.basename(g.path, path.extname(g.path))} (patched).cue`)
  await fsp.writeFile(cue, text, 'latin1')
  log.info(`${g.id}: patched copy ${cue}`)
  return cue
}
