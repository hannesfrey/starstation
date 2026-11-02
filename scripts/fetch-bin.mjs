// Downloads the helper binaries Starstation bundles (official sources only) into resources/bin.
// Each file is pinned by SHA-256. If the site can't be reached, a local copy with the same hash is used.
// Run: node scripts/fetch-bin.mjs   (done automatically before packaging)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const bin = path.resolve(import.meta.dirname, '..', 'resources', 'bin')
fs.mkdirSync(bin, { recursive: true })

const files = [
  {
    // 7-Zip 26.x standalone console for .7z archives — https://www.7-zip.org/download.html
    name: '7zr.exe',
    url: 'https://www.7-zip.org/a/7zr.exe',
    sha256: '256feca8e274e5da655e2a284fabafd9f554365eb164862089dacd4e8276d282',
    local: [path.join(os.homedir(), 'Desktop', 'Emulator', 'Tools', '7zip', '7zr.exe')]
  }
]

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

for (const f of files) {
  const dst = path.join(bin, f.name)
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
}
