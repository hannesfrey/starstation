import { describe, expect, it } from 'vitest'
import { guessGame, serialsIn } from '../../src/main/formats/modguess'

const ps2 = [
  { id: 'ps2:ac5', title: 'Ace Combat 5 - The Unsung War', serial: 'SLUS-20851' },
  { id: 'ps2:gt4', title: 'Gran Turismo 4', serial: 'SCUS-97328' },
  { id: 'ps2:kh', title: 'Kingdom Hearts', serial: 'SLUS-20370' },
  { id: 'ps2:mc3', title: 'Midnight Club 3 - DUB Edition Remix', serial: 'SLES-53831' },
  { id: 'ps2:nfsu2', title: 'Need for Speed - Underground 2', serial: 'SLUS-21065' }
]

describe('which game is a mod for', () => {
  it('reads game codes in any common spelling', () => {
    expect([...serialsIn('SCUS-97328 / SLES_538.31 / BLUS30443')]).toEqual(['SCUS97328', 'SLES53831', 'BLUS30443'])
  })
  it('a game code in the readme decides (HD HUD readme lists every GT4 release)', () => {
    const readme = 'Gran Turismo 4 NTSC-U USA/Canada release = SCUS-97328\nPAL UK/Europe release = SCES-51719\nOnline Public Beta = SCUS-97436'
    expect(guessGame('Some texture pack', readme, ps2).sure).toBe('ps2:gt4')
  })
  it('the whole title in the mod name', () => {
    expect(guessGame('Gran Turismo 4 HD HUD & UI v1.1.1 Texture pack by Silentwarior112', '', ps2).sure).toBe('ps2:gt4')
    expect(guessGame('Need for Speed Underground 2 widescreen', '', ps2).sure).toBe('ps2:nfsu2')
  })
  it('no game in the name or readme: asks (Retexture Mod 3.0)', () => {
    const g = guessGame('Retexture Mod 3.0', 'read this.txt\noptional CF hood for white', ps2)
    expect(g.sure).toBeUndefined()
    expect(g.ranked).toHaveLength(ps2.length)
  })
  it('the longer title wins when both fit', () => {
    const games = [...ps2, { id: 'ps2:gt4p', title: 'Gran Turismo 4 Prologue', serial: 'SCES-52438' }]
    expect(guessGame('Gran Turismo 4 Prologue HD textures', '', games).sure).toBe('ps2:gt4p')
    expect(guessGame('Gran Turismo 4 HD textures', '', games).sure).toBe('ps2:gt4')
  })
  it('a game code of a game that isn’t in the library does not count', () => {
    expect(guessGame('Mod', 'For SLUS-99999 only', ps2).sure).toBeUndefined()
  })
})
