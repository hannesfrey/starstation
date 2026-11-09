import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({ net: { fetch: () => Promise.reject(new Error('no network in tests')) }, app: { getVersion: () => '0.0.0' } }))
const FILES = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'dl-test-'))
process.env.STARSTATION_FILES = FILES
const { download } = await import('../../src/main/emulators')

/** #11: downloads never hang, never leave half files, and a dropped connection is tried again. */

/** A response whose body sends `chunks`, then either ends, stalls (never sends more) or breaks. */
function respond(chunks: string[], end: 'end' | 'stall' | 'break', total?: number): Response {
  let i = 0
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) return c.enqueue(new TextEncoder().encode(chunks[i++]))
      if (end === 'end') return c.close()
      if (end === 'break') return c.error(new Error('connection reset'))
      return new Promise(() => undefined) // stall
    }
  })
  const len = total ?? chunks.join('').length
  return new Response(body, { status: 200, headers: { 'content-length': String(len) } })
}

const target = (n: string) => path.join(FILES, 'dl', n)
const leftovers = () => (fs.existsSync(path.join(FILES, 'dl')) ? fs.readdirSync(path.join(FILES, 'dl')).filter((n) => n.endsWith('.part')) : [])

describe('download', () => {
  it('a complete download gets its real name; no .part left', async () => {
    await download('u', target('ok.zip'), undefined, { fetch: async () => respond(['ab', 'cd'], 'end') })
    expect(fs.readFileSync(target('ok.zip'), 'utf8')).toBe('abcd')
    expect(leftovers()).toEqual([])
  })

  it('a stalled connection is given up instead of hanging', async () => {
    await expect(download('u', target('stall.zip'), undefined, { stallMs: 200, retries: 0, fetch: async (_u, init) => {
      const r = respond(['ab'], 'stall', 10)
      init.signal?.addEventListener('abort', () => undefined)
      return r
    } })).rejects.toThrow(/no data/)
    expect(fs.existsSync(target('stall.zip'))).toBe(false)
    expect(leftovers()).toEqual([])
  })

  it('a dropped connection is tried again', async () => {
    let n = 0
    await download('u', target('retry.zip'), undefined, { fetch: async () => (++n === 1 ? respond(['ab'], 'break', 4) : respond(['ab', 'cd'], 'end')) })
    expect(n).toBe(2)
    expect(fs.readFileSync(target('retry.zip'), 'utf8')).toBe('abcd')
  }, 10_000)

  it('a short download (ended early) never becomes the file', async () => {
    await expect(download('u', target('short.zip'), undefined, { retries: 0, fetch: async () => respond(['ab'], 'end', 10) })).rejects.toThrow(/incomplete/)
    expect(fs.existsSync(target('short.zip'))).toBe(false)
    expect(leftovers()).toEqual([])
  })

  it('HTTP errors are not tried again', async () => {
    let n = 0
    await expect(download('u', target('404.zip'), undefined, { fetch: async () => (n++, new Response('no', { status: 404 })) })).rejects.toThrow(/HTTP 404/)
    expect(n).toBe(1)
  })
})
