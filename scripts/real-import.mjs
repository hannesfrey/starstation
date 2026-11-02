// Dev helper: run Hannes's real import (Desktop/Emulator) through the hidden app. Dry run without --run.
import { _electron as electron } from '@playwright/test'
import path from 'node:path'
const SOURCE = path.resolve(import.meta.dirname, '..')
const run = process.argv.includes('--run')
const app = await electron.launch({
  executablePath: path.join(SOURCE, 'node_modules', 'electron', 'dist', 'electron.exe'),
  args: [SOURCE], cwd: SOURCE,
  env: { ...process.env, STARSTATION_HEADLESS: '1', STARSTATION_IMPORT_SOURCE: 'C:/Users/Hannes/Desktop/Emulator', ELECTRON_RENDERER_URL: '' }
})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForFunction(() => !!window.starstation)
const sources = await page.evaluate(() => window.starstation.importScan())
console.log(JSON.stringify(sources, null, 2))
if (run && sources.length) {
  page.on('console', (m) => console.log('[r]', m.text()))
  const res = await page.evaluate(() => window.starstation.importRun(0))
  console.log('RESULT', JSON.stringify(res, null, 2))
  const st = await page.evaluate(() => window.starstation.getState())
  console.log('CONSOLES', JSON.stringify(st.consoles.map(c => c.statusText)))
  console.log('GAMES', JSON.stringify(st.library.games?.map?.(g => [g.console, g.title, g.serial]) ?? Object.keys(st.library)))
}
await app.close()
