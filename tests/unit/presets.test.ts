import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Preset check: a {placeholder} nobody fills is written into the emulator's settings as it is, and the
 * setting silently does nothing (v1: {n64res} / {n64hires} were never applied). Every placeholder a preset
 * uses must be one Starstation fills: always (vars), per game (launcher), or from a game option / mod
 * setting / RetroAchievements login the preset itself declares.
 */

const SOURCE = path.resolve(__dirname, '..', '..')
process.env.STARSTATION_FILES = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'presets-test-'))
process.env.STARSTATION_PRESETS = path.join(SOURCE, 'presets')
const { loadPresets, allConsoles, allEmulators, getEmulator, vars } = await import('../../src/main/presets')

/** Filled per game at launch: gameVars() and resumeLaunch() in gamedata.ts. */
const PER_GAME = ['launch', 'game', 'gamedir', 'basename', 'serial', 'titleid', 'romname', 'state']
/** Only while logged in to RetroAchievements (raVars): allowed in achievements.on only. */
const RA = ['rauser', 'ratoken']
const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9]*)(:\/)?\}/g

/** Every string in a preset with where it is, and every `vars` object's keys (those are filled at launch). */
function walk(node: unknown, at: string, strings: { at: string; s: string }[], provided: Set<string>): void {
  if (typeof node === 'string') strings.push({ at, s: node })
  else if (Array.isArray(node)) node.forEach((x, i) => walk(x, `${at}[${i}]`, strings, provided))
  else if (node && typeof node === 'object')
    for (const [k, v] of Object.entries(node)) {
      if (k === 'vars' && v && typeof v === 'object' && !Array.isArray(v)) for (const key of Object.keys(v)) provided.add(key)
      walk(v, `${at}.${k}`, strings, provided)
    }
}

describe('presets', () => {
  loadPresets()

  it('every console has an emulator preset', () => {
    expect(allConsoles().length).toBeGreaterThanOrEqual(11)
    for (const c of allConsoles()) expect(getEmulator(c.emulator), `${c.id} → ${c.emulator}`).toBeTruthy()
  })

  it('every placeholder is one Starstation fills', () => {
    const problems: string[] = []
    for (const c of allConsoles()) {
      const e = getEmulator(c.emulator)!
      const strings: { at: string; s: string }[] = []
      const provided = new Set<string>([...Object.keys(vars(c)), ...PER_GAME])
      walk(c, c.id, strings, provided)
      walk(e, `${c.id}:${e.id}`, strings, provided)
      for (const { at, s } of strings)
        for (const [, key] of s.matchAll(PLACEHOLDER)) {
          if (RA.includes(key)) {
            if (!at.includes('.achievements.on')) problems.push(`${at}: {${key}} is only known while logged in (achievements.on)`)
            continue
          }
          if (!provided.has(key)) problems.push(`${at}: {${key}} is never filled`)
        }
    }
    expect(problems).toEqual([])
  })

  it('config steps are of known types', () => {
    const known = ['touch', 'mkdir', 'mii-db', 'link', 'write', 'ini', 'yaml-players', 'strip-lines', 'kv']
    const bad: string[] = []
    const steps = (list: unknown, at: string) => {
      for (const [i, s] of ((list as { type: string }[] | undefined) ?? []).entries()) if (!known.includes(s.type)) bad.push(`${at}[${i}]: ${s.type}`)
    }
    for (const c of allConsoles()) {
      steps(c.config, `${c.id}.config`)
      steps(c.controls, `${c.id}.controls`)
      steps(c.achievements?.on, `${c.id}.achievements.on`)
      steps(c.achievements?.off, `${c.id}.achievements.off`)
    }
    for (const e of allEmulators()) steps(e.portable, `${e.id}.portable`)
    expect(bad).toEqual([])
  })
})
