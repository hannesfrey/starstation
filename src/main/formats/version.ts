/** "dolphin-2609a-x64.7z" → 2609a, "rpcs3-v0.0.43-20551-ad468a13_win64_msvc.7z" → 0.0.43-20551 (ignores x64/.7z). */
export function versionFromAsset(asset: string): string | null {
  const s = asset.replace(/\.(7z|zip|tar\.\w+)$/i, '').replace(/x86_64|x64|win64|win32|arm64|x86/gi, '')
  return /(\d+\.\d+(?:\.\d+)?(?:-\d+)?)/.exec(s)?.[1] ?? /(?:^|[-_ ])(\d{4}[a-z]?)(?=$|[-_ ])/i.exec(s)?.[1] ?? null
}
