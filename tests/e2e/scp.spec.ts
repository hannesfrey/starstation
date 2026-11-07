import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, writeSettings } from './helpers'

/** PS3 controller on the SCP driver: does nothing unless SCP Server runs (Hannes, 2026-11-07). */

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>
type Issue = { title: string; fix?: { command: string } }

test.afterEach(() => {
  delete process.env.STARSTATION_TEST_SCP
  delete process.env.STARSTATION_TEST_SCP_SERVER
})

test('SCP driver without its server: health check says so, Starstation starts the server and remembers it', async () => {
  const files = makeFiles('scp')
  writeSettings(files, { bootAnimation: false })
  const server = path.join(files, 'PC Stuff', 'scpds', 'ScpServer', 'bin', 'ScpServer.exe')
  fs.mkdirSync(path.dirname(server), { recursive: true })
  fs.writeFileSync(server, 'MZ')
  process.env.STARSTATION_TEST_SCP = 'driver' // set up with SCP, server not running
  process.env.STARSTATION_TEST_SCP_SERVER = server
  const { app, page } = await launchApp(files)
  try {
    await page.waitForFunction(() => !!(window as unknown as { starstation?: unknown }).starstation)
    // at start Starstation looked for the server and started it (remembered for next time)
    const remembered = path.join(files, 'config', 'controllers', 'scp.json')
    await expect.poll(() => fs.existsSync(remembered) && JSON.parse(fs.readFileSync(remembered, 'utf8')).server).toBe(server)
    const issue = (await api<Issue[]>(page, 'health')).find((i) => i.title.includes('SCP Server'))
    expect(issue?.fix?.command).toBe('start-scp')
    await api(page, 'runCommand', 'start-scp')
  } finally {
    await app.close()
  }

  // server running: nothing to report
  process.env.STARSTATION_TEST_SCP = 'driver,running'
  const second = await launchApp(files)
  try {
    await second.page.waitForFunction(() => !!(window as unknown as { starstation?: unknown }).starstation)
    expect((await api<Issue[]>(second.page, 'health')).some((i) => i.title.includes('SCP'))).toBe(false)
  } finally {
    await second.app.close()
  }

  // no PS3 controller on SCP (Sony driver, DualShock 4, Xbox pads): nothing at all
  process.env.STARSTATION_TEST_SCP = 'none'
  const third = await launchApp(files)
  try {
    await third.page.waitForFunction(() => !!(window as unknown as { starstation?: unknown }).starstation)
    expect((await api<Issue[]>(third.page, 'health')).some((i) => i.title.includes('SCP'))).toBe(false)
  } finally {
    await third.app.close()
  }
})
