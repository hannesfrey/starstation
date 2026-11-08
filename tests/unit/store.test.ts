import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// the store logs through Files\config\logs: point Files at a throw-away folder first
const tmp = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'store-test-'))
process.env.STARSTATION_FILES = tmp

const { readJson, writeJson, writeFileAtomic } = await import('../../src/main/store')

describe('JSON store', () => {
  beforeAll(() => fs.mkdirSync(path.join(tmp, 'config'), { recursive: true }))
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('missing file → fallback, nothing written', () => {
    const f = path.join(tmp, 'config', 'missing.json')
    expect(readJson(f, { a: 1 })).toEqual({ a: 1 })
    expect(fs.existsSync(f)).toBe(false)
  })

  it('writes atomically and keeps the previous good version as .bak', () => {
    const f = path.join(tmp, 'config', 'stats.json')
    writeJson(f, { play: 1 })
    writeJson(f, { play: 2 })
    expect(readJson(f, null)).toEqual({ play: 2 })
    expect(JSON.parse(fs.readFileSync(`${f}.bak`, 'utf8'))).toEqual({ play: 1 })
    // no temp files left behind
    expect(fs.readdirSync(path.dirname(f)).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  it('a damaged file (cut off, or zeros after a power cut) falls back to the last good copy and is kept as .broken', () => {
    const f = path.join(tmp, 'config', 'play.json')
    writeJson(f, { minutes: 10 })
    writeJson(f, { minutes: 20 }) // .bak = 10
    fs.writeFileSync(f, '{"minutes": 2')
    expect(readJson(f, { minutes: 0 })).toEqual({ minutes: 10 })
    expect(fs.readFileSync(`${f}.broken`, 'utf8')).toBe('{"minutes": 2')

    fs.writeFileSync(f, Buffer.alloc(64)) // NUL bytes
    expect(readJson(f, { minutes: 0 })).toEqual({ minutes: 10 })
  })

  it('a damaged file never replaces the last good backup', () => {
    const f = path.join(tmp, 'config', 'mods.json')
    writeJson(f, { mods: ['a'] })
    writeJson(f, { mods: ['a', 'b'] }) // .bak = [a]
    fs.writeFileSync(f, 'garbage')
    writeJson(f, { mods: ['c'] }) // the broken file must not become the backup
    expect(JSON.parse(fs.readFileSync(`${f}.bak`, 'utf8'))).toEqual({ mods: ['a'] })
  })

  it('a damaged file without a backup gives the fallback', () => {
    const f = path.join(tmp, 'config', 'nobak.json')
    fs.writeFileSync(f, '')
    expect(readJson(f, { x: 'fallback' })).toEqual({ x: 'fallback' })
  })

  it('a damaged file read again and again is noted (and copied) once', () => {
    const f = path.join(tmp, 'config', 'often.json')
    fs.writeFileSync(f, '{"github": ') // e.g. secrets.json edited by hand, read on every menu update
    for (let i = 0; i < 20; i++) expect(readJson(f, {})).toEqual({})
    const log = fs.readdirSync(path.join(tmp, 'config', 'logs')).map((n) => fs.readFileSync(path.join(tmp, 'config', 'logs', n), 'utf8')).join('')
    expect(log.split(`${f} is damaged`).length - 1).toBe(1)
  })

  it('valid JSON of the wrong shape gives the fallback (object ↔ object, list ↔ list); a null fallback takes anything', () => {
    const f = path.join(tmp, 'config', 'shape.json')
    const put = (v: unknown) => fs.writeFileSync(f, JSON.stringify(v))
    put(null)
    expect(readJson(f, { a: 1 })).toEqual({ a: 1 })
    put([1, 2])
    expect(readJson(f, { a: 1 })).toEqual({ a: 1 })
    expect(readJson(f, [] as number[])).toEqual([1, 2])
    put({ b: 2 })
    expect(readJson(f, [] as unknown[])).toEqual([])
    expect(readJson(f, {})).toEqual({ b: 2 })
    put('text')
    expect(readJson(f, {})).toEqual({})
    expect(readJson<unknown>(f, null)).toBe('text')
    expect(fs.readFileSync(f, 'utf8')).toBe('"text"') // the file itself is left alone
  })

  it('reads files written with a UTF-8 BOM (Notepad, PowerShell)', () => {
    const f = path.join(tmp, 'config', 'secrets.json')
    fs.writeFileSync(f, '﻿{"ok": true}')
    expect(readJson(f, null)).toEqual({ ok: true })
  })

  it('writeFileAtomic replaces the content in one piece', () => {
    const f = path.join(tmp, 'emu', 'PCSX2.ini')
    writeFileAtomic(f, '[UI]\r\nA = 1\r\n')
    writeFileAtomic(f, '[UI]\r\nA = 2\r\n')
    expect(fs.readFileSync(f, 'utf8')).toBe('[UI]\r\nA = 2\r\n')
    expect(fs.existsSync(`${f}.bak`)).toBe(false) // only JSON keeps a backup
  })
})
