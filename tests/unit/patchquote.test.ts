import { expect, it } from 'vitest'
import { neededVersion } from '../../src/main/mods'

it('quotes the whole sentence naming the needed game version (Spec II readme)', () => {
  const readme = [
    '==1. Verify disc image==',
    '',
    'To get started, ensure you have an NTSC copy of Gran Turismo 4 Online Public Beta.',
    'Use a file hashing tool to verify that the MD5 hash is 3306538778dda2ded87ceaf52c944a98. Other versions (such as the DNAS Bypass build commonly used to play online) are considered pre-modded and will not patch correctly if used.',
    '',
    '==2. Extract Spec II .xdelta patch=='
  ].join('\r\n')
  expect(neededVersion(readme)).toBe(
    'To get started, ensure you have an NTSC copy of Gran Turismo 4 Online Public Beta. Use a file hashing tool to verify that the MD5 hash is 3306538778dda2ded87ceaf52c944a98.'
  )
})
