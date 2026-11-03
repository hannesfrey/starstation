import { describe, expect, it } from 'vitest'
import { versionFromAsset } from '../../src/main/formats/version'

describe('versionFromAsset', () => {
  it('reads versions from real download names', () => {
    expect(versionFromAsset('dolphin-2609a-x64.7z')).toBe('2609a')
    expect(versionFromAsset('pcsx2-v2.8.2-windows-x64-Qt.7z')).toBe('2.8.2')
    expect(versionFromAsset('rpcs3-v0.0.43-20551-ad468a13_win64_msvc.7z')).toBe('0.0.43-20551')
    expect(versionFromAsset('azahar-windows-msvc-2126.2.zip')).toBe('2126.2')
    expect(versionFromAsset('xemu-0.8.139-windows-x86_64.zip')).toBe('0.8.139')
    expect(versionFromAsset('melonDS-1.1-windows-x86_64.zip')).toBe('1.1')
    expect(versionFromAsset('duckstation-windows-x64-release.zip')).toBeNull()
    expect(versionFromAsset('RetroArch.7z')).toBeNull()
  })
})
