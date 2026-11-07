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
  },
  {
    // extract-xiso (XboxDev, BSD-style license) to turn full Xbox disc images into XISO for xemu (SPEC-v2 A)
    // https://github.com/XboxDev/extract-xiso/releases — sha256 = the digest GitHub lists for the asset
    name: 'extract-xiso-Win64_Release.zip',
    url: 'https://github.com/XboxDev/extract-xiso/releases/download/build-202609111233/extract-xiso-Win64_Release.zip',
    sha256: 'fc891dfa72f08e3838a2f8b7ec34a8e4d61678da1cc8fee879677f00bf114ce3',
    local: [],
    unzip: { 'artifacts/extract-xiso.exe': 'extract-xiso.exe', 'artifacts/LICENSE.TXT': 'extract-xiso-LICENSE.txt' }
  },
  {
    // xdelta3 3.2.2 (Apache-2.0) to apply .xdelta / .vcdiff patch mods (SPEC-v2 E) — https://github.com/jmacd/xdelta/releases
    name: 'xdelta3-3.2.2-windows-x86_64.zip',
    url: 'https://github.com/jmacd/xdelta/releases/download/v3.2.2/xdelta3-3.2.2-windows-x86_64.zip',
    sha256: 'd48f7651d86b78fdca397057b46601f89131f37219675df736db70af44ec3379',
    local: [path.resolve(import.meta.dirname, '..', 'tools', 'cache', 'xd', 'x.zip')],
    unzip: { 'xdelta3-3.2.2-windows-x86_64/xdelta3.exe': 'xdelta3.exe', 'xdelta3-3.2.2-windows-x86_64/README.md': 'xdelta3-README.md' }
  },
  {
    // chdman from MAME 0.289 (official release, GPL-2.0+) to compress PS1/PS2 games to CHD (SPEC-v2 D).
    // The release is a self-extracting 7z: only chdman.exe and the license are taken out of it.
    name: 'mame0289b_x64.exe',
    url: 'https://github.com/mamedev/mame/releases/download/mame0289/mame0289b_x64.exe',
    sha256: 'a1aa7912168c9d1b05e611906bc21b8b9be3935822aead36d12a1da363150b7d',
    local: [path.resolve(import.meta.dirname, '..', 'tools', 'cache', 'mame-dl', 'mame0289b_x64.exe')],
    unpack7z: { 'chdman.exe': 'chdman.exe', COPYING: 'chdman-MAME-COPYING.txt' }
  },
  {
    // DsHidMini v3.27.0 (Nefarius, BSD-3) — PS3 controller driver; a DualShock 3 can't work on Windows without one.
    // Installed only when a PS3 controller is plugged in and the user agrees (Hannes OK'd, 2026-11-07).
    // https://github.com/nefarius/DsHidMini/releases (setup-v3.27.0); also signature-checked below.
    name: 'Nefarius_DsHidMini_Drivers_x64_arm64_v3.27.0.msi',
    url: 'https://github.com/nefarius/DsHidMini/releases/download/setup-v3.27.0/Nefarius_DsHidMini_Drivers_x64_arm64_v3.27.0.msi',
    sha256: '8887abd79aad3ba45b22d2d2050ebeaeb6da9eab18ede11c5464149e393f6410',
    local: [path.resolve(import.meta.dirname, '..', 'tools', 'cache', 'dshidmini', 'dl', 'Nefarius_DsHidMini_Drivers_x64_arm64_v3.27.0.msi')],
    signer: 'Nefarius Software Solutions'
  },
  {
    // .NET 10.0.14 Desktop Runtime (Microsoft) — the DsHidMini setup stops without it; installed only if missing.
    // URL + SHA-512 from Microsoft's release metadata (builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json),
    // SHA-512 337dacab…57b10b69 matched; pinned here by its SHA-256.
    name: 'windowsdesktop-runtime-10.0.14-win-x64.exe',
    url: 'https://builds.dotnet.microsoft.com/dotnet/WindowsDesktop/10.0.14/windowsdesktop-runtime-10.0.14-win-x64.exe',
    sha256: '91c2795a7b1e2480caa83fce9514dc2e2d21e277d9a297311faba6040bad7330',
    local: [path.resolve(import.meta.dirname, '..', 'tools', 'cache', 'dshidmini', 'rt', 'windowsdesktop-runtime-10.0.14-win-x64.exe')],
    signer: 'Microsoft Corporation',
    timeout: 300_000
  }
]

/** Authenticode: valid and from the expected publisher (second check on top of the pinned hash). */
const signedBy = (file, who) => {
  const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const out = execFileSync(ps, ['-NoProfile', '-Command', `$s = Get-AuthenticodeSignature -LiteralPath '${file}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`], { encoding: 'utf8' }).trim()
  return out.startsWith('Valid|') && out.includes(who)
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

for (const f of files) {
  const dst = path.join(bin, f.name)
  const outs = f.unzip ?? f.unpack7z
  if (outs && Object.values(outs).every((n) => fs.existsSync(path.join(bin, n)))) {
    console.log(`${f.name}: unpacked files present`)
    continue
  }
  if (fs.existsSync(dst) && sha(fs.readFileSync(dst)) === f.sha256) {
    console.log(`${f.name}: present, verified`)
    continue
  }
  let buf = null
  try {
    const r = await fetch(f.url, { signal: AbortSignal.timeout(f.timeout ?? (f.name.startsWith("mame") ? 600_000 : 30_000)) })
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
  if (f.signer && !signedBy(dst, f.signer)) {
    fs.rmSync(dst)
    throw new Error(`${f.name}: not signed by ${f.signer}`)
  }
  if (f.unzip) {
    const tmp = fs.mkdtempSync(path.join(bin, '.unzip-'))
    execFileSync(path.join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe'), ['-xf', dst, '-C', tmp])
    for (const [from, to] of Object.entries(f.unzip)) fs.copyFileSync(path.join(tmp, from), path.join(bin, to))
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.rmSync(dst)
  }
  if (f.unpack7z) {
    // self-extracting 7z (MAME): the bundled 7-Zip reads it like a .7z
    const tmp = fs.mkdtempSync(path.join(bin, ".unpack-"))
    execFileSync(path.join(bin, "7zr.exe"), ["x", "-y", `-o${tmp}`, dst, ...Object.keys(f.unpack7z)], { stdio: "ignore" })
    for (const [from, to] of Object.entries(f.unpack7z)) fs.copyFileSync(path.join(tmp, from), path.join(bin, to))
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

// Microsoft Visual C++ 2015–2022 runtime (x64) for the installer (SPEC-v2 A: most emulators need it).
// The official link always gives the newest build, so it can't be pinned by hash: the file must carry a valid
// Microsoft Authenticode signature instead. Its version goes into build\vcredist.nsh (installed only if older/missing).
const vcDst = path.resolve(import.meta.dirname, '..', 'build', 'vc_redist.x64.exe')
const vcNsh = path.resolve(import.meta.dirname, '..', 'build', 'vcredist.nsh')
const signedByMicrosoft = (file) => {
  const ps = path.join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const out = execFileSync(ps, ['-NoProfile', '-Command', `$s = Get-AuthenticodeSignature -LiteralPath '${file}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`], { encoding: 'utf8' }).trim()
  return /^Valid\|.*O=Microsoft Corporation/.test(out)
}
const fileVersion = (file) => {
  const ps = path.join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return execFileSync(ps, ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${file}').VersionInfo.FileVersion`], { encoding: 'utf8' }).trim()
}
if (!fs.existsSync(vcDst) || Date.now() - fs.statSync(vcDst).mtimeMs > 30 * 24 * 3600_000) {
  try {
    const r = await fetch('https://aka.ms/vs/17/release/vc_redist.x64.exe', { signal: AbortSignal.timeout(120_000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    fs.writeFileSync(`${vcDst}.part`, Buffer.from(await r.arrayBuffer()))
    if (!signedByMicrosoft(`${vcDst}.part`)) throw new Error('not signed by Microsoft')
    fs.renameSync(`${vcDst}.part`, vcDst)
  } catch (e) {
    fs.rmSync(`${vcDst}.part`, { force: true })
    if (!fs.existsSync(vcDst)) throw new Error(`vc_redist.x64.exe: ${e.message}`)
    console.warn(`vc_redist.x64.exe: download failed (${e.message}), keeping the one from before`)
  }
}
if (!signedByMicrosoft(vcDst)) throw new Error('vc_redist.x64.exe: signature check failed')
const [vMaj, vMin, vBld] = fileVersion(vcDst).split('.').map(Number)
// electron-builder includes installer.nsh twice (installer + uninstaller): define once
fs.writeFileSync(vcNsh, `; written by scripts/fetch-bin.mjs: version of the bundled build/vc_redist.x64.exe\n!ifndef VCREDIST_MINOR\n!define VCREDIST_MAJOR ${vMaj}\n!define VCREDIST_MINOR ${vMin}\n!define VCREDIST_BLD ${vBld}\n!endif\n`)
console.log(`vc_redist.x64.exe: ${vMaj}.${vMin}.${vBld}, signed by Microsoft`)

// the elevated PS3-controller driver setup script (native/ds3-driver.ps1) goes next to the driver installers
fs.copyFileSync(path.resolve(import.meta.dirname, '..', 'native', 'ds3-driver.ps1'), path.join(bin, 'ds3-driver.ps1'))
console.log('ds3-driver.ps1: copied')

// ScreenScraper developer login (SPEC-v2: built into the installer so every PC gets manuals and clips).
// Taken from Hannes's Files\config\secrets.json at build time; never committed (resources/extra/*.json is ignored).
const extra = path.resolve(import.meta.dirname, '..', 'resources', 'extra')
fs.mkdirSync(extra, { recursive: true })
const ssOut = path.join(extra, 'screenscraper.json')
let ss = {}
try {
  ss = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', 'config', 'secrets.json'), 'utf8')).screenscraper ?? {}
} catch {
  /* no secrets on this PC */
}
if (ss.devid && ss.devpassword) {
  fs.writeFileSync(ssOut, JSON.stringify({ devid: ss.devid, devpassword: ss.devpassword }))
  console.log('screenscraper.json: developer login built in')
} else {
  fs.rmSync(ssOut, { force: true })
  console.log('screenscraper.json: no developer login yet (manuals and clips need one)')
}
