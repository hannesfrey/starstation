import { compareVersions } from '../../shared/semver'

export interface Release {
  tag_name: string
  prerelease: boolean
  draft: boolean
}

/**
 * Which Starstation release to update to: the newest one this PC may have (tester: pre-releases too),
 * newer than the running version and newer than a version skipped after going back. null = stay.
 */
export function pickRelease(list: Release[], current: string, tester: boolean, skip?: string): string | null {
  const ok = list
    .filter((r) => !r.draft && (tester || !r.prerelease))
    .map((r) => r.tag_name.replace(/^v/i, ''))
    .filter((v) => /^\d+\.\d+\.\d+/.test(v))
    .sort((a, b) => compareVersions(b, a))
  const best = ok[0]
  if (!best || compareVersions(best, current) <= 0) return null
  if (skip && compareVersions(best, skip) <= 0) return null
  return best
}
