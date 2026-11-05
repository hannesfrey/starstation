// Couch test (SPEC-v2 A): for each console, a real game through the real app, controller flow only:
// start → game has focus → PS button → menu on top → Resume → game has focus → PS → Save and quit →
// game closed, Starstation in front, resume state written (consoles with quick resume).
//
//   source ./env.sh && node scripts/couch-test.mjs [console …] [--secs 30]
//
// Windows appear on screen; Starstation and every game are muted (STARSTATION_MUTE_GAMES). A console where another
// program took the focus (someone using the PC) is tried again 10 minutes later, up to 3 times. It runs in its own
// Files folder (tools\cache\couch\Files) whose emulators / bios / games are links to the real ones, so saves
// and settings of the real Starstation are not touched (emulator configs point back at the real folders on
// the next normal start, as every start re-applies them). Results: tools\cache\couch\results.json + screenshots.
import { _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const SOURCE = path.resolve(import.meta.dirname, '..')
const REAL = path.resolve(SOURCE, '..')
const OUT = path.join(SOURCE, 'tools', 'cache', 'couch')
const FILES = path.join(OUT, 'Files')
const argv = process.argv.slice(2)
const secsAt = argv.indexOf('--secs')
const bootSecs = secsAt >= 0 ? Number(argv.splice(secsAt, 2)[1]) : 0
const only = argv.filter((a) => !a.startsWith('--'))
const BOOT = { ps3: 45, xbox360: 45, xbox: 35, wii: 30, gc: 30, ps2: 30, '3ds': 25 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' })

// ---- the test Files folder: links to the real emulators, BIOS and games ----
function setup() {
  teardown()
  fs.mkdirSync(path.join(FILES, 'config'), { recursive: true })
  for (const d of ['emulators', 'bios', 'games']) execFileSync('cmd', ['/c', 'mklink', '/J', path.join(FILES, d), path.join(REAL, d)], { stdio: 'ignore' })
  const s = JSON.parse(fs.readFileSync(path.join(REAL, 'config', 'settings.json'), 'utf8'))
  fs.writeFileSync(path.join(FILES, 'config', 'settings.json'), JSON.stringify({ ...s, bootAnimation: false, sortDownloads: false, sounds: false, music: false }))
  fs.writeFileSync(path.join(FILES, 'config', 'setup.json'), JSON.stringify({ done: true }))
  for (const f of ['controllers.json']) if (fs.existsSync(path.join(REAL, 'config', f))) fs.copyFileSync(path.join(REAL, 'config', f), path.join(FILES, 'config', f))
}
function teardown() {
  if (!fs.existsSync(FILES)) return
  // links first (rmdir removes the link, never what it points to), then the test's own files
  for (const d of ['emulators', 'bios', 'games']) if (fs.existsSync(path.join(FILES, d))) execFileSync('cmd', ['/c', 'rmdir', path.join(FILES, d)], { stdio: 'ignore' })
  for (const d of ['emulators', 'bios', 'games']) if (fs.existsSync(path.join(FILES, d))) throw new Error(`could not remove the link ${d}, stopping`)
  fs.rmSync(FILES, { recursive: true, force: true })
}

/** ms since anyone used the keyboard / mouse (the pad helper asks Windows). */
function idleMs() {
  const out = execFileSync(path.join(SOURCE, 'resources', 'bin', 'padhelper.exe'), [], { input: 'idle\nquit\n', encoding: 'utf8', timeout: 15_000 })
  return Number(/idle (\d+)/.exec(out)?.[1] ?? 0)
}
/** Windows only lets a window take the focus while nobody is using the PC — and the test shouldn't get in the way. */
async function waitIdle(min = 120_000) {
  let said = false
  while (idleMs() < min) {
    if (!said) console.log('waiting until the PC has not been used for 2 minutes…')
    said = true
    await sleep(15_000)
  }
}

function screenshot(file) {
  ps(
    `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${file}')`
  )
}

fs.mkdirSync(OUT, { recursive: true })
setup()
const app = await electron.launch({
  executablePath: path.join(SOURCE, 'node_modules', 'electron', 'dist', 'electron.exe'),
  args: [SOURCE],
  cwd: SOURCE,
  env: { ...process.env, STARSTATION_FILES: FILES, STARSTATION_COUCH_TEST: '1', STARSTATION_MUTE_GAMES: '1', ELECTRON_RENDERER_URL: '' }
})
const results = []
try {
  let page = await app.firstWindow()
  if (page.url().includes('#overlay')) page = app.windows().find((w) => !w.url().includes('#overlay'))
  await page.waitForFunction(() => !!window.starstation)
  await sleep(3000)
  const api = (fn, ...args) => page.evaluate(([f, a]) => window.starstation[f](...a), [fn, args])
  const st = await api('getState')
  const consoles = [...new Set(st.library.games.map((g) => g.console))].filter((c) => !only.length || only.includes(c))
  // up to 3 rounds: a console is tried again when another program had the focus (someone using the PC)
  for (const c of [...consoles, ...consoles, ...consoles]) {
    const tries = results.filter((x) => x.console === c)
    const last = tries[tries.length - 1]
    if (last && last.result !== 'disturbed') continue
    if (last) {
      console.log(`${c}: another program had the focus, trying again in 10 minutes`)
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.minimize()))
      await sleep(10 * 60_000)
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => !w.webContents.getURL().includes('#overlay') && w.restore()))
      await sleep(1500)
    }
    const g = st.library.games.find((x) => x.console === c)
    const r = { console: c, game: g.title, steps: {} }
    results.push(r)
    console.log(`\n== ${c}: ${g.title}`)
    const started = Date.now()
    const l = await api('launch', g.id, 'fresh')
    if (!l.ok) {
      r.result = `refused: ${l.error}`
      console.log(r.result)
      continue
    }
    await sleep((bootSecs || BOOT[c] || 25) * 1000)
    const fg = async () => {
      const v = (await api('testFg')) ?? {}
      // which program had the focus (for the log)
      try {
        v.name = ps(`(Get-Process -Id ${v.fg}).ProcessName`).trim()
      } catch {
        v.name = '?'
      }
      ;(r.focus ??= []).push(v.name)
      return v
    }
    let f = await fg()
    r.steps.gameHasFocus = f.fg === f.emulator
    await api('testHome')
    await sleep(1500)
    f = await fg()
    r.steps.menuOnTop = f.fg === f.starstation
    r.steps.menuShown = (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('#overlay') && w.isVisible())))
    screenshot(path.join(OUT, `${c}-menu.png`))
    await api('overlayAction', 'resume')
    await sleep(1500)
    f = await fg()
    r.steps.resumeGivesFocusBack = f.fg === f.emulator
    screenshot(path.join(OUT, `${c}-game.png`))
    await sleep(3000)
    await api('testHome')
    await sleep(1200)
    await api('overlayAction', 'save-quit')
    const t0 = Date.now()
    while (Date.now() - t0 < 30_000 && (await api('getState')).running) await sleep(500)
    r.steps.closed = !(await api('getState')).running
    r.closeSeconds = Math.round((Date.now() - t0) / 1000)
    await sleep(1500)
    f = await fg()
    r.steps.backToMenu = f.fg === f.starstation
    const c2 = st.consoles.find((x) => x.id === c)
    if (c2?.quickResume) {
      const d = await api('gameDetails', g.id)
      r.steps.resumeSaved = !!d?.resume && d.resume.savedAt >= started - 1000
    }
    // focus steps that failed because some other program (not the game, not Starstation) was in front: try again later
    const others = (r.focus ?? []).filter((n) => !/^(electron|starstation|pcsx2|duckstation|rpcs3|retroarch|dolphin|azahar|xemu|xenia)/i.test(n))
    r.result = Object.values(r.steps).every(Boolean) ? 'ok' : others.length ? 'disturbed' : 'problem'
    console.log(JSON.stringify(r))
    await sleep(2000)
  }
} finally {
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2))
  await app.close().catch(() => undefined)
  await sleep(1500)
  teardown()
}
// the last try per console counts
const last = Object.values(Object.fromEntries(results.map((r) => [r.console, r])))
console.log(`\n${last.filter((r) => r.result === 'ok').length} of ${last.length} consoles ok — ${path.join(OUT, 'results.json')}`)
