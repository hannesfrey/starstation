import { describe, expect, it, vi } from 'vitest'

let saved: unknown = { api: 'xinput', pads: [] }
vi.mock('../../src/main/paths', () => ({ dir: (...p: string[]) => p.join('/') }))
vi.mock('../../src/main/store', () => ({ readObject: () => saved, writeJson: () => undefined }))
vi.mock('../../src/main/log', () => ({ logger: () => ({ info: () => undefined, warn: () => undefined, error: () => undefined }) }))

const XBOX = 'Xbox 360 Controller (XInput STANDARD GAMEPAD)'
const PS5 = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'

describe('players for the emulators when no order was chosen', () => {
  it('two Xbox-style pads (Hannes’s two PS3 pads): XInput-0 and XInput-1', async () => {
    saved = { api: 'xinput', pads: [XBOX, XBOX] }
    const { padVars } = await import('../../src/main/controllers')
    const v = padVars()
    expect([v.pad, v.pad2, v.players]).toEqual(['XInput-0', 'XInput-1', '2'])
  })

  it('an Xbox-style pad and a PS5 pad: each keeps its own kind (player 2 was XInput-1 before)', async () => {
    saved = { api: 'xinput', pads: [XBOX, PS5] }
    const { padVars } = await import('../../src/main/controllers')
    const v = padVars()
    expect([v.pad, v.pad2]).toEqual(['XInput-0', 'SDL-0'])
    expect(v.ps3handler1).toBe('XInput')
    expect(v.ps3handler2).toBe('DualSense')
    expect(v.dolpad2).toBe('SDL/0/PS5 Controller')
  })

  it('a chosen order still wins', async () => {
    saved = { api: 'xinput', pads: [XBOX, PS5] }
    const { padVars } = await import('../../src/main/controllers')
    const v = padVars([{ api: 'sdl', index: 0, id: PS5 }, { api: 'xinput', index: 0 }])
    expect([v.pad, v.pad2]).toEqual(['SDL-0', 'XInput-0'])
  })
})
