import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, makeFiles, writeSettings } from './helpers'

/**
 * Real check on a PC with a PS3 controller on the SCP driver (opt-in: STARSTATION_REAL_SCP=1).
 * SCP Server must be closed first; Starstation has to find it on its own, start it, and the Xbox 360 pad appears.
 */
test.skip(process.env.STARSTATION_REAL_SCP !== '1', 'needs a PS3 controller on the SCP driver (STARSTATION_REAL_SCP=1)')

const api = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => (window as unknown as { starstation: Record<string, (...x: unknown[]) => Promise<unknown>> }).starstation[f as string](...(a as unknown[])),
    [fn, args] as const
  ) as Promise<T>
const ps = (cmd: string) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8' }).trim()
const xboxPads = () => Number(ps("@(Get-PnpDevice -PresentOnly -Class XnaComposite -ErrorAction SilentlyContinue).Count"))

test('real PC: Starstation finds SCP Server, starts it, and the controller shows up', async () => {
  test.setTimeout(120_000)
  expect(ps("@(Get-Process ScpServer -ErrorAction SilentlyContinue).Count")).toBe('0')
  expect(xboxPads()).toBe(0)
  const files = makeFiles('scp-real')
  writeSettings(files, { bootAnimation: false })
  const { app, page } = await launchApp(files)
  try {
    await page.waitForFunction(() => !!(window as unknown as { starstation?: unknown }).starstation)
    const issues = await api<{ title: string }[]>(page, 'health')
    expect(issues.some((i) => i.title.includes('SCP Server'))).toBe(true)
    await api(page, 'runCommand', 'start-scp')
    await expect.poll(() => ps("@(Get-Process ScpServer -ErrorAction SilentlyContinue).Count"), { timeout: 15_000 }).toBe('1')
    await expect.poll(xboxPads, { timeout: 15_000 }).toBeGreaterThan(0)
    const server = JSON.parse(fs.readFileSync(path.join(files, 'config', 'controllers', 'scp.json'), 'utf8')).server
    console.log(`found and started: ${server}`)
    expect((await api<{ title: string }[]>(page, 'health')).some((i) => i.title.includes('SCP'))).toBe(false)
  } finally {
    await app.close()
  }
})
