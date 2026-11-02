// Dev helper: really launch the first game of a console through the hidden app (the emulator window is visible!).
// node scripts/real-launch.mjs <console> <seconds> [screenshot.png] [--resume] [--close <processName>] [--press F12]
// --close asks the emulator window to close normally (like clicking X), so it can save its resume state.
import { _electron as electron } from '@playwright/test'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const SOURCE = path.resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  if (i < 0) return undefined
  const v = argv[i + 1]
  argv.splice(i, v && !v.startsWith('--') ? 2 : 1)
  return v ?? true
}
const resume = flag('--resume') !== undefined
const closeName = flag('--close')
const press = flag('--press') // e.g. F12: sent to the emulator window halfway through
const [consoleId = 'ps2', secsArg = '25', shot] = argv
const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' })

const app = await electron.launch({
  executablePath: path.join(SOURCE, 'node_modules', 'electron', 'dist', 'electron.exe'),
  args: [SOURCE],
  cwd: SOURCE,
  env: { ...process.env, STARSTATION_HEADLESS: '1', ELECTRON_RENDERER_URL: '' }
})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForFunction(() => !!window.starstation)
await page.waitForTimeout(1500)
const st = await page.evaluate(() => window.starstation.getState())
const g = st.library.games.find((x) => x.console === consoleId)
console.log('GAME', g?.id, g?.title)
console.log('DETAILS', JSON.stringify(await page.evaluate((id) => window.starstation.gameDetails(id), g.id)))
const res = await page.evaluate(([id, mode]) => window.starstation.launch(id, mode), [g.id, resume ? 'resume' : 'fresh'])
console.log('LAUNCH', resume ? 'resume' : 'fresh', JSON.stringify(res))
await page.waitForTimeout((Number(secsArg) * 1000) / 2)
if (typeof press === 'string') {
  ps(`(New-Object -ComObject WScript.Shell).SendKeys('{${press}}')`)
  console.log('PRESSED', press)
}
await page.waitForTimeout((Number(secsArg) * 1000) / 2)
if (shot) {
  ps(
    `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $gr=[System.Drawing.Graphics]::FromImage($bmp); $gr.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${shot}')`
  )
  console.log('SHOT', shot)
}
if (typeof closeName === 'string') {
  ps(`Get-Process -Name '${closeName}' -ErrorAction SilentlyContinue | ForEach-Object { [void]$_.CloseMainWindow() }`)
  const t0 = Date.now()
  while (Date.now() - t0 < 30_000) {
    const running = await page.evaluate(() => window.starstation.getState().then((s) => s.running))
    if (!running) break
    await page.waitForTimeout(500)
  }
  console.log('CLOSED after', Math.round((Date.now() - t0) / 1000), 's')
  await page.waitForTimeout(1000)
  console.log('DETAILS', JSON.stringify(await page.evaluate((id) => window.starstation.gameDetails(id), g.id)))
}
console.log('RUNNING', JSON.stringify((await page.evaluate(() => window.starstation.getState())).running))
await app.close()
