import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

export const SOURCE = path.resolve(__dirname, '..', '..')
const ELECTRON = path.join(SOURCE, 'node_modules', 'electron', 'dist', 'electron.exe')
const NODE = path.join(SOURCE, 'tools', 'node', 'node.exe')

/** A fresh, throw-away Files\ folder for one test run. */
export function makeFiles(name: string, opts: { wizard?: boolean } = {}): string {
  const d = path.join(SOURCE, 'tools', 'cache', 'e2e', `${name}-${Date.now()}`)
  fs.mkdirSync(path.join(d, 'config'), { recursive: true })
  // the first-start wizard is tested on its own (wizard.spec.ts)
  if (opts.wizard !== true) fs.writeFileSync(path.join(d, 'config', 'setup.json'), JSON.stringify({ done: true }))
  return d
}

/**
 * Presets = the real ones + a "testcon" console whose emulator is a tiny Node script
 * that records its arguments and exits after `ms`.
 */
export function makePresets(files: string, ms = 1500, opts: { quickResume?: boolean; extra?: Record<string, unknown> } = {}): string {
  const dst = path.join(files, '_presets')
  fs.cpSync(path.join(SOURCE, 'presets'), dst, { recursive: true })
  const emuDir = path.join(files, '_fakeemu')
  fs.mkdirSync(emuDir, { recursive: true })
  // Like a real emulator: records its arguments, and on close writes the game's save + a resume state
  // into Files\saves\testcon (next to games\testcon).
  fs.writeFileSync(
    path.join(emuDir, 'fake-emu.js'),
    `const fs=require('fs'),path=require('path');const args=process.argv.slice(2);` +
      `fs.writeFileSync(${JSON.stringify(path.join(emuDir, 'launched.json'))},JSON.stringify(args));` +
      `const game=args[args.length-1];const base=path.basename(game,path.extname(game));` +
      // its own log, like RPCS3: a game called "Crash…" ends with a fatal error line
      `fs.writeFileSync(path.join(__dirname,'emu.log'),'·! 0:00:00.1 booting '+base+'\\n·E 0:00:00.2 CFG: bad value for Fullscreen\\n'+(base.startsWith('Crash')?'·F 0:00:01.2 {PPU[0x1000000] main_thread} VM: Access violation\\n':''));` +
      `const saves=path.join(path.dirname(game),'..','..','saves','testcon');` +
      `setTimeout(()=>{fs.mkdirSync(path.join(saves,'states'),{recursive:true});` +
      `fs.writeFileSync(path.join(saves,base+'.sav'),'played '+Date.now());` +
      `fs.writeFileSync(path.join(saves,'states',base+'.state'),'state');process.exit(0)},${ms});`
  )
  fs.writeFileSync(
    path.join(dst, 'emulators', 'fakeemu.json'),
    JSON.stringify({ id: 'fakeemu', name: 'Fake Emu', folder: emuDir, exe: NODE, portable: [], importNames: [], log: { file: '{emu}/emu.log', fatal: String.raw`^·F \S+ (.*)$`, config: String.raw`^·E \S+ CFG: (.*)$` } })
  )
  fs.writeFileSync(
    path.join(dst, 'consoles', 'testcon.json'),
    JSON.stringify({
      id: 'testcon',
      name: 'Test Console',
      short: 'TEST',
      order: 5,
      icon: 'cartridge',
      emulator: 'fakeemu',
      // node needs the script first, so extra arguments go after it
      launch: { args: ['{emu}/fake-emu.js', '{launch}'], insertAt: 1 },
      extensions: ['.tst'],
      config: [],
      backup: [{ path: '{saves}/{basename}.sav' }],
      resume: { state: '{saves}/states/{basename}.state', args: ['--resume', '{state}'] },
      quickResume: !!opts.quickResume,
      ...(opts.extra ?? {})
    })
  )
  return dst
}

export async function launchApp(files: string, presets?: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: [SOURCE],
    cwd: SOURCE,
    env: {
      ...process.env,
      STARSTATION_FILES: files,
      STARSTATION_HEADLESS: '1',
      ...(presets ? { STARSTATION_PRESETS: presets } : {}),
      // the fake emulator has no window to close: it is ended after this instead of 20 s
      ...(presets ? { STARSTATION_CLOSE_TIMEOUT: process.env.STARSTATION_CLOSE_TIMEOUT ?? '2500' } : {}),
      // fake installers in tests are a few bytes (a real one is well over 50 MB)
      STARSTATION_TEST_MIN_INSTALLER: '10',
      ELECTRON_RENDERER_URL: ''
    }
  })
  let page = await app.firstWindow()
  // the PS button menu has its own window (#overlay); tests drive the main menu
  if (page.url().includes('#overlay')) page = app.windows().find((w) => !w.url().includes('#overlay')) ?? (await app.waitForEvent('window'))
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

export function writeSettings(files: string, s: Record<string, unknown>): void {
  fs.writeFileSync(path.join(files, 'config', 'settings.json'), JSON.stringify(s))
}
