// Renders Starstation's own icon (no third-party art) to build/icon.ico + build/icon.png.
// Run hidden with Electron: node_modules/electron/dist/electron.exe scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${size}" height="${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1b2b5c"/><stop offset="100%" stop-color="#06091a"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity=".55"/><stop offset="100%" stop-color="#7fb0ff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="2" y="2" width="116" height="116" rx="26" fill="url(#bg)"/>
  <circle cx="60" cy="60" r="40" fill="url(#glow)"/>
  <ellipse cx="60" cy="60" rx="50" ry="15" fill="none" stroke="#dbe8ff" stroke-width="${size < 48 ? 4 : 2.4}" opacity=".7" transform="rotate(-18 60 60)"/>
  <path d="M60 16 L68.5 51.5 L104 60 L68.5 68.5 L60 104 L51.5 68.5 L16 60 L51.5 51.5 Z" fill="#ffffff"/>
  <circle cx="95" cy="38" r="${size < 48 ? 6 : 4}" fill="#ffffff" opacity=".9"/>
</svg>`

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const out = path.resolve(__dirname, '..', 'build')
  fs.mkdirSync(out, { recursive: true })
  const pngs = []
  const tmp = path.join(out, '.icon.html')
  const w = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } })
  for (const size of [256, 128, 64, 48, 32, 16, 512]) {
    w.setContentSize(size, size)
    fs.writeFileSync(tmp, `<html><body style="margin:0;background:transparent;overflow:hidden">${svg(size)}</body></html>`)
    await w.loadFile(tmp)
    await new Promise((r) => setTimeout(r, 150))
    const img = (await w.webContents.capturePage({ x: 0, y: 0, width: size, height: size })).resize({ width: size, height: size })
    const png = img.toPNG()
    if (size === 512) fs.writeFileSync(path.join(out, 'icon.png'), png)
    else pngs.push({ size, png })
  }
  w.destroy()
  fs.rmSync(tmp, { force: true })
  // ICO with PNG-compressed images
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  let offset = 6 + 16 * pngs.length
  const dirs = pngs.map(({ size, png }) => {
    const d = Buffer.alloc(16)
    d.writeUInt8(size >= 256 ? 0 : size, 0)
    d.writeUInt8(size >= 256 ? 0 : size, 1)
    d.writeUInt16LE(1, 4)
    d.writeUInt16LE(32, 6)
    d.writeUInt32LE(png.length, 8)
    d.writeUInt32LE(offset, 12)
    offset += png.length
    return d
  })
  fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([header, ...dirs, ...pngs.map((p) => p.png)]))
  console.log('icon written to', out)
  app.quit()
})
