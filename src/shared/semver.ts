/** Small semver compare for Starstation's own versions ("2.0.0", "2.0.0-beta.3"). */

function parse(v: string): { nums: number[]; pre: (string | number)[] } {
  const [main, ...rest] = v.trim().replace(/^v/i, '').split('-')
  const nums = main.split('.').map((n) => Number(n) || 0)
  while (nums.length < 3) nums.push(0)
  const pre = rest.length ? rest.join('-').split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : []
  return { nums, pre }
}

/** < 0 if a is older than b, 0 if equal, > 0 if newer. A beta is older than its final version. */
export function compareVersions(a: string, b: string): number {
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i]
  if (!x.pre.length || !y.pre.length) return (x.pre.length ? -1 : 0) - (y.pre.length ? -1 : 0)
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    if (typeof p === 'number' && typeof q === 'number') return p - q
    if (typeof p === 'number') return -1
    if (typeof q === 'number') return 1
    return p < q ? -1 : 1
  }
  return 0
}

export function isPrerelease(v: string): boolean {
  return parse(v).pre.length > 0
}

/** "2.0.0-beta.3" → "2.0.0 beta 3" for the menu. */
export function displayVersion(v: string): string {
  return v.replace(/^v/i, '').replace(/-beta\.(\d+)$/i, ' beta $1').replace(/-alpha\.(\d+)$/i, ' alpha $1')
}
