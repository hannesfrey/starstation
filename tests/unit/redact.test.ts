import { describe, expect, it } from 'vitest'
import { redact } from '../../src/main/redact'

/** #43: reports friends send never carry passwords, tokens or keys. */
describe('redact', () => {
  it('removes them in every shape', () => {
    const cases: [string, string][] = [
      ['cheevos_token = "abc123def"', 'cheevos_token = "[removed]"'],
      ['Token=abcdef123', 'Token=[removed]'],
      ['  "apiKey": "k-123456",', '  "apiKey": "[removed]",'],
      ['GET https://x/download?key=SECRETKEY&expires=1799999&user=5', 'GET https://x/download?key=[removed]&expires=[removed]&user=5'],
      ['Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def', 'Authorization: [removed] [removed]'],
      ['using ghp_1234567890abcdefghijABCDEFGHIJ123456 for upload', 'using [removed] for upload'],
      ['password: hunter2', 'password: [removed]']
    ]
    for (const [a, b] of cases) expect(redact(a), a).toBe(b)
  })

  it('leaves ordinary log lines alone', () => {
    const lines = [
      '2026-11-08T12:09:29.542Z INFO  [convert] RPCS3 --installpkg BCUS98296-01.02.pkg: code 0, changed BCUS98296',
      '2026-11-08T12:10:00.000Z WARN  [library] scan: 120 games (2 new) in 340 ms',
      'controllers: xinput (Xbox 360 Controller (XInput STANDARD GAMEPAD))'
    ]
    for (const l of lines) expect(redact(l)).toBe(l)
  })
})
