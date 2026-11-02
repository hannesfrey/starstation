import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import type { BrowserWindow } from 'electron'
import { getConsole, getEmulator, emulatorDir, emulatorExe, fill } from './presets'
import { gameVars, keepPreviousResume, resumeLaunch } from './gamedata'
import { applyGameOptions, optionVars } from './gameoptions'
import { applyModSettings, modVars } from './mods'
import { raVars } from './retroach'
import { applyStep } from './emuconfig'
import { applyConsoleConfig } from './emuconfig'
import { biosStatus } from './bios'
import { getGame, updateStats, view } from './library/library'
import { send, notify } from './notify'
import { logger } from './log'
import { dir } from './paths'
import type { LaunchResult, RunningGame } from '../shared/types'

const log = logger('launcher')
let running: (RunningGame & { proc: ChildProcess }) | null = null
let mainWindow: BrowserWindow | null = null
/** Hooks run before launch (save backup) and after exit (quick resume bookkeeping). */
const beforeHooks: ((gameId: string) => Promise<void> | void)[] = []
const afterHooks: ((gameId: string, seconds: number, code: number | null, startedAt: number) => Promise<void> | void)[] = []

export function setLauncherWindow(w: BrowserWindow): void {
  mainWindow = w
}
export function onBeforeLaunch(fn: (gameId: string) => Promise<void> | void): void {
  beforeHooks.push(fn)
}
export function onAfterExit(fn: (gameId: string, seconds: number, code: number | null, startedAt: number) => Promise<void> | void): void {
  afterHooks.push(fn)
}

export function runningGame(): RunningGame | null {
  return running ? { gameId: running.gameId, title: running.title, startedAt: running.startedAt } : null
}

/** Build the emulator command line for a game (exported for tests). */
export function buildCommand(gameId: string, extraArgs: string[] = [], resumeArgs: string[] = [], resumeAt = 0): { exe: string; args: string[]; cwd: string } | LaunchResult {
  const game = getGame(gameId)
  if (!game) return { ok: false, error: 'This game is no longer in the library.', fix: { label: 'Rescan library', command: 'rescan' } }
  const c = getConsole(game.console)
  if (!c) return { ok: false, error: `No preset for console "${game.console}".` }
  const e = getEmulator(c.emulator)
  if (!e) return { ok: false, error: `No emulator preset "${c.emulator}" for ${c.name}.` }
  const exe = emulatorExe(e)
  if (!fs.existsSync(exe))
    return {
      ok: false,
      error: `${e.name} is not installed, so ${c.short} games can't start.`,
      fix: { label: `Install ${e.name}`, command: 'install-emulator', arg: e.id }
    }
  const bios = biosStatus(c)
  if (!bios.ok)
    return {
      ok: false,
      error: bios.fix
        ? `${c.short} needs: ${bios.missing.join(', ')}.`
        : `${c.short} BIOS missing: ${bios.missing.join(', ')}. Put the BIOS file in the ${c.short} BIOS folder.`,
      fix: bios.fix ?? { label: 'Open BIOS folder', command: 'open-folder', arg: `bios:${c.id}` }
    }
  if (!fs.existsSync(game.launchPath))
    return { ok: false, error: 'The game file was moved or deleted.', fix: { label: 'Rescan library', command: 'rescan' } }
  const v = gameVars(game)
  const base = c.launch.args.map((a) => fill(a, v))
  base.splice(resumeAt, 0, ...resumeArgs)
  const args = [...base, ...extraArgs].filter((a) => a !== '')
  return { exe, args, cwd: c.launch.cwd ? fill(c.launch.cwd, v) : emulatorDir(e) }
}

export type LaunchMode = 'fresh' | 'resume'

export async function launch(
  gameId: string,
  mode: LaunchMode = 'fresh',
  extraArgs: string[] = [],
  extra: { args?: string[]; vars?: Record<string, string> } = {}
): Promise<LaunchResult> {
  if (running) return { ok: false, error: `${running.title} is still running.` }
  const game = getGame(gameId)
  const c = game ? getConsole(game.console) : undefined
  const rl = game ? resumeLaunch(game, mode) : { args: [], at: 0, vars: {} }
  // per-game options (graphics level, CRT filter, patches) first fill placeholders, then add their own steps/args
  const ov = game && c ? { ...optionVars(c, game), ...modVars(c, game), ...raVars(), ...(extra.vars ?? {}) } : {}
  if (c) applyConsoleConfig(c, { ...rl.vars, ...ov })
  const optionArgs = game && c ? applyGameOptions(c, game, { ...rl.vars, ...ov }) : []
  if (game && c) applyModSettings(c, game, { ...rl.vars, ...ov })
  // RetroAchievements: give the emulator Starstation's login, or leave its own settings alone
  if (game && c?.achievements) {
    const steps = ov.ratoken ? c.achievements.on : (c.achievements.off ?? [])
    for (const s of steps) {
      try {
        applyStep(s, gameVars(game, { ...rl.vars, ...ov }))
      } catch (e) {
        log.warn('achievements step failed', e)
      }
    }
  }
  optionArgs.push(...(extra.args ?? []))
  const at = rl.args.length ? rl.at : (c?.launch.insertAt ?? 0)
  const cmd = buildCommand(gameId, extraArgs, [...optionArgs, ...rl.args], at)
  if ('ok' in cmd) {
    log.warn(`launch refused for ${gameId}: ${cmd.error}`)
    return cmd
  }
  // Start fresh: the emulator overwrites the resume state when it closes, so keep the old one
  if (mode === 'fresh' && game) await keepPreviousResume(game).catch((e) => log.warn('could not keep the resume state', e))
  for (const h of beforeHooks) {
    try {
      await h(gameId)
    } catch (e) {
      log.warn('before-launch hook failed', e)
    }
  }
  log.info(`launch ${gameId} (${mode}): "${cmd.exe}" ${cmd.args.map((a) => JSON.stringify(a)).join(' ')}`)
  let proc: ChildProcess
  try {
    proc = spawn(cmd.exe, cmd.args, {
      cwd: cmd.cwd,
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
      env: { ...process.env, TEMP: dir('config', 'electron', 'temp'), TMP: dir('config', 'electron', 'temp') }
    })
  } catch (e) {
    return { ok: false, error: `Could not start the emulator: ${(e as Error).message}` }
  }
  const startedAt = Date.now()
  running = { gameId, title: game!.title, startedAt, proc }
  send('running', runningGame())

  return await new Promise<LaunchResult>((resolve) => {
    let settled = false
    proc.once('error', (err) => {
      log.error(`emulator error for ${gameId}`, err)
      running = null
      send('running', null)
      if (!settled) {
        settled = true
        resolve({ ok: false, error: `The emulator could not start: ${err.message}` })
      }
    })
    proc.once('spawn', () => {
      if (!settled) {
        settled = true
        resolve({ ok: true })
      }
    })
    proc.once('exit', (code) => {
      const seconds = Math.round((Date.now() - startedAt) / 1000)
      log.info(`exit ${gameId} code=${code} after ${seconds}s`)
      running = null
      updateStats(gameId, (s) => ({
        ...s,
        playTime: s.playTime + seconds,
        playCount: s.playCount + 1,
        lastPlayed: Date.now()
      }))
      send('running', null)
      send('library', view())
      if (seconds < 4 && code !== 0) {
        notify({
          kind: 'error',
          title: `${game!.title} closed right away`,
          detail: `The emulator stopped with code ${code}. The log has details.`,
          action: { label: 'Open logs', command: 'open-folder', arg: 'logs' }
        })
      }
      for (const h of afterHooks) Promise.resolve(h(gameId, seconds, code, startedAt)).catch((e) => log.warn('after-exit hook failed', e))
      bringToFront()
    })
  })
}

export function bringToFront(): void {
  const w = mainWindow
  if (!w || w.isDestroyed() || process.env.STARSTATION_HEADLESS === '1') return
  if (w.isMinimized()) w.restore()
  w.show()
  // Windows only lets the foreground app steal focus; briefly going always-on-top gets us back in front.
  w.setAlwaysOnTop(true)
  w.focus()
  setTimeout(() => !w.isDestroyed() && w.setAlwaysOnTop(false), 300)
}

export function stopRunning(): void {
  running?.proc.kill()
}
