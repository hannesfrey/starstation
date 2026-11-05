import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { launchApp, makeFiles, writeSettings } from './helpers'

/** SPEC-v2 B: beta channel, "Release to everyone", emulator versions offered only once tested. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>

type Upd = { status: string; version?: string; channel: string; tester: boolean; canRelease?: boolean }
type Emu = { id: string; latest: string | null; updateAvailable: boolean; tested?: string; untested?: boolean }

/** Fake GitHub: Starstation releases, the tested-emulators list, PCSX2 releases. */
async function fakeGithub() {
  const calls: { method: string; url: string; body?: string; auth?: string }[] = []
  let promoted = false
  let testedFile: string | null = JSON.stringify({ emulators: { pcsx2: 'v2.8.5' } })
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      const url = req.url ?? ''
      calls.push({ method: req.method ?? 'GET', url, body, auth: req.headers.authorization })
      const json = (o: unknown, code = 200) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(o))
      const p = url.split('?')[0]
      if (p === '/api/repos/hannesfrey/starstation/releases')
        return json([
          { tag_name: 'v99.0.0', prerelease: !promoted, draft: false },
          { tag_name: 'v98.5.0', prerelease: false, draft: false },
          { tag_name: 'v98.0.0', prerelease: false, draft: false }
        ])
      if (p === '/api/repos/hannesfrey/starstation/releases/tags/v99.0.0') return json({ id: 42, prerelease: !promoted })
      if (p === '/api/repos/hannesfrey/starstation/releases/42' && req.method === 'PATCH') {
        promoted = JSON.parse(body).prerelease === false
        return json({ id: 42, prerelease: !promoted })
      }
      if (p === '/raw/tested-emulators.json') return testedFile ? res.writeHead(200).end(testedFile) : res.writeHead(404).end()
      if (p === '/api/repos/hannesfrey/starstation/contents/tested-emulators.json') {
        if (req.method === 'PUT') {
          testedFile = Buffer.from(JSON.parse(body).content, 'base64').toString('utf8')
          return json({ content: {} })
        }
        return testedFile ? json({ sha: 'abc', content: Buffer.from(testedFile).toString('base64') }) : json({}, 404)
      }
      const rel = (tag: string) => ({ tag_name: tag, assets: [{ name: `pcsx2-${tag}-windows-x64-Qt.7z`, browser_download_url: `http://x/${tag}.7z` }] })
      if (p === '/api/repos/PCSX2/pcsx2/releases/latest') return json(rel('v2.9.9'))
      if (p.startsWith('/api/repos/PCSX2/pcsx2/releases/tags/')) return json(rel(decodeURIComponent(p.split('/').pop()!)))
      if (p.startsWith('/api/repos/')) return json({ message: 'Not Found' }, 404)
      res.writeHead(404).end()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { server, calls, base, tested: () => testedFile, promoted: () => promoted }
}

/** An installed PCSX2 (just a file where the program would be) with a known release tag. */
function fakePcsx2(files: string, version: string, tag?: string) {
  const d = path.join(files, 'emulators', 'pcsx2')
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, 'pcsx2-qt.exe'), 'MZ')
  fs.writeFileSync(path.join(d, '.starstation.json'), JSON.stringify({ version, ...(tag ? { tag } : {}) }))
}

test('everyone else: only released versions, and only tested emulator versions', async () => {
  const gh = await fakeGithub()
  const files = makeFiles('channel-everyone')
  writeSettings(files, { bootAnimation: false })
  fakePcsx2(files, '2.8.2', 'v2.8.2')
  process.env.STARSTATION_GITHUB_API = `${gh.base}/api`
  process.env.STARSTATION_GITHUB_RAW = `${gh.base}/raw`
  const { app, page } = await launchApp(files)
  try {
    const u = await api<Upd>(page, 'checkForUpdates')
    expect(u.channel).toBe('everyone')
    expect(u.tester).toBe(false)
    expect(u.version).toBe('98.5.0') // 99.0.0 is still a beta
    expect(u.canRelease).toBe(false)
    // emulators: the tested version, not the newest
    const pcsx2 = (await api<Emu[]>(page, 'checkEmulatorUpdates')).find((e) => e.id === 'pcsx2')!
    expect(pcsx2.latest).toBe('v2.8.5')
    expect(pcsx2.updateAvailable).toBe(true)
    expect(pcsx2.untested).toBe(false)
    expect(gh.calls.some((c) => c.url.includes('/PCSX2/pcsx2/releases/latest'))).toBe(false)
    // never sends a login it doesn't have
    expect(gh.calls.every((c) => !c.auth)).toBe(true)
  } finally {
    await app.close()
    gh.server.close()
    delete process.env.STARSTATION_GITHUB_API
    delete process.env.STARSTATION_GITHUB_RAW
  }
})

test('tester PC: betas first, Release to everyone, Mark as tested', async () => {
  const gh = await fakeGithub()
  const files = makeFiles('channel-tester')
  writeSettings(files, { bootAnimation: false })
  fs.writeFileSync(path.join(files, 'config', 'secrets.json'), JSON.stringify({ github: { token: 'test-token' } }))
  fakePcsx2(files, '2.9.9', 'v2.9.9')
  process.env.STARSTATION_GITHUB_API = `${gh.base}/api`
  process.env.STARSTATION_GITHUB_RAW = `${gh.base}/raw`
  process.env.STARSTATION_TEST_VERSION = '99.0.0' // pretend the beta is installed here
  const { app, page } = await launchApp(files)
  try {
    let u = await api<Upd>(page, 'checkForUpdates')
    expect(u.channel).toBe('beta')
    expect(u.status).toBe('latest') // 99.0.0 is the newest
    expect(u.canRelease).toBe(true)

    // Release to everyone turns the pre-release into a normal release
    const r = await api<{ ok: boolean }>(page, 'releaseToEveryone')
    expect(r.ok).toBe(true)
    expect(gh.promoted()).toBe(true)
    const patch = gh.calls.find((c) => c.method === 'PATCH')!
    expect(JSON.parse(patch.body!)).toEqual({ prerelease: false, make_latest: 'true' })
    expect(patch.auth).toBe('Bearer test-token')
    u = await api<Upd>(page, 'updateState')
    expect(u.canRelease).toBe(false)

    // emulators: the newest for the tester; the installed one is newer than the tested one → Mark as tested
    let pcsx2 = (await api<Emu[]>(page, 'checkEmulatorUpdates')).find((e) => e.id === 'pcsx2')!
    expect(pcsx2.latest).toBe('v2.9.9')
    expect(pcsx2.updateAvailable).toBe(false)
    expect(pcsx2.tested).toBe('v2.8.5')
    expect(pcsx2.untested).toBe(true)
    expect((await api<{ ok: boolean }>(page, 'markTested', 'pcsx2')).ok).toBe(true)
    expect(JSON.parse(gh.tested()!).emulators.pcsx2).toBe('v2.9.9')
    pcsx2 = (await api<Emu[]>(page, 'emulators')).find((e) => e.id === 'pcsx2')!
    expect(pcsx2.untested).toBe(false)
  } finally {
    await app.close()
    gh.server.close()
    delete process.env.STARSTATION_GITHUB_API
    delete process.env.STARSTATION_GITHUB_RAW
    delete process.env.STARSTATION_TEST_VERSION
  }
})
