// Downloads the helper binaries Starstation bundles (official sources only) into resources/bin.
// Each file is pinned by SHA-256. If the site can't be reached, a local copy with the same hash is used.
// Run: node scripts/fetch-bin.mjs   (done automatically before packaging)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const bin = path.resolve(import.meta.dirname, '..', 'resources', 'bin')
fs.mkdirSync(bin, { recursive: true })

const files = [
  {
    // 7-Zip 26.x standalone console for .7z archives — https://www.7-zip.org/download.html
    name: '7zr.exe',
    url: 'https://www.7-zip.org/a/7zr.exe',
    sha256: '256feca8e274e5da655e2a284fabafd9f554365eb164862089dacd4e8276d282',
    local: [path.join(os.homedir(), 'Desktop', 'Emulator', 'Tools', '7zip', '7zr.exe')]
  },
  {
    // croc v11.6.3 (MIT) for sending packages by code — https://github.com/schollz/croc/releases
    // the zip is pinned (sha256 from the release's checksums.txt); croc.exe + LICENSE are taken out of it
    name: 'croc_v11.6.3_Windows-64bit.zip',
    url: 'https://github.com/schollz/croc/releases/download/v11.6.3/croc_v11.6.3_Windows-64bit.zip',
    sha256: '47b6c51aa4b4ae0370296926a33a0818338448ada38eb76519ad067932c61330',
    local: [path.resolve(import.meta.dirname, '..', 'tools', 'cache', 'croc-dl', 'croc.zip')],
    unzip: { 'croc.exe': 'croc.exe', LICENSE: 'croc-LICENSE.txt' }
  }
]

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

for (const f of files) {
  const dst = path.join(bin, f.name)
  if (f.unzip && Object.values(f.unzip).every((n) => fs.existsSync(path.join(bin, n)))) {
    console.log(`${f.name}: unpacked files present`)
    continue
  }
  if (fs.existsSync(dst) && sha(fs.readFileSync(dst)) === f.sha256) {
    console.log(`${f.name}: present, verified`)
    continue
  }
  let buf = null
  try {
    const r = await fetch(f.url, { signal: AbortSignal.timeout(30_000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    buf = Buffer.from(await r.arrayBuffer())
  } catch (e) {
    console.warn(`${f.name}: download failed (${e.cause?.code ?? e.message}), trying verified local copies`)
    for (const l of f.local) if (fs.existsSync(l) && sha(fs.readFileSync(l)) === f.sha256) buf = fs.readFileSync(l)
  }
  if (!buf) throw new Error(`${f.name}: no download and no verified local copy`)
  if (sha(buf) !== f.sha256) throw new Error(`${f.name}: sha256 mismatch (${sha(buf)}) — the official file may have been updated; check and re-pin`)
  fs.writeFileSync(dst, buf)
  console.log(`${f.name}: ${buf.length} bytes, sha256 verified`)
  if (f.unzip) {
    const tmp = fs.mkdtempSync(path.join(bin, '.unzip-'))
    execFileSync(path.join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe'), ['-xf', dst, '-C', tmp])
    for (const [from, to] of Object.entries(f.unzip)) fs.copyFileSync(path.join(tmp, from), path.join(bin, to))
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.rmSync(dst)
  }
}

// Starstation's own helpers, compiled from native\*.cs with the C# compiler that ships with Windows
// (.NET Framework 4, C# 5) — no SDK to install. Rebuilt when the source is newer than the exe.
const csc = path.join(process.env.SystemRoot ?? 'C:\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
const nativeDir = path.resolve(import.meta.dirname, '..', 'native')
for (const src of fs.readdirSync(nativeDir).filter((n) => n.endsWith('.cs'))) {
  const exe = path.join(bin, src.replace(/\.cs$/, '.exe'))
  const from = path.join(nativeDir, src)
  if (fs.existsSync(exe) && fs.statSync(exe).mtimeMs >= fs.statSync(from).mtimeMs) {
    console.log(`${path.basename(exe)}: up to date`)
    continue
  }
  // Windows paths: csc reads "/..." as an option
  execFileSync(csc, ['-nologo', '-optimize+', '-platform:x64', '-target:exe', `-out:${exe}`, from], { stdio: 'inherit' })
  console.log(`${path.basename(exe)}: built`)
}
