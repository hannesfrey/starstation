import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0' } }))
const { scrubSecrets } = await import('../../src/main/packages')

/** #07: packages go to friends — logins inside emulator settings stay home. */
describe('scrubSecrets', () => {
  it('empties login values the emulators keep', () => {
    const cases: [string, string][] = [
      ['cheevos_token = "abc123"', 'cheevos_token = ""'], // RetroArch
      ['cheevos_password = "hunter2"', 'cheevos_password = ""'],
      ['ApiToken = XYZ', 'ApiToken = '], // Dolphin RetroAchievements.ini
      ['Token=abcdef', 'Token='], // PCSX2 / DuckStation
      ['web_token=1234', 'web_token='], // Azahar
      ['  Password: secretpw', '  Password: '], // RPCS3 rpcn.yml
      ['  "apiKey": "k-123",', '  "apiKey": "",'] // json
    ]
    for (const [a, b] of cases) expect(scrubSecrets(a), a).toBe(b)
  })

  it('leaves everything else exactly as it was (line endings too)', () => {
    const text = '[Achievements]\r\nEnabled = true\r\nUsername = hannes\r\nToken = abc\r\n\r\n[Video]\r\nRenderer = Vulkan\r\nToken =\r\n'
    expect(scrubSecrets(text)).toBe('[Achievements]\r\nEnabled = true\r\nUsername = hannes\r\nToken = \r\n\r\n[Video]\r\nRenderer = Vulkan\r\nToken =\r\n')
    const plain = 'video_driver = "vulkan"\ninput_player1_a = "x"\n'
    expect(scrubSecrets(plain)).toBe(plain)
  })
})
