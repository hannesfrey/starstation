import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

export const SOURCE = path.resolve(__dirname, '..', '..')
const ELECTRON = path.join(SOURCE, 'node_modules', 'electron', 'dist', 'electron.exe')
const NODE = path.join(SOURCE, 'tools', 'node', 'node.exe')

/** A fresh, throw-away Files\ folder for one test run. */
export function makeFiles(name: string): string {
  const d = path.join(SOURCE, 'tools', 'cache', 'e2e', `${name}-${Date.now()}`)
  fs.mkdirSync(path.join(d, 'config'), { recursive: true })
  return d
}

/**
 * Presets = the real ones + a "testcon" console whose emulator is a tiny Node script
 * that records its arguments and exits after `ms`.
 */
export function makePresets(files: string, ms = 1500): string {
  const dst = path.join(files, '_presets')
  fs.cpSync(path.join(SOURCE, 'presets'), dst, { recursive: true })
  const emuDir = path.join(files, '_fakeemu')
  fs.mkdirSync(emuDir, { recursive: true })
  fs.writeFileSync(
    path.join(emuDir, 'fake-emu.js'),
    `const fs=require('fs');fs.writeFileSync(${JSON.stringify(path.join(emuDir, 'launched.json'))},JSON.stringify(process.argv.slice(2)));setTimeout(()=>process.exit(0),${ms});`
  )
  fs.writeFileSync(
    path.join(dst, 'emulators', 'fakeemu.json'),
    JSON.stringify({ id: 'fakeemu', name: 'Fake Emu', folder: emuDir, exe: NODE, portable: [], importNames: [] })
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
      launch: { args: ['{emu}/fake-emu.js', '{launch}'] },
      extensions: ['.tst'],
      config: [],
      quickResume: false
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
      ELECTRON_RENDERER_URL: ''
    }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

export function writeSettings(files: string, s: Record<string, unknown>): void {
  fs.writeFileSync(path.join(files, 'config', 'settings.json'), JSON.stringify(s))
}
