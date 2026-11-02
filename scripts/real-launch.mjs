// Dev helper: really launch the first game of a console through the hidden app (emulator window is visible!).
// node scripts/real-launch.mjs <console> <seconds> [screenshot.png]
import { _electron as electron } from '@playwright/test'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
const SOURCE = path.resolve(import.meta.dirname, '..')
const consoleId = process.argv[2] ?? 'ps2'
const secs = Number(process.argv[3] ?? 25)
const shot = process.argv[4]
const app = await electron.launch({
  executablePath: path.join(SOURCE, 'node_modules', 'electron', 'dist', 'electron.exe'),
  args: [SOURCE], cwd: SOURCE,
  env: { ...process.env, STARSTATION_HEADLESS: '1', ELECTRON_RENDERER_URL: '' }
})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForFunction(() => !!window.starstation)
await page.waitForTimeout(1500)
const st = await page.evaluate(() => window.starstation.getState())
const g = st.library.games.find((x) => x.console === consoleId)
console.log('GAME', g?.id, g?.title)
const res = await page.evaluate((id) => window.starstation.launch(id), g.id)
console.log('LAUNCH', JSON.stringify(res))
await page.waitForTimeout(secs * 1000)
if (shot) {
  execFileSync('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $gr=[System.Drawing.Graphics]::FromImage($bmp); $gr.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${shot}')`])
  console.log('SHOT', shot)
}
console.log('RUNNING', JSON.stringify((await page.evaluate(() => window.starstation.getState())).running))
await app.close()
