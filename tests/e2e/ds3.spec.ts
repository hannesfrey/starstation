import { test, expect, type Page } from '@playwright/test'
import { launchApp, makeFiles, writeSettings } from './helpers'

/** PS3 controller without its driver: Starstation offers the bundled one (DsHidMini); Windows' prompt is faked here. */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>
type Issue = { title: string; fix?: { command: string } }
type Notice = { title: string; kind: string; action?: { command: string } }

test.afterEach(() => {
  delete process.env.STARSTATION_TEST_DS3
  delete process.env.STARSTATION_TEST_DS3_INSTALL
})

async function notices(page: Page): Promise<Notice[]> {
  return page.evaluate(() => ((window as unknown as { __notices?: Notice[] }).__notices ?? []).slice())
}

async function start(files: string) {
  const r = await launchApp(files)
  await r.page.waitForFunction(() => !!(window as unknown as { starstation?: unknown }).starstation)
  // collect notices from now on (the first one may already be on screen: health check covers it too)
  await r.page.evaluate(() => {
    const w = window as unknown as { __notices: unknown[]; starstation: { on: (ch: string, fn: (n: unknown) => void) => void } }
    w.__notices = []
    w.starstation.on('notice', (n) => w.__notices.push(n))
  })
  return r
}

test('PS3 controller without driver: offered, Windows permission refused, then installed', async () => {
  const files = makeFiles('ds3')
  writeSettings(files, { bootAnimation: false })
  process.env.STARSTATION_TEST_DS3 = 'needs-driver'
  process.env.STARSTATION_TEST_DS3_INSTALL = 'cancel'
  const { app, page } = await start(files)
  try {
    await expect.poll(async () => (await api<Issue[]>(page, 'health')).find((i) => i.title.includes('PS3'))?.fix?.command).toBe('install-ds3-driver')
    // the user says No in Windows' prompt: nothing installed, offered again
    await api(page, 'runCommand', 'install-ds3-driver')
    await expect.poll(async () => (await notices(page)).find((n) => n.title.includes('not installed'))?.action?.command).toBe('install-ds3-driver')
    expect((await api<Issue[]>(page, 'health')).some((i) => i.title.includes('PS3'))).toBe(true)
  } finally {
    await app.close()
  }

  process.env.STARSTATION_TEST_DS3_INSTALL = 'ok'
  const second = await start(files)
  try {
    await api(second.page, 'runCommand', 'install-ds3-driver')
    await expect.poll(async () => (await notices(second.page)).some((n) => n.title === 'PS3 controller ready')).toBe(true)
    expect((await api<Issue[]>(second.page, 'health')).some((i) => i.title.includes('PS3'))).toBe(false)
  } finally {
    await second.app.close()
  }
})

test('no PS3 controller, or one with its driver: nothing offered', async () => {
  for (const state of ['none', 'ready']) {
    const files = makeFiles(`ds3-${state}`)
    writeSettings(files, { bootAnimation: false })
    process.env.STARSTATION_TEST_DS3 = state
    const { app, page } = await start(files)
    try {
      expect((await api<Issue[]>(page, 'health')).some((i) => i.title.includes('PS3'))).toBe(false)
    } finally {
      await app.close()
    }
  }
})
