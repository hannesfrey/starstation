import fs from 'node:fs'
import crypto from 'node:crypto'

/**
 * Sony's PS3 game-update list (https://a0.ww.np.dl.playstation.net/tpl/np/<ID>/<ID>-ver.xml) and its packages.
 * The list names every update package in order; a game needs all those newer than what it has, one after another.
 */

export interface UpdatePkg {
  version: string
  size: number
  /** SHA-1 of the package without its last 32 bytes (that's where the package keeps the same value). */
  sha1: string
  url: string
}

const attr = (tag: string, name: string): string => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? ''

export function parseUpdateXml(xml: string): UpdatePkg[] {
  const out: UpdatePkg[] = []
  for (const m of xml.matchAll(/<package\s[^>]*>/g)) {
    const t = m[0]
    const p = { version: attr(t, 'version'), size: Number(attr(t, 'size')), sha1: attr(t, 'sha1sum').toLowerCase(), url: attr(t, 'url') }
    if (/^\d{2}\.\d{2}$/.test(p.version) && p.size > 0 && /^[0-9a-f]{40}$/.test(p.sha1) && /^https?:\/\//.test(p.url)) out.push(p)
  }
  return out.sort((a, b) => compareAppVer(a.version, b.version))
}

/** "01.09" vs "01.19". */
export function compareAppVer(a: string, b: string): number {
  const n = (v: string) => v.split('.').map((x) => Number(x) || 0)
  const [x, y] = [n(a), n(b)]
  return x[0] - y[0] || (x[1] ?? 0) - (y[1] ?? 0)
}

/** The updates a game on version `installed` still needs, oldest first. */
export function pendingUpdates(pkgs: UpdatePkg[], installed: string): UpdatePkg[] {
  return pkgs.filter((p) => compareAppVer(p.version, installed) > 0)
}

/** Only Sony's own update hosts (the list could otherwise send a download anywhere). */
export function isSonyPkgUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return (u.protocol === 'http:' || u.protocol === 'https:') && /(^|\.)np\.dl\.playstation\.net$/i.test(u.hostname) && /\.pkg$/i.test(u.pathname)
  } catch {
    return false
  }
}

/** Does the downloaded package match the list (size + SHA-1 of everything but the last 32 bytes)? */
export async function pkgMatches(file: string, p: Pick<UpdatePkg, 'size' | 'sha1'>): Promise<boolean> {
  let size: number
  try {
    size = fs.statSync(file).size
  } catch {
    return false
  }
  if (size !== p.size || size < 32) return false
  const hash = crypto.createHash('sha1')
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(file, { start: 0, end: size - 33 })
      .on('data', (c) => hash.update(c))
      .on('end', () => resolve())
      .on('error', reject)
  })
  return hash.digest('hex') === p.sha1
}
