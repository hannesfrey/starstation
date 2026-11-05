import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { launchApp, makeFiles, SOURCE, writeSettings } from './helpers'

const ELECTRON = createRequire(__filename)('electron') as unknown as string
const sessionFile = (files: string) => path.join(files, 'config', 'updates', 'session.json')
const readSession = (files: string) => JSON.parse(fs.readFileSync(sessionFile(files), 'utf8'))

/** Start Starstation a second time on the same Files folder; resolves with its exit code. */
function secondStart(files: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const p = spawn(ELECTRON, [SOURCE], {
      cwd: SOURCE,
      env: { ...process.env, STARSTATION_FILES: files, STARSTATION_HEADLESS: '1', ELECTRON_RENDERER_URL: '' },
      stdio: 'ignore'
    })
    const t = setTimeout(() => {
      p.kill()
      reject(new Error('second start did not end'))
    }, 20_000)
    p.once('exit', (code) => {
      clearTimeout(t)
      resolve(code)
    })
  })
}

test('a second start hands over and ends without touching anything; closing the menu window ends Starstation', async () => {
  test.setTimeout(90_000)
  const files = makeFiles('quit')
  writeSettings(files, { bootAnimation: false })
  const { app, page } = await launchApp(files)
  await page.waitForFunction(() => !!(window as unknown as { starstation?: unknown }).starstation)
  // the PS button menu window is there too (hidden)
  await expect.poll(() => app.windows().length).toBe(2)
  const before = readSession(files)
  expect(before.last.clean).toBe(false)

  // 2.0.0 bug: the second copy marked the open one as crashed (and could start a rescue)
  expect(await secondStart(files)).toBe(0)
  expect(readSession(files)).toEqual(before)

  // 2.0.0 bug: closing the menu left Starstation running unseen (the PS button menu window kept it alive)
  const proc = app.process()
  const exited = new Promise<void>((r) => proc.once('exit', () => r()))
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => !w.webContents.getURL().includes('#overlay'))!
      .close()
  })
  await Promise.race([exited, new Promise((_, rej) => setTimeout(() => rej(new Error('Starstation kept running')), 15_000))])
  expect(readSession(files).last.clean).toBe(true)
})
